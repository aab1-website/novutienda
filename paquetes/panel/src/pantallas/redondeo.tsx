// Sección «Redondeo de precios» de Configuración (Central). El administrador del comercio solo VE la regla de cada moneda en
// palabras simples, con un ejemplo; solo el operador de NovuTienda (el servidor dice `puedeEditar`) ve el formulario para
// cambiarla. El servidor decide el permiso y valida la regla; aquí no se calcula ningún precio salvo el ejemplo mostrado.
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { redondear } from '@novutienda/nucleo';
import { ErrorApi } from '../api/errores.js';
import type { ClienteApi } from '../api/cliente.js';
import type { ReglaRedondeoVista, VistaRedondeo } from '../api/tipos.js';
import { Alerta, Boton, BotonConfirmado, Campo, Cargando, ErrorCarga, Selector, Seccion } from '../ui/comun.js';
import { useApp } from '../ui/contexto.js';
import { useAccion, useCarga } from '../ui/hooks.js';
import { prefijoMoneda, textoACentavos } from '../util/dinero.js';

const NOMBRE_MONEDA: Readonly<Record<string, string>> = { BOB: 'Bolivianos', ARS: 'Pesos', USD: 'Dólares' };
const SIMBOLO: Readonly<Record<string, string>> = { ARS: '$' };
const EN_PALABRAS: Readonly<Record<number, string>> = { 1: 'de uno en uno', 5: 'de cinco en cinco', 10: 'de diez en diez', 50: 'de cincuenta en cincuenta', 100: 'de cien en cien', 500: 'de quinientos en quinientos', 1000: 'de mil en mil' };

const nombreMoneda = (m: string): string => NOMBRE_MONEDA[m] ?? m;
const simbolo = (m: string): string => SIMBOLO[m] ?? prefijoMoneda(m);

/** Número con miles con punto y decimales con coma, con exactamente `decimales` decimales. */
function numero(v: number, decimales: number): string {
  const [entero = '0', dec = ''] = v.toFixed(decimales).split('.');
  return `${entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${decimales > 0 ? `,${dec}` : ''}`;
}

const decimalesDe = (r: ReglaRedondeoVista): number => {
  if (r.tipo === 'decimales') return r.decimales;
  const c = Math.round(r.multiplo * 100);
  return c % 100 === 0 ? 0 : c % 10 === 0 ? 1 : 2;
};

/** Cómo se redondea, en palabras de uso diario («sin decimales», «de mil en mil»). */
export function textoDeRegla(r: ReglaRedondeoVista): string {
  const base =
    r.tipo === 'decimales'
      ? r.decimales === 0 ? 'sin decimales' : r.decimales === 1 ? 'con 1 decimal' : 'con 2 decimales'
      : (EN_PALABRAS[r.multiplo] ?? `de ${numero(r.multiplo, decimalesDe(r))} en ${numero(r.multiplo, decimalesDe(r))}`);
  return r.modo === 'arriba' ? `${base}, siempre hacia arriba` : r.modo === 'abajo' ? `${base}, siempre hacia abajo` : base;
}

/** Un precio de ejemplo ya redondeado con la regla, para que se vea el efecto. */
export function ejemploDeRegla(r: ReglaRedondeoVista, moneda: string): string {
  const crudo = r.tipo === 'decimales' ? 3431.456 : Math.round(r.multiplo * 520678) / 1000;
  return `${simbolo(moneda)} ${numero(redondear(crudo, r), decimalesDe(r))}`;
}

/** «Bolivianos: sin decimales (Bs 3.431)». */
export const lineaDeRegla = (moneda: string, r: ReglaRedondeoVista): string => `${nombreMoneda(moneda)}: ${textoDeRegla(r)} (${ejemploDeRegla(r, moneda)})`;

// ---------------------------------------------------------------------------------------------------------------------
// Formulario del operador
// ---------------------------------------------------------------------------------------------------------------------

