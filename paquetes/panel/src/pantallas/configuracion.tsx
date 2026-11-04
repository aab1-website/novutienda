import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { MEDIOS_PAGO, MONEDAS, type ConfigPos, type MedioPago, type Moneda, type PlantillaRecibo } from '../api/tipos.js';
import { Alerta, Area, Boton, Campo, Cargando, Casilla, ErrorCarga, Pestanas, Selector, Seccion } from '../ui/comun.js';
import { useApp } from '../ui/contexto.js';
import { useAccion, useCarga } from '../ui/hooks.js';

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
  const accion = useAccion();
  const [c, setC] = useState<ConfigPos | null>(null);
  const [topes, setTopes] = useState({ caj: '', sup: '', adm: '' });
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (cfg.datos !== undefined) {
      setC(cfg.datos);
      setTopes({ caj: bpAPorciento(cfg.datos.topesDescuentoBp.caj), sup: bpAPorciento(cfg.datos.topesDescuentoBp.sup), adm: bpAPorciento(cfg.datos.topesDescuentoBp.adm) });
    }
  }, [cfg.datos]);
  if (cfg.cargando || c === null) return cfg.error ? <ErrorCarga error={cfg.error} reintentar={cfg.recargar} /> : <Cargando />;

  const bp = { caj: porcientoABp(topes.caj), sup: porcientoABp(topes.sup), adm: porcientoABp(topes.adm) };
  const topesOk = bp.caj !== null && bp.sup !== null && bp.adm !== null;
  const guardar = (e: Event): void => {
    e.preventDefault();
    if (!topesOk) return;
    const n = c.negocio;
    const config: ConfigPos = {
      negocio: { nombre: n.nombre.trim(), ...(opc(n.direccion ?? '') ? { direccion: opc(n.direccion ?? '') as string } : {}), ...(opc(n.telefono ?? '') ? { telefono: opc(n.telefono ?? '') as string } : {}), ...(opc(n.nit ?? '') ? { nit: opc(n.nit ?? '') as string } : {}) },
      ...(opc(c.logoUrl ?? '') ? { logoUrl: opc(c.logoUrl ?? '') as string } : {}),
      colores: c.colores, mediosHabilitados: c.mediosHabilitados, monedaPorDefecto: c.monedaPorDefecto,
      topesDescuentoBp: { caj: bp.caj as number, sup: bp.sup as number, adm: bp.adm as number }, textoRecibo: c.textoRecibo, serieRecibo: c.serieRecibo.trim().toUpperCase(),
    };
    void accion.ejecutar(async () => {
      await api.llamar('guardarConfigPos', { config });
      setOk(true);
    });
  };
  const cambiarNegocio = (k: keyof ConfigPos['negocio'], v: string): void => { setOk(false); setC({ ...c, negocio: { ...c.negocio, [k]: v } }); };
  const alternarMedio = (m: MedioPago, v: boolean): void => { setOk(false); setC({ ...c, mediosHabilitados: v ? [...c.mediosHabilitados, m] : c.mediosHabilitados.filter((x) => x !== m) }); };

  return (
    <Seccion titulo="Datos del negocio y del POS">
      <form class="formulario" onSubmit={guardar} noValidate>
        <div class="cuadricula">
          <Campo etiqueta="Nombre del negocio" valor={c.negocio.nombre} onInput={(v) => cambiarNegocio('nombre', v)} requerido />
          <Campo etiqueta="Dirección" valor={c.negocio.direccion ?? ''} onInput={(v) => cambiarNegocio('direccion', v)} />
          <Campo etiqueta="Teléfono" valor={c.negocio.telefono ?? ''} onInput={(v) => cambiarNegocio('telefono', v)} />
          <Campo etiqueta="NIT" valor={c.negocio.nit ?? ''} onInput={(v) => cambiarNegocio('nit', v)} />
          <Campo etiqueta="Dirección web del logo (https)" valor={c.logoUrl ?? ''} onInput={(v) => { setOk(false); setC({ ...c, logoUrl: v }); }} />
          <Campo etiqueta="Color primario" tipo="color" valor={c.colores.primario} onInput={(v) => setC({ ...c, colores: { ...c.colores, primario: v } })} />
          <Campo etiqueta="Color secundario" tipo="color" valor={c.colores.secundario} onInput={(v) => setC({ ...c, colores: { ...c.colores, secundario: v } })} />
          <Selector etiqueta="Moneda por defecto" valor={c.monedaPorDefecto} onCambio={(v) => setC({ ...c, monedaPorDefecto: v as Moneda })} opciones={MONEDAS.map((m) => ({ valor: m, texto: m }))} />
          <Campo etiqueta="Serie del recibo" valor={c.serieRecibo} onInput={(v) => setC({ ...c, serieRecibo: v })} maxLength={6} ayuda="1 a 6 letras mayúsculas o dígitos. Se define solo aquí." />
        </div>
        <fieldset>
          <legend>Medios de pago habilitados</legend>
          {MEDIOS_PAGO.map((m) => <Casilla key={m} etiqueta={MEDIO_TEXTO[m]} marcado={c.mediosHabilitados.includes(m)} onCambio={(v) => alternarMedio(m, v)} />)}
        </fieldset>
        <fieldset>
          <legend>Tope de descuento sin aprobación (% del subtotal)</legend>
          <div class="cuadricula">
            <Campo etiqueta="Vendedor" valor={topes.caj} onInput={(v) => { setOk(false); setTopes({ ...topes, caj: v }); }} inputMode="decimal" ayuda="Decisión vigente: 5 %." />
            <Campo etiqueta="Supervisor" valor={topes.sup} onInput={(v) => { setOk(false); setTopes({ ...topes, sup: v }); }} inputMode="decimal" />
            <Campo etiqueta="Administrador" valor={topes.adm} onInput={(v) => { setOk(false); setTopes({ ...topes, adm: v }); }} inputMode="decimal" />
          </div>
        </fieldset>
        <Area etiqueta="Texto del recibo" valor={c.textoRecibo} onInput={(v) => { setOk(false); setC({ ...c, textoRecibo: v }); }} />
        {!topesOk && <Alerta>Los topes de descuento deben estar entre 0 y 100.</Alerta>}
        {c.mediosHabilitados.length === 0 && <Alerta>Habilite al menos un medio de pago.</Alerta>}
        {accion.error && <Alerta>{accion.error}</Alerta>}
        {ok && <Alerta tipo="ok">Configuración guardada.</Alerta>}
        <Boton tipo="submit" ocupado={accion.ocupado} deshabilitado={!topesOk || c.mediosHabilitados.length === 0 || c.negocio.nombre.trim() === ''}>
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
  const [p, setP] = useState<PlantillaRecibo | null>(null);
  const [ok, setOk] = useState(false);
  useEffect(() => { if (pl.datos !== undefined) setP(pl.datos); }, [pl.datos]);
  if (pl.cargando || p === null) return pl.error ? <ErrorCarga error={pl.error} reintentar={pl.recargar} /> : <Cargando />;
  const n = p.negocio;
  const cambiarNegocio = (k: keyof PlantillaRecibo['negocio'], v: string): void => { setOk(false); setP({ ...p, negocio: { ...n, [k]: v } }); };
  const guardar = (e: Event): void => {
    e.preventDefault();
    const plantilla: PlantillaRecibo = {
      negocio: { nombre: n.nombre.trim(), ...(opc(n.direccion ?? '') ? { direccion: opc(n.direccion ?? '') as string } : {}), ...(opc(n.telefono ?? '') ? { telefono: opc(n.telefono ?? '') as string } : {}), ...(opc(n.nit ?? '') ? { nit: opc(n.nit ?? '') as string } : {}) },
      ...(opc(p.logoUrl ?? '') ? { logoUrl: opc(p.logoUrl ?? '') as string } : {}), ...(opc(p.pie ?? '') ? { pie: opc(p.pie ?? '') as string } : {}),
      ...(opc(p.politicaGarantia ?? '') ? { politicaGarantia: opc(p.politicaGarantia ?? '') as string } : {}), ...(opc(p.politicaCambios ?? '') ? { politicaCambios: opc(p.politicaCambios ?? '') as string } : {}),
    };
    void accion.ejecutar(async () => { await api.llamar('guardarPlantilla', { plantilla }); setOk(true); });
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
          <Campo etiqueta="Dirección web del logo (https)" valor={p.logoUrl ?? ''} onInput={(v) => { setOk(false); setP({ ...p, logoUrl: v }); }} />
        </div>
        <Area etiqueta="Pie de página" valor={p.pie ?? ''} onInput={(v) => { setOk(false); setP({ ...p, pie: v }); }} />
        <Area etiqueta="Política de garantía" valor={p.politicaGarantia ?? ''} onInput={(v) => { setOk(false); setP({ ...p, politicaGarantia: v }); }} />
        <Area etiqueta="Política de cambios" valor={p.politicaCambios ?? ''} onInput={(v) => { setOk(false); setP({ ...p, politicaCambios: v }); }} />
        {accion.error && <Alerta>{accion.error}</Alerta>}
        {ok && <Alerta tipo="ok">Plantilla guardada.</Alerta>}
        <Boton tipo="submit" ocupado={accion.ocupado} deshabilitado={n.nombre.trim() === ''}>Guardar plantilla</Boton>
      </form>
    </Seccion>
  );
}

export function PantallaConfiguracion({ sub }: { sub: string }): JSX.Element {
  const actual = sub === 'recibo' ? 'recibo' : 'negocio';
  return (
    <div>
      <h1>Configuración</h1>
      <Pestanas etiqueta="Configuración" base="configuracion" actual={actual} items={[{ id: 'negocio', titulo: 'Negocio y POS' }, { id: 'recibo', titulo: 'Plantilla del recibo' }]} />
      {actual === 'negocio' ? <ConfigPosForm /> : <PlantillaForm />}
    </div>
  );
}
