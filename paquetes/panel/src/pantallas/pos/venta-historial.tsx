import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { VentaPos } from '../../api/tipos.js';
import { usePaginado } from './paginado.js';
import type { CursorVenta } from '../../api/tipos.js';
import { Alerta, Boton, Campo, Cargando, ErrorCarga, Seccion, fechaHora } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { Dialogo } from '../../ui/dialogo.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { Tabla } from '../../ui/tabla.js';
import { formatearMonto } from '../../util/dinero.js';
import { ReciboVista } from '../recibos/recibo-vista.js';

const numeroDe = (v: VentaPos): string => `${v.serie}-${String(v.receiptNo).padStart(6, '0')}`;
const estadoDe = (v: VentaPos): string => (v.estado === 'anulada' ? 'Anulada' : v.solicitudAnulacion ? 'Anulación solicitada' : 'Confirmada');

function DialogoRecibo({ v, alCerrar }: { v: VentaPos; alCerrar: () => void }): JSX.Element {
  const { api, usuario } = useApp();
  const r = useCarga(() => api.llamar('obtenerRecibo', { ventaId: v.ventaId }), [v.ventaId]);
  return (
    <Dialogo titulo={`Recibo ${numeroDe(v)}`} variante="lateral" foco="cerrar" onCerrar={alCerrar}>
      {r.cargando && <Cargando texto="Cargando el recibo…" />}
      {r.error && <ErrorCarga error={r.error} reintentar={r.recargar} />}
      {!r.cargando && !r.error && r.datos === null && <Alerta tipo="info">Esta venta todavía no tiene recibo emitido. Pruebe de nuevo en unos instantes.</Alerta>}
      {r.datos && <ReciboVista recibo={r.datos} registradoPor={{ qr: usuario.correo }} />}
    </Dialogo>
  );
}

function DialogoAnulacion({ v, alCerrar, alSolicitar }: { v: VentaPos; alCerrar: () => void; alSolicitar: () => void }): JSX.Element {
  const { api, usuario } = useApp();
  const accion = useAccion();
  const [motivo, setMotivo] = useState('');
  const solicitar = (): void => {
    if (motivo.trim() === '') return;
    void accion
      .ejecutar(async () => {
        await api.llamar('solicitarAnulacion', { ventaId: v.ventaId, motivo: motivo.trim() });
        return true;
      }, { exito: `Anulación de ${numeroDe(v)} solicitada.`, error: 'local' })
      .then((ok) => {
        if (ok === true) alSolicitar();
      });
  };
  return (
    <Dialogo
      titulo={`Solicitar la anulación de ${numeroDe(v)}`}
      variante="centro"
      descripcion={usuario.rol === 'caj' ? 'La aprobará un supervisor o administrador.' : 'La aprobará otra persona (supervisor o administrador).'}
      sucio={motivo.trim() !== ''}
      onCerrar={alCerrar}
      pie={
        <>
          <Boton variante="secundario" onClick={alCerrar}>Cancelar</Boton>
          <Boton variante="peligro" onClick={solicitar} ocupado={accion.ocupado} motivo={motivo.trim() === '' ? 'Escriba el motivo de la anulación.' : undefined}>Enviar solicitud</Boton>
        </>
      }
    >
      <form class="formulario" onSubmit={(e) => { e.preventDefault(); solicitar(); }} noValidate>
        <p>Total {formatearMonto(v.total, v.moneda)} · {fechaHora(v.creadoEnMs)}</p>
        <Campo etiqueta="Motivo de la anulación" valor={motivo} onInput={setMotivo} requerido />
        {accion.error && <Alerta>{accion.error}</Alerta>}
      </form>
    </Dialogo>
  );
}

