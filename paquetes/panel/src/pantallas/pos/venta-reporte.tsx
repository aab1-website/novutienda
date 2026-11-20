import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { VentaPos } from '../../api/tipos.js';
import { Alerta, Boton, Cargando, Dato, ErrorCarga, Seccion, fechaHora } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { useCarga } from '../../ui/hooks.js';
import { formatearMonto } from '../../util/dinero.js';
import { usePaginado } from './paginado.js';
import type { CursorTurno, CursorVenta, FilaTurnoVista, MontosPorMedioVista, ResumenMonedaVista, ResumenTurnoVista } from '../../api/tipos.js';

/** El turno en curso se actualiza solo cada 60 segundos mientras la pestaña está a la vista. */
export const MS_ACTUALIZAR_TURNO = 60_000;

const NOMBRE_MONEDA: Readonly<Record<string, string>> = { BOB: 'Bolivianos', USD: 'Dólares', ARS: 'Pesos argentinos' };
const MEDIOS: readonly (readonly [keyof MontosPorMedioVista, string])[] = [
  ['efectivo', 'En efectivo'],
  ['qr', 'Con QR'],
  ['transferencia', 'Por transferencia'],
  ['credito', 'A crédito'],
];
/** «Mi reporte» muestra solo lo propio: sup y adm podrían ver todo, así que envían su uid (el servidor ya limita al vendedor). */
const soloLoPropio = (u: { readonly uid: string }): { cajeroUid: string } => ({ cajeroUid: u.uid });
const numeroDe = (v: VentaPos): string => `${v.serie}-${String(v.receiptNo).padStart(6, '0')}`;
const veces = (n: number, uno: string, varias: string): string => `${n} ${n === 1 ? uno : varias}`;

/** Resumen de una moneda en lenguaje simple. Los montos de «Cobrado» ya descuentan el cambio y lo devuelto por anulaciones. */
function ResumenMoneda({ moneda, r }: { moneda: string; r: ResumenMonedaVista }): JSX.Element {
  const m = (c: number): string => formatearMonto(c, moneda);
  const devuelto = MEDIOS.filter(([k]) => r.reembolsos[k] > 0);
  return (
    <section class="reporte-moneda" aria-label={`Resumen en ${NOMBRE_MONEDA[moneda] ?? moneda}`}>
      <h3>{NOMBRE_MONEDA[moneda] ?? moneda}</h3>
      <dl class="datos">
        <Dato etiqueta="Ventas realizadas">{r.ventas}</Dato>
        <Dato etiqueta="Vendido antes de descuentos">{m(r.bruto)}</Dato>
        <Dato etiqueta="Descuentos">{r.descuentos.cantidad === 0 ? 'Ninguno' : `${m(r.descuentos.monto)} en ${veces(r.descuentos.cantidad, 'venta', 'ventas')}`}</Dato>
        <Dato etiqueta="Total vendido">{m(r.neto)}</Dato>
        {MEDIOS.map(([k, texto]) => <Dato key={k} etiqueta={`${k === 'credito' ? 'Vendido' : 'Cobrado'} ${texto.toLowerCase()}`}>{m(r.porMedio[k])}</Dato>)}
        <Dato etiqueta="Ventas anuladas">{r.anuladas.cantidad === 0 ? 'Ninguna' : `${veces(r.anuladas.cantidad, 'venta', 'ventas')} por ${m(r.anuladas.monto)}`}</Dato>
        <Dato etiqueta="Devuelto por anulaciones">{devuelto.length === 0 ? 'Nada' : devuelto.map(([k, texto]) => `${texto.toLowerCase()}: ${m(r.reembolsos[k])}`).join(' · ')}</Dato>
        <Dato etiqueta="Ingresos excepcionales">{m(r.ingresos)}</Dato>
        <Dato etiqueta="Egresos excepcionales">{m(r.egresos)}</Dato>
      </dl>
      <p class="texto-suave">Lo cobrado incluye cobros de créditos y descuenta lo devuelto en este turno.</p>
    </section>
  );
}