interface Borrador {
  tipo: 'decimales' | 'multiplo';
  decimales: string;
  multiplo: string;
  modo: 'cercano' | 'arriba' | 'abajo';
}

const aBorrador = (r: ReglaRedondeoVista): Borrador => ({
  tipo: r.tipo,
  decimales: r.tipo === 'decimales' ? String(r.decimales) : '0',
  multiplo: r.tipo === 'multiplo' ? numero(r.multiplo, decimalesDe(r)).replaceAll('.', '') : '1000',
  modo: r.modo,
});

/** Regla que describe el borrador, o el texto de lo que falta corregir. */
function aRegla(b: Borrador): ReglaRedondeoVista | string {
  if (b.tipo === 'decimales') return { tipo: 'decimales', decimales: Number(b.decimales), modo: b.modo };
  const c = textoACentavos(b.multiplo);
  return c === null || c < 1 ? 'Escriba un número mayor que cero, por ejemplo 1000 o 0,50.' : { tipo: 'multiplo', multiplo: c / 100, modo: b.modo };
}

const igualRegla = (a: ReglaRedondeoVista, b: ReglaRedondeoVista): boolean => JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort());

function Editor({ vista, api, recargar }: { vista: VistaRedondeo; api: ClienteApi; recargar: () => void }): JSX.Element {
  const accion = useAccion();
  const [borradores, setBorradores] = useState<Record<string, Borrador>>(() => Object.fromEntries(vista.monedas.map((m) => [m, aBorrador(vista.reglas[m] as ReglaRedondeoVista)])));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const cambia = (moneda: string, parcial: Partial<Borrador>): void => {
    setBorradores({ ...borradores, [moneda]: { ...(borradores[moneda] as Borrador), ...parcial } });
    setErrores({ ...errores, [moneda]: '' });
  };

  const guardar = (): void => {
    const reglas: Record<string, ReglaRedondeoVista> = {};
    const malos: Record<string, string> = {};
    for (const m of vista.monedas) {
      const r = aRegla(borradores[m] as Borrador);
      if (typeof r === 'string') malos[m] = r;
      else reglas[m] = r;
    }
    setErrores(malos);
    if (Object.keys(malos).length > 0) return;
    void accion.ejecutar(async () => {
      try {
        return await api.llamar('fijarRedondeo', { reglas, esperadas: vista.reglas });
      } catch (e) {
        // Otra persona lo cambió: se muestran las reglas vigentes para que decida con lo que hay hoy.
        if (e instanceof ErrorApi && e.detalle.codigo === 'redondeo-conflicto') recargar();
        throw e;
      }
    }, {
      exito: (r) => (r.estado === 'fijado' ? 'Redondeo guardado. Los precios se actualizan en la caja, la web y WhatsApp.' : 'No había cambios que guardar.'),
      error: 'ambos',
    }).then((r) => { if (r !== undefined) recargar(); });
  };

  const reglasNuevas = vista.monedas.map((m) => aRegla(borradores[m] as Borrador));
  const sinCambios = reglasNuevas.every((r, i) => typeof r !== 'string' && igualRegla(r, vista.reglas[vista.monedas[i] as string] as ReglaRedondeoVista));
  return (
    <form class="formulario" onSubmit={(e) => e.preventDefault()} noValidate aria-label="Cambiar el redondeo de los precios">
      {vista.monedas.map((m, i) => {
        const b = borradores[m] as Borrador;
        const r = reglasNuevas[i];
        return (
          <fieldset key={m}>
            <legend>{nombreMoneda(m)}</legend>
            <Selector
              etiqueta={`Cómo se redondea (${nombreMoneda(m)})`}
              valor={b.tipo}
              opciones={[{ valor: 'decimales', texto: 'Con centavos o sin ellos' }, { valor: 'multiplo', texto: 'De tantos en tantos (por ejemplo, de mil en mil)' }]}
              onCambio={(v) => cambia(m, { tipo: v === 'multiplo' ? 'multiplo' : 'decimales' })}
            />
            {b.tipo === 'decimales' ? (
              <Selector
                etiqueta={`Decimales (${nombreMoneda(m)})`}
                valor={b.decimales}
                opciones={[{ valor: '0', texto: 'Sin decimales' }, { valor: '1', texto: '1 decimal' }, { valor: '2', texto: '2 decimales' }]}
                onCambio={(v) => cambia(m, { decimales: v })}
              />
            ) : (
              <Campo
                etiqueta={`De cuánto en cuánto (${nombreMoneda(m)})`}
                inputMode="decimal"
                autocompletar="off"
                valor={b.multiplo}
                onInput={(v) => cambia(m, { multiplo: v })}
                ayuda="Por ejemplo, 1000 deja los precios de mil en mil."
                {...(errores[m] ? { error: errores[m] } : {})}
              />
            )}
            <Selector
              etiqueta={`Hacia dónde (${nombreMoneda(m)})`}
              valor={b.modo}
              opciones={[{ valor: 'cercano', texto: 'Al más cercano (la mitad sube)' }, { valor: 'arriba', texto: 'Siempre hacia arriba' }, { valor: 'abajo', texto: 'Siempre hacia abajo' }]}
              onCambio={(v) => cambia(m, { modo: v === 'arriba' || v === 'abajo' ? v : 'cercano' })}
            />
            {r !== undefined && typeof r !== 'string' && <p class="texto-suave">Quedaría así: {lineaDeRegla(m, r)}</p>}
          </fieldset>
        );
      })}
      <Alerta tipo="info">Al guardar cambian los precios de la caja, de la web y de WhatsApp, y el sitio se reconstruye. Quedan anotados quién lo cambió y cuándo.</Alerta>
      {accion.error && <Alerta>{accion.error}</Alerta>}
      {sinCambios ? (
        <Boton deshabilitado>Guardar el redondeo</Boton>
      ) : (
        <BotonConfirmado
          texto="Guardar el redondeo"
          pregunta="¿Cambiar el redondeo de los precios?"
          resumen="Cambian los precios de la caja, de la web y de WhatsApp, y el sitio se reconstruye. Esta acción queda anotada."
          textoConfirmar="Sí, cambiar el redondeo"
          deshabilitado={accion.ocupado}
          onConfirmar={guardar}
        />
      )}
    </form>
  );
}