export function VentaHistorial(): JSX.Element {
  const { api, usuario } = useApp();
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const rangoMalo = desde !== '' && hasta !== '' && desde > hasta;
  // De a 50 ventas, la más reciente primero; «Cargar más» pide las siguientes con el cursor del servidor.
  const ventas = usePaginado<VentaPos, CursorVenta>(async (cursor) => {
    const r = await api.llamar('misVentas', {
      ...(rangoMalo ? {} : { ...(desde !== '' ? { desde } : {}), ...(hasta !== '' ? { hasta } : {}) }),
      ...(cursor !== undefined ? { despuesDe: cursor } : {}),
    });
    return { filas: r.ventas, siguiente: r.siguiente };
  }, [desde, hasta, rangoMalo]);
  const [verRecibo, setVerRecibo] = useState<VentaPos | null>(null);
  const [anular, setAnular] = useState<VentaPos | null>(null);
  const filas = ventas.filas;
  return (
    <Seccion titulo={usuario.rol === 'caj' ? 'Mis ventas' : 'Ventas'}>
      <div class="cuadricula">
        <Campo etiqueta="Ventas desde" tipo="date" valor={desde} onInput={setDesde} />
        <Campo etiqueta="Ventas hasta" tipo="date" valor={hasta} onInput={setHasta} ayuda="Sin fechas se muestran las más recientes." />
      </div>
      {rangoMalo && <Alerta>La fecha Desde no puede ser posterior a Hasta.</Alerta>}
      {ventas.cargando && <Cargando />}
      {ventas.error && <ErrorCarga error={ventas.error} reintentar={ventas.recargar} />}
      {!ventas.cargando && !ventas.error && (
        <Tabla
          titulo="Ventas registradas"
          filas={filas}
          clave={(v) => v.ventaId}
          vacio={{ titulo: desde !== '' || hasta !== '' ? 'No hay ventas en esas fechas' : 'Todavía no hay ventas' }}
          buscar={{ etiqueta: 'Buscar por número de recibo', en: (v) => [numeroDe(v)] }}
          columnas={[
            { id: 'recibo', titulo: 'Recibo', valor: numeroDe, encabezadoFila: true },
            { id: 'fecha', titulo: 'Fecha', valor: (v) => v.creadoEnMs, celda: (v) => fechaHora(v.creadoEnMs), ordenable: true },
            { id: 'total', titulo: 'Total', valor: (v) => `${v.moneda}-${String(v.total).padStart(15, '0')}`, celda: (v) => formatearMonto(v.total, v.moneda), ordenable: true },
            { id: 'estado', titulo: 'Estado', valor: estadoDe },
            { id: 'anulacion', titulo: 'Anulación', valor: (v) => (v.solicitudAnulacion && v.estado === 'confirmada' ? `Motivo: ${v.solicitudAnulacion.motivo}` : '') },
          ]}
          acciones={(v) => (
            <div class="fila">
              <Boton chico variante="secundario" onClick={() => setVerRecibo(v)} etiqueta={`Ver recibo ${numeroDe(v)}`}>Ver recibo</Boton>
              {v.estado === 'confirmada' && !v.solicitudAnulacion && (
                <Boton chico variante="secundario" onClick={() => setAnular(v)} etiqueta={`Solicitar anulación de ${numeroDe(v)}`}>Solicitar anulación</Boton>
              )}
            </div>
          )}
        />
      )}
      {ventas.hayMas && <Alerta tipo="info">Busca solo entre las ventas cargadas; use «Cargar más» o acote las fechas.</Alerta>}
      {ventas.errorMas && <Alerta>{ventas.errorMas}</Alerta>}
      {ventas.hayMas && <Boton variante="secundario" onClick={ventas.cargarMas} ocupado={ventas.cargandoMas}>Cargar más</Boton>}
      {verRecibo && <DialogoRecibo v={verRecibo} alCerrar={() => setVerRecibo(null)} />}
      {anular && <DialogoAnulacion v={anular} alCerrar={() => setAnular(null)} alSolicitar={() => { setAnular(null); ventas.recargar(); }} />}
    </Seccion>
  );
}
