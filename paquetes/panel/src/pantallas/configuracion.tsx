import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { MEDIOS_PAGO, type ConfigPos, type MercadoDeclarado, type MedioPago, type PlantillaRecibo } from '../api/tipos.js';
import { Alerta, Area, Boton, Campo, Cargando, Casilla, ErrorCarga, Pestanas, Selector, Seccion } from '../ui/comun.js';
import { useAvisos } from '../ui/avisos.js';
import { useApp } from '../ui/contexto.js';
import { useCambiosSinGuardar } from '../ui/guardia.js';
import { useAccion, useCarga } from '../ui/hooks.js';
import { useConfiguracionComercial } from '../ui/comercial.js';
import { Tabla } from '../ui/tabla.js';

const MEDIO_TEXTO: Record<MedioPago, string> = { efectivo: 'Efectivo', qr: 'QR', transferencia: 'Transferencia', credito: 'Crédito' };
const bpAPorciento = (bp: number): string => String(bp / 100).replace('.', ',');
const porcientoABp = (t: string): number | null => {
  const n = Number(t.trim().replace(',', '.'));
  return t.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) : null;
};
const opc = (t: string): string | undefined => (t.trim() === '' ? undefined : t.trim());

function ConfigPosForm(): JSX.Element {
  const { api } = useApp();
  const cfg = useCarga(() => api.llamar('leerConfigPos', {}), []);
  const comercial = useConfiguracionComercial();
  const accion = useAccion();
  const avisos = useAvisos();
  const [c, setC] = useState<ConfigPos | null>(null);
  const [topes, setTopes] = useState({ caj: '', sup: '', adm: '' });
  // Lo último cargado o guardado: lo que difiera de esto es «cambios sin guardar».
  const [base, setBase] = useState<string | null>(null);
  const avisoGuardado = useRef(0);
  useEffect(() => {
    if (cfg.datos !== undefined) {
      const t = { caj: bpAPorciento(cfg.datos.topesDescuentoBp.caj), sup: bpAPorciento(cfg.datos.topesDescuentoBp.sup), adm: bpAPorciento(cfg.datos.topesDescuentoBp.adm) };
      setC(cfg.datos);
      setTopes(t);
      setBase(JSON.stringify([cfg.datos, t]));
    }
  }, [cfg.datos]);
  const sucio = c !== null && base !== null && JSON.stringify([c, topes]) !== base;
  const { marcarGuardado } = useCambiosSinGuardar(sucio);
  if (cfg.cargando || c === null) return cfg.error ? <ErrorCarga error={cfg.error} reintentar={cfg.recargar} /> : <Cargando />;

  // Las monedas de cobro son las que declara el comercio; sin su configuración solo se ofrece la vigente (no se inventan).
  const monedas = comercial.estado === 'lista' ? comercial.comercial.monedasCaja : [c.monedaPorDefecto];
  const bp = { caj: porcientoABp(topes.caj), sup: porcientoABp(topes.sup), adm: porcientoABp(topes.adm) };
  const topesOk = bp.caj !== null && bp.sup !== null && bp.adm !== null;
  const guardar = (e: Event): void => {
    e.preventDefault();
    // El botón ya lo impide; el envío por teclado (Enter) también se valida aquí.
    if (!topesOk || c.mediosHabilitados.length === 0 || c.negocio.nombre.trim() === '') return;
    const n = c.negocio;
    const config: ConfigPos = {
      negocio: { nombre: n.nombre.trim(), ...(opc(n.direccion ?? '') ? { direccion: opc(n.direccion ?? '') as string } : {}), ...(opc(n.telefono ?? '') ? { telefono: opc(n.telefono ?? '') as string } : {}), ...(opc(n.nit ?? '') ? { nit: opc(n.nit ?? '') as string } : {}) },
      ...(opc(c.logoUrl ?? '') ? { logoUrl: opc(c.logoUrl ?? '') as string } : {}),
      colores: c.colores, mediosHabilitados: c.mediosHabilitados, monedaPorDefecto: c.monedaPorDefecto,
      topesDescuentoBp: { caj: bp.caj as number, sup: bp.sup as number, adm: bp.adm as number }, textoRecibo: c.textoRecibo, serieRecibo: c.serieRecibo.trim().toUpperCase(),
    };
    const enviado = JSON.stringify([c, topes]);
    void accion.ejecutar(async () => {
      await api.llamar('guardarConfigPos', { config });
      marcarGuardado();
      setBase(enviado);
      avisoGuardado.current = avisos.ok('Configuración guardada.');
    }, { error: 'ambos' });
  };
  // Al cambiar algo, el «guardado» anterior ya no describe lo que se ve: se retira.
  const editado = (): void => {
    if (avisoGuardado.current !== 0) avisos.cerrar(avisoGuardado.current);
    avisoGuardado.current = 0;
  };
  const poner = (nuevo: ConfigPos): void => { editado(); setC(nuevo); };
  const ponerTopes = (nuevo: typeof topes): void => { editado(); setTopes(nuevo); };
  const cambiarNegocio = (k: keyof ConfigPos['negocio'], v: string): void => poner({ ...c, negocio: { ...c.negocio, [k]: v } });
  const alternarMedio = (m: MedioPago, v: boolean): void => poner({ ...c, mediosHabilitados: v ? [...c.mediosHabilitados, m] : c.mediosHabilitados.filter((x) => x !== m) });
  const motivo = !topesOk
    ? 'Los topes de descuento deben estar entre 0 y 100'
    : c.mediosHabilitados.length === 0
      ? 'Habilite al menos un medio de pago'
      : c.negocio.nombre.trim() === ''
        ? 'Escriba el nombre del negocio'
        : undefined;

  return (
    <Seccion titulo="Datos del negocio y del POS">
      <form class="formulario" onSubmit={guardar} noValidate>
        <div class="cuadricula">
          <Campo etiqueta="Nombre del negocio" valor={c.negocio.nombre} onInput={(v) => cambiarNegocio('nombre', v)} requerido />
          <Campo etiqueta="Dirección" valor={c.negocio.direccion ?? ''} onInput={(v) => cambiarNegocio('direccion', v)} />
          <Campo etiqueta="Teléfono" valor={c.negocio.telefono ?? ''} onInput={(v) => cambiarNegocio('telefono', v)} />
          <Campo etiqueta="NIT" valor={c.negocio.nit ?? ''} onInput={(v) => cambiarNegocio('nit', v)} />
          <Campo etiqueta="Dirección web del logo (https)" valor={c.logoUrl ?? ''} onInput={(v) => poner({ ...c, logoUrl: v })} />
          <Campo etiqueta="Color primario" tipo="color" valor={c.colores.primario} onInput={(v) => poner({ ...c, colores: { ...c.colores, primario: v } })} ayuda="Color de su negocio en el punto de venta." />
          <Campo etiqueta="Color secundario" tipo="color" valor={c.colores.secundario} onInput={(v) => poner({ ...c, colores: { ...c.colores, secundario: v } })} ayuda="Color de apoyo de su negocio en el punto de venta." />
          <Selector etiqueta="Moneda por defecto" valor={c.monedaPorDefecto} onCambio={(v) => poner({ ...c, monedaPorDefecto: v })} deshabilitado={comercial.estado !== 'lista'} opciones={monedas.map((m) => ({ valor: m, texto: m }))} />
          <Campo etiqueta="Serie del recibo" valor={c.serieRecibo} onInput={(v) => poner({ ...c, serieRecibo: v })} maxLength={6} ayuda="1 a 6 letras mayúsculas o dígitos. Se define solo aquí." />
        </div>
        <fieldset>
          <legend>Medios de pago habilitados</legend>
          {MEDIOS_PAGO.map((m) => <Casilla key={m} etiqueta={MEDIO_TEXTO[m]} marcado={c.mediosHabilitados.includes(m)} onCambio={(v) => alternarMedio(m, v)} />)}
        </fieldset>
        <fieldset>
          <legend>Tope de descuento sin aprobación (% del subtotal)</legend>
          <div class="cuadricula">
            <Campo etiqueta="Vendedor" valor={topes.caj} onInput={(v) => ponerTopes({ ...topes, caj: v })} inputMode="decimal" ayuda="Porcentaje máximo que puede dar sin pedir aprobación." />
            <Campo etiqueta="Supervisor" valor={topes.sup} onInput={(v) => ponerTopes({ ...topes, sup: v })} inputMode="decimal" />
            <Campo etiqueta="Administrador" valor={topes.adm} onInput={(v) => ponerTopes({ ...topes, adm: v })} inputMode="decimal" />
          </div>
        </fieldset>
        <Area etiqueta="Texto del recibo" valor={c.textoRecibo} onInput={(v) => poner({ ...c, textoRecibo: v })} />
        {accion.error && <Alerta>{accion.error}</Alerta>}
        <Boton tipo="submit" ocupado={accion.ocupado} motivo={motivo}>
          Guardar configuración
        </Boton>
      </form>
    </Seccion>
  );
}