/** Sección de Configuración: la regla vigente para todos y el formulario solo para el operador. */
export function SeccionRedondeo(): JSX.Element {
  const { api } = useApp();
  const carga = useCarga(() => api.llamar('verRedondeo', {}), []);
  const v = carga.datos;
  return (
    <Seccion titulo="Redondeo de precios">
      {carga.cargando && v === undefined && <Cargando />}
      {carga.error && v === undefined && <ErrorCarga error={carga.error} reintentar={carga.recargar} />}
      {v !== undefined && (
        <>
          <p class="texto-suave">
            Así se redondea el precio final de venta en la caja, la web y WhatsApp.{' '}
            {v.puedeEditar ? 'Usted puede cambiarlo.' : 'Solo lo cambia el operador de NovuTienda; para modificarlo, solicítelo a él.'}
          </p>
          {v.monedas.length === 0 && <Alerta tipo="info">Este negocio no tiene monedas de venta declaradas.</Alerta>}
          <ul>
            {v.monedas.map((m) => { const r = v.reglas[m]; return (r === undefined ? null : <li key={m}>{lineaDeRegla(m, r)}</li>); })}
          </ul>
          {v.puedeEditar && v.monedas.every((m) => v.reglas[m] !== undefined) && <Editor key={JSON.stringify(v.reglas)} vista={v} api={api} recargar={carga.recargar} />}
        </>
      )}
    </Seccion>
  );
}
