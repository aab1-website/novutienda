// Pantalla «Tipo de cambio» (Central, solo administrador): por mercado con tipo de cambio muestra la referencia del banco
// central, el valor manual vigente (quién y cuándo), un formulario para cargar uno nuevo, el botón para volver al del banco
// central y el historial. El servidor decide el permiso; aquí no se calcula ninguna regla de negocio salvo el aviso del salto.
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { ErrorApi } from '../api/errores.js';
import type { ClienteApi } from '../api/cliente.js';
import type { MercadoTipoCambio } from '../api/tipos.js';
import { Alerta, Boton, BotonConfirmado, Campo, Cargando, Dato, ErrorCarga, Seccion, fechaHora } from '../ui/comun.js';
import { useApp } from '../ui/contexto.js';
import { useAccion, useCarga } from '../ui/hooks.js';
import { Tabla } from '../ui/tabla.js';

const NOMBRE_MERCADO: Readonly<Record<string, string>> = { BO: 'Bolivia', AR: 'Argentina' };
const FUENTE: Readonly<Record<string, string>> = { BCB: 'Banco Central de Bolivia', BNA: 'Banco de la Nación Argentina', BCRA: 'Banco Central de la República Argentina', manual: 'Carga manual' };
const ESTADO_REFERENCIA: Readonly<Record<string, string>> = {
  vigente: 'Al día',
  ultimo_verificado: 'Último valor verificado (la fuente no respondió)',
  vencida: 'Vencida: ya no se usa',
};