function PlantillaForm(): JSX.Element {
  const { api } = useApp();
  const pl = useCarga(() => api.llamar('leerPlantilla', {}), []);
  const accion = useAccion();
  const avisos = useAvisos();
  const [p, setP] = useState<PlantillaRecibo | null>(null);
  const [base, setBase] = useState<string | null>(null);
  const avisoGuardado = useRef(0);
  useEffect(() => { if (pl.datos !== undefined) { setP(pl.datos); setBase(JSON.stringify(pl.datos)); } }, [pl.datos]);
  const sucio = p !== null && base !== null && JSON.stringify(p) !== base;
  const { marcarGuardado } = useCambiosSinGuardar(sucio);
  if (pl.cargando || p === null) return pl.error ? <ErrorCarga error={pl.error} reintentar={pl.recargar} /> : <Cargando />;
  const n = p.negocio;
  const poner = (nueva: PlantillaRecibo): void => {
    if (avisoGuardado.current !== 0) avisos.cerrar(avisoGuardado.current);
    avisoGuardado.current = 0;
    setP(nueva);
  };
  const cambiarNegocio = (k: keyof PlantillaRecibo['negocio'], v: string): void => poner({ ...p, negocio: { ...n, [k]: v } });
  const guardar = (e: Event): void => {
    e.preventDefault();
    if (n.nombre.trim() === '') return;
    const plantilla: PlantillaRecibo = {
      negocio: { nombre: n.nombre.trim(), ...(opc(n.direccion ?? '') ? { direccion: opc(n.direccion ?? '') as string } : {}), ...(opc(n.telefono ?? '') ? { telefono: opc(n.telefono ?? '') as string } : {}), ...(opc(n.nit ?? '') ? { nit: opc(n.nit ?? '') as string } : {}) },
      ...(opc(p.logoUrl ?? '') ? { logoUrl: opc(p.logoUrl ?? '') as string } : {}), ...(opc(p.pie ?? '') ? { pie: opc(p.pie ?? '') as string } : {}),
      ...(opc(p.politicaGarantia ?? '') ? { politicaGarantia: opc(p.politicaGarantia ?? '') as string } : {}), ...(opc(p.politicaCambios ?? '') ? { politicaCambios: opc(p.politicaCambios ?? '') as string } : {}),
    };
    const enviado = JSON.stringify(p);
    void accion.ejecutar(async () => {
      await api.llamar('guardarPlantilla', { plantilla });
      marcarGuardado();
      setBase(enviado);
      avisoGuardado.current = avisos.ok('Plantilla guardada.');
    }, { error: 'ambos' });
  };
  return (
    <Seccion titulo="Plantilla del recibo">
      <p class="texto-suave">Los recibos ya emitidos conservan la plantilla que tenían al emitirse. La serie y la numeración se definen en la configuración del POS.</p>
      <form class="formulario" onSubmit={guardar} noValidate>
        <div class="cuadricula">
          <Campo etiqueta="Nombre del negocio" valor={n.nombre} onInput={(v) => cambiarNegocio('nombre', v)} requerido />
          <Campo etiqueta="Dirección" valor={n.direccion ?? ''} onInput={(v) => cambiarNegocio('direccion', v)} />
          <Campo etiqueta="Teléfono" valor={n.telefono ?? ''} onInput={(v) => cambiarNegocio('telefono', v)} />
          <Campo etiqueta="NIT" valor={n.nit ?? ''} onInput={(v) => cambiarNegocio('nit', v)} />
          <Campo etiqueta="Dirección web del logo (https)" valor={p.logoUrl ?? ''} onInput={(v) => poner({ ...p, logoUrl: v })} />
        </div>
        <Area etiqueta="Pie de página" valor={p.pie ?? ''} onInput={(v) => poner({ ...p, pie: v })} />
        <Area etiqueta="Política de garantía" valor={p.politicaGarantia ?? ''} onInput={(v) => poner({ ...p, politicaGarantia: v })} />
        <Area etiqueta="Política de cambios" valor={p.politicaCambios ?? ''} onInput={(v) => poner({ ...p, politicaCambios: v })} />
        {accion.error && <Alerta>{accion.error}</Alerta>}
        <Boton tipo="submit" ocupado={accion.ocupado} motivo={n.nombre.trim() === '' ? 'Escriba el nombre del negocio' : undefined}>Guardar plantilla</Boton>
      </form>
    </Seccion>
  );
}