export function ResumenVista({ resumen }: { resumen: ResumenTurnoVista }): JSX.Element {
  if (resumen.monedas.length === 0) return <p class="texto-suave">Este turno todavía no tiene movimientos.</p>;
  return (
    <div>
      {resumen.truncado && <Alerta tipo="info">El turno tiene muchísimas operaciones: las cantidades de ventas, descuentos y anulaciones pueden estar incompletas. Lo cobrado por medio sí es exacto.</Alerta>}
      {resumen.monedas.map((m) => {
        const r = resumen.porMoneda[m];
        return r === undefined ? null : <ResumenMoneda key={m} moneda={m} r={r} />;
      })}
    </div>
  );
}

/** Turno en vivo: se carga al entrar, cada 60 s si la pestaña está visible y con «Actualizar». */
function TurnoActual(): JSX.Element {
  const { api, usuario } = useApp();
  const propio = soloLoPropio(usuario);
  const ultimo = useRef<ResumenTurnoVista | null | undefined>(undefined);
  const r = useCarga(async () => {
    // Con la pestaña oculta no se pide nada: se conserva lo último que se vio.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden' && ultimo.current !== undefined) return ultimo.current;
    ultimo.current = await api.llamar('resumenTurno', propio);
    return ultimo.current;
  }, [], MS_ACTUALIZAR_TURNO);
  return (
    <Seccion titulo="Turno actual" acciones={<Boton chico variante="secundario" onClick={r.recargar}>Actualizar</Boton>}>
      {r.cargando && <Cargando />}
      {r.error && <ErrorCarga error={r.error} reintentar={r.recargar} />}
      {!r.cargando && !r.error && r.datos === null && <p class="texto-suave">No tiene un turno abierto. Abra uno en «Terminal» para ver aquí sus ventas del día.</p>}
      {r.datos && (
        <>
          <p class="texto-suave">Abierto el {fechaHora(r.datos.turno.abiertoEnMs)}. Se actualiza solo cada 60 segundos.</p>
          <ResumenVista resumen={r.datos} />
        </>
      )}
    </Seccion>
  );
}

const ESTADO_TURNO: Readonly<Record<FilaTurnoVista['estado'], string>> = { abierto: 'Abierto', cerrado: 'Cerrado', cerrado_forzado: 'Cerrado por un administrador' };

/** Lo cobrado en el turno por moneda: efectivo, QR y transferencia (el crédito es lo vendido, no lo cobrado), neto de cambio y devoluciones. */
function cobradoTexto(t: FilaTurnoVista): string {
  const partes = Object.entries(t.totales).flatMap(([m, x]) => (x === undefined ? [] : [`${formatearMonto(x.efectivo + x.qr + x.transferencia, m)}`]));
  return partes.length === 0 ? 'Sin cobros' : partes.join(' · ');
}