const nombreMercado = (m: MercadoTipoCambio): string => NOMBRE_MERCADO[m.mercado] ?? m.mercado;
const numero = (v: number): string => v.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const fechaCorta = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Acepta «6,96» o «6.96»; nada de miles ni signos. `null` si no es un número positivo de hasta 6 decimales. */
export function leerValor(texto: string): number | null {
  const t = texto.trim().replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function TarjetaMercado({ m, api, recargar }: { m: MercadoTipoCambio; api: ClienteApi; recargar: () => void }): JSX.Element {
  const accion = useAccion();
  const [texto, setTexto] = useState('');
  const [errorCampo, setErrorCampo] = useState<string | undefined>(undefined);
  // Valor que quedó esperando la confirmación del salto (el servidor lo pidió); `null` si no hay ninguno.
  const [saltoPendiente, setSaltoPendiente] = useState<number | null>(null);
  const base = m.manual?.valor ?? m.referencia?.valor ?? null;
  const nombre = nombreMercado(m);

  const guardar = (valor: number, confirmarSalto: boolean): void => {
    void accion.ejecutar(async () => {
      try {
        await api.llamar('cotizacionManual', { mercado: m.mercado, valor, ...(confirmarSalto ? { confirmarSalto: true } : {}) });
      } catch (e) {
        if (e instanceof ErrorApi && e.detalle.codigo === 'salto-sin-confirmar') {
          setSaltoPendiente(valor);
          return;
        }
        throw e;
      }
      setSaltoPendiente(null);
      setTexto('');
      recargar();
    }, { exito: `Tipo de cambio de ${nombre} guardado.`, error: 'ambos' });
  };
  const enviar = (e: Event): void => {
    e.preventDefault();
    const v = leerValor(texto);
    if (v === null) {
      setErrorCampo('Escriba un número mayor que cero, con hasta 6 decimales. Por ejemplo, 6,96.');
      return;
    }
    setErrorCampo(undefined);
    setSaltoPendiente(null);
    guardar(v, false);
  };
  const volver = (): void => {
    void accion.ejecutar(async () => {
      await api.llamar('quitarCotizacionManual', { mercado: m.mercado, confirmar: true });
      recargar();
    }, { exito: `Ahora rige el tipo de cambio del banco central en ${nombre}.`, error: 'ambos' });
  };

  const regla =
    m.rige === 'manual' ? 'Hoy rige el valor manual.' : m.rige === 'referencia' ? 'Hoy rige el del banco central.' : 'Hoy no hay un tipo de cambio utilizable: cargue uno manual.';
  return (
    <Seccion titulo={`${nombre} (${m.par})`}>
      <p class="texto-suave" role="status">{regla}</p>
      <dl class="datos">
        <Dato etiqueta="Del banco central">
          {m.referencia === null
            ? 'Sin dato'
            : `${numero(m.referencia.valor)} · ${FUENTE[m.referencia.fuente] ?? m.referencia.fuente} · ${fechaCorta(m.referencia.fecha)} · ${ESTADO_REFERENCIA[m.referencia.estado] ?? m.referencia.estado}`}
        </Dato>
        <Dato etiqueta="Manual vigente">
          {m.manual === null
            ? 'No hay uno cargado'
            : `${numero(m.manual.valor)} · cargado por ${m.manual.por}${m.manual.actualizadoEn === null ? '' : ` el ${fechaHora(m.manual.actualizadoEn)}`}`}
        </Dato>
      </dl>
      {m.manual !== null && <p class="texto-suave">El valor manual no vence: manda hasta que cargue otro o vuelva al del banco central.</p>}

      <form class="formulario" onSubmit={enviar} noValidate aria-label={`Cargar un tipo de cambio manual para ${nombre}`}>
        <Campo
          etiqueta={`Nuevo valor manual (${m.par})`}
          inputMode="decimal"
          autocompletar="off"
          valor={texto}
          onInput={(v) => { setTexto(v); setErrorCampo(undefined); setSaltoPendiente(null); }}
          ayuda="Cuántas unidades de la moneda local equivalen a 1 USD. Rige desde que lo guarda."
          {...(errorCampo === undefined ? {} : { error: errorCampo })}
        />
        <div class="fila">
          <Boton tipo="submit" ocupado={accion.ocupado} motivo={texto.trim() === '' ? 'Escriba el nuevo valor' : undefined}>Guardar valor manual</Boton>
          {m.manual !== null && (
            <BotonConfirmado
              texto="Volver al del banco central"
              pregunta={`¿Volver al tipo de cambio del banco central en ${nombre}?`}
              resumen="Se deja de usar el valor manual. La caja, el sitio y los recibos usarán el del banco central. Queda anotado en el historial."
              textoConfirmar="Sí, volver al del banco central"
              deshabilitado={accion.ocupado}
              onConfirmar={volver}
            />
          )}
        </div>
      </form>
      {saltoPendiente !== null && (
        <Alerta tipo="info">
          <p>
            {base === null
              ? `El valor ${numero(saltoPendiente)} cambia más del 5 % respecto del vigente.`
              : `El valor ${numero(saltoPendiente)} cambia más del 5 % respecto del vigente (${numero(base)}). ¿Es correcto?`}
          </p>
          <div class="fila">
            <Boton ocupado={accion.ocupado} onClick={() => guardar(saltoPendiente, true)}>Sí, guardar este valor</Boton>
            <Boton variante="secundario" deshabilitado={accion.ocupado} onClick={() => setSaltoPendiente(null)}>Cancelar</Boton>
          </div>
        </Alerta>
      )}
      {accion.error && <Alerta>{accion.error}</Alerta>}

      <Tabla
        titulo={`Historial de ${nombre}`}
        vistaCelular="tarjetas"
        filas={m.historial}
        clave={(h) => `${h.actualizadoEn ?? ''}-${h.accion}-${h.valor ?? ''}-${h.por}`}
        vacio={{ titulo: 'Todavía no hay cambios manuales' }}
        porPagina={10}
        columnas={[
          { id: 'cuando', titulo: 'Cuándo', valor: (h) => h.actualizadoEn ?? '', encabezadoFila: true, celda: (h) => (h.actualizadoEn === null ? 'Sin fecha' : fechaHora(h.actualizadoEn)) },
          { id: 'accion', titulo: 'Qué se hizo', valor: (h) => h.accion, celda: (h) => (h.accion === 'quitar' ? 'Volvió al del banco central' : 'Cargó un valor manual') },
          { id: 'valor', titulo: 'Valor', numerica: true, valor: (h) => h.valor ?? 0, celda: (h) => (h.valor === null ? '—' : numero(h.valor)) },
          { id: 'antes', titulo: 'Antes', numerica: true, valor: (h) => h.antes ?? 0, celda: (h) => (h.antes === null ? '—' : numero(h.antes)) },
          { id: 'por', titulo: 'Quién', valor: (h) => h.por, celda: (h) => h.por },
        ]}
      />
    </Seccion>
  );
}

export function PantallaTipoCambio(): JSX.Element {
  const { api } = useApp();
  const carga = useCarga(() => api.llamar('verTipoCambio', {}), []);
  return (
    <div>
      <h1>Tipo de cambio</h1>
      <p class="texto-suave">El valor del banco central se actualiza solo. Si carga uno manual, ese manda en todo el negocio (caja, sitio, recibos y WhatsApp) y no vence, hasta que cargue otro o vuelva al del banco central.</p>
      {carga.cargando && carga.datos === undefined && <Cargando />}
      {carga.error && <ErrorCarga error={carga.error} reintentar={carga.recargar} />}
      {carga.datos?.length === 0 && <Alerta tipo="info">Este negocio no tiene mercados con tipo de cambio.</Alerta>}
      {carga.datos?.map((m) => <TarjetaMercado key={m.mercado} m={m} api={api} recargar={carga.recargar} />)}
    </div>
  );
}