const TEXTO_CAMBIO = (m: MercadoDeclarado): string => (m.tieneTipoCambio ? `Sí (${m.monedaVenta}/${m.monedaBase})` : 'No: el precio base es el precio');

/** Mercados y monedas del comercio, solo lectura: los define el operador de la plataforma, no se editan aquí. */
function MercadosYMonedas(): JSX.Element {
  const c = useConfiguracionComercial();
  return (
    <Seccion titulo="Mercados y monedas">
      <p class="texto-suave">Solo lectura. Los mercados y las monedas los define el operador de la plataforma; para cambiarlos, solicítelo a él.</p>
      {c.estado === 'cargando' && <Cargando />}
      {c.estado === 'error' && <Alerta>{`No se pudieron cargar los mercados y monedas. ${c.mensaje}`}</Alerta>}
      {c.estado === 'lista' && (
        <>
          <Tabla
            titulo="Mercados del comercio"
            filas={c.comercial.mercados}
            clave={(m) => m.id}
            vacio={{ titulo: 'No hay mercados declarados' }}
            columnas={[
              { id: 'mercado', titulo: 'Mercado', valor: (m) => m.nombre, encabezadoFila: true },
              { id: 'venta', titulo: 'Moneda de venta', valor: (m) => m.monedaVenta },
              { id: 'base', titulo: 'Moneda base del precio', valor: (m) => m.monedaBase },
              { id: 'cambio', titulo: 'Tipo de cambio', valor: TEXTO_CAMBIO },
            ]}
          />
          <p>Monedas de cobro en caja: {c.comercial.monedasCaja.join(', ')}.</p>
          {c.comercial.monedaCosto !== undefined && <p>Moneda del costo: {c.comercial.monedaCosto}.</p>}
        </>
      )}
    </Seccion>
  );
}

export function PantallaConfiguracion({ sub }: { sub: string }): JSX.Element {
  const actual = sub === 'recibo' ? 'recibo' : 'negocio';
  return (
    <div>
      <h1>Configuración</h1>
      <Pestanas etiqueta="Configuración" base="configuracion" actual={actual} items={[{ id: 'negocio', titulo: 'Negocio y POS' }, { id: 'recibo', titulo: 'Plantilla del recibo' }]} />
      {actual === 'negocio' ? (
        <>
          <ConfigPosForm />
          <MercadosYMonedas />
        </>
      ) : (
        <PlantillaForm />
      )}
    </div>
  );
}