function VentasDelTurno({ turnoId }: { turnoId: string }): JSX.Element {
  const { api } = useApp();
  const p = usePaginado<VentaPos, CursorVenta>(async (cursor) => {
    const r = await api.llamar('misVentas', { turnoId, ...(cursor !== undefined ? { despuesDe: cursor } : {}) });
    return { filas: r.ventas, siguiente: r.siguiente };
  }, [turnoId]);
  return (
    <div>
      <h3>Ventas del turno</h3>
      {p.cargando && <Cargando />}
      {p.error && <ErrorCarga error={p.error} reintentar={p.recargar} />}
      {!p.cargando && !p.error && p.filas.length === 0 && <p class="texto-suave">Este turno no tuvo ventas.</p>}
      {p.filas.length > 0 && (
        <table class="tabla">
          <caption>Ventas del turno</caption>
          <thead><tr><th scope="col">Recibo</th><th scope="col">Hora</th><th scope="col" class="num">Total</th><th scope="col">Estado</th></tr></thead>
          <tbody>
            {p.filas.map((v) => (
              <tr key={v.ventaId}>
                <th scope="row">{numeroDe(v)}</th>
                <td>{fechaHora(v.creadoEnMs)}</td>
                <td class="num">{formatearMonto(v.total, v.moneda)}</td>
                <td>{v.estado === 'anulada' ? 'Anulada' : 'Confirmada'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {p.errorMas && <Alerta>{p.errorMas}</Alerta>}
      {p.hayMas && <Boton variante="secundario" onClick={p.cargarMas} ocupado={p.cargandoMas}>Cargar más</Boton>}
    </div>
  );
}

function DetalleTurno({ turno, alCerrar }: { turno: FilaTurnoVista; alCerrar: () => void }): JSX.Element {
  const { api, usuario } = useApp();
  const r = useCarga(() => api.llamar('resumenTurno', { turnoId: turno.turnoId, ...soloLoPropio(usuario) }), [turno.turnoId]);
  return (
    <Seccion titulo={`Turno del ${fechaHora(turno.abiertoEnMs)}`} acciones={<Boton chico variante="secundario" onClick={alCerrar}>Cerrar el detalle</Boton>}>
      {r.cargando && <Cargando />}
      {r.error && <ErrorCarga error={r.error} reintentar={r.recargar} />}
      {r.datos && <ResumenVista resumen={r.datos} />}
      <VentasDelTurno turnoId={turno.turnoId} />
    </Seccion>
  );
}

function DiasAnteriores(): JSX.Element {
  const { api, usuario } = useApp();
  const [abierto, setAbierto] = useState<FilaTurnoVista | null>(null);
  const p = usePaginado<FilaTurnoVista, CursorTurno>(async (cursor) => {
    const r = await api.llamar('misTurnos', { ...soloLoPropio(usuario), ...(cursor === undefined ? {} : { despuesDe: cursor }) });
    return { filas: r.turnos, siguiente: r.siguiente };
  }, []);
  // El turno en curso ya se ve arriba.
  const filas = p.filas.filter((t) => t.estado !== 'abierto');
  return (
    <>
      <Seccion titulo="Días anteriores">
        {p.cargando && <Cargando />}
        {p.error && <ErrorCarga error={p.error} reintentar={p.recargar} />}
        {!p.cargando && !p.error && filas.length === 0 && !p.hayMas && <p class="texto-suave">Todavía no tiene turnos cerrados.</p>}
        {filas.length > 0 && (
          <table class="tabla">
            <caption>Turnos anteriores</caption>
            <thead>
              <tr><th scope="col">Apertura</th><th scope="col">Cierre</th><th scope="col">Estado</th><th scope="col">Cobrado</th><th scope="col"><span class="solo-lectores">Detalle</span></th></tr>
            </thead>
            <tbody>
              {filas.map((t) => (
                <tr key={t.turnoId}>
                  <th scope="row">{fechaHora(t.abiertoEnMs)}</th>
                  <td>{t.cerradoEnMs === undefined ? '' : fechaHora(t.cerradoEnMs)}</td>
                  <td>{ESTADO_TURNO[t.estado]}</td>
                  <td>{cobradoTexto(t)}</td>
                  <td>
                    <Boton chico variante="secundario" onClick={() => setAbierto(t)} etiqueta={`Ver turno del ${fechaHora(t.abiertoEnMs)}`}>Ver turno</Boton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {p.errorMas && <Alerta>{p.errorMas}</Alerta>}
        {p.hayMas && <Boton variante="secundario" onClick={p.cargarMas} ocupado={p.cargandoMas}>Cargar más</Boton>}
      </Seccion>
      {abierto && <DetalleTurno turno={abierto} alCerrar={() => setAbierto(null)} />}
    </>
  );
}

/** «Mi reporte»: el turno en vivo y, debajo, los días anteriores. */
export function VentaReporte(): JSX.Element {
  return (
    <div>
      <TurnoActual />
      <DiasAnteriores />
    </div>
  );
}
