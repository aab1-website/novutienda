import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { nuevoId } from '../../api/cliente.js';
import { ErrorApi, mensajeDeError } from '../../api/errores.js';
import type { MermaVista, ProductoPanel, UbicacionId } from '../../api/tipos.js';
import { useAvisos } from '../../ui/avisos.js';
import { Alerta, Boton, Campo, ConCarga, Selector, Seccion, fechaHora } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { Dialogo } from '../../ui/dialogo.js';
import { enfocarPrimerError } from '../../ui/formulario.js';
import { useBorrador, useCambiosSinGuardar } from '../../ui/guardia.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { Tabla } from '../../ui/tabla.js';
import { SelectorProducto } from './movimientos.js';
import { MERMA_INICIAL, MOTIVO_MAX, MOTIVO_RECHAZO_FALTA, ESTADO_TEXTO, OPCIONES_ESTADO, ordenarMermas, resumenResolucion, revisarSolicitud, type BorradorMerma, type FiltroEstado } from './mermas-logica.js';
import { separar } from './movimientos-resumen.js';
import { nombreAlmacen, OPCIONES_ALMACEN } from './nombres.js';
import './inventario.css';

/** Diálogo de aprobar o rechazar una merma. Rechazar exige motivo, junto al campo. */
function ResolverMerma({ merma, producto, decision, alCerrar, alResolver, alProcesar, alCerrarEnfocar }: {
  merma: MermaVista;
  producto: ProductoPanel | undefined;
  decision: 'aprobada' | 'rechazada';
  alCerrar: () => void;
  alResolver: () => void;
  /** Avisa a la fila que su merma se está procesando (o que ya terminó). */
  alProcesar: (procesando: boolean) => void;
  alCerrarEnfocar: () => HTMLElement | null;
}): JSX.Element {
  const { api } = useApp();
  const avisos = useAvisos();
  const accion = useAccion();
  const [motivo, setMotivo] = useState('');
  const [intento, setIntento] = useState(false);
  /** Error de validación del servidor sobre el motivo: va junto al campo, no en la alerta general. */
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);
  // El mismo identificador solo mientras no cambie lo que se envía (un reintento no duplica; otro motivo es otra operación).
  const operacion = useRef<{ firma: string; id: string } | null>(null);
  const rechaza = decision === 'rechazada';
  const falta = rechaza && motivo.trim() === '';
  const nombre = producto?.nombre ?? merma.productoId;
  const confirmar = (): void => {
    setIntento(true);
    if (falta) return;
    const firma = JSON.stringify([merma.mermaId, decision, rechaza ? motivo.trim() : '']);
    if (operacion.current?.firma !== firma) operacion.current = { firma, id: nuevoId() };
    const operacionId = operacion.current.id;
    setErrorMotivo(null);
    alProcesar(true);
    void accion.ejecutar(async () => {
      try {
        await api.llamar('resolverMerma', rechaza ? { operacionId, mermaId: merma.mermaId, decision: 'rechazada', motivo: motivo.trim() } : { operacionId, mermaId: merma.mermaId, decision: 'aprobada' });
      } catch (e) {
        if (!rechaza || !(e instanceof ErrorApi) || e.detalle.codigo !== 'entrada-invalida') throw e;
        setErrorMotivo(mensajeDeError(e));
        return;
      }
      avisos.ok(rechaza ? `Merma de ${nombre} rechazada.` : `Merma de ${nombre} aprobada: el stock ya se descontó.`);
      alResolver();
    }).finally(() => alProcesar(false));
  };
  return (
    <Dialogo
      variante="centro"
      titulo={rechaza ? '¿Rechazar esta merma?' : '¿Aprobar esta merma?'}
      descripcion="Revise antes de confirmar."
      foco={rechaza ? 'campo' : 'seguro'}
      sucio={rechaza && motivo.trim() !== ''}
      onCerrar={alCerrar}
      alCerrarEnfocar={alCerrarEnfocar}
      pie={
        <>
          <button type="button" class="boton boton-secundario" data-seguro onClick={alCerrar}>Volver</button>
          <Boton variante={rechaza ? 'peligro' : 'cta'} onClick={confirmar} ocupado={accion.ocupado}>{rechaza ? 'Sí, rechazar' : 'Sí, aprobar'}</Boton>
        </>
      }
    >
      <ul class="lista-simple inv-resumen" data-prueba="resumen-merma">
        {resumenResolucion(merma, producto, decision).map((l) => <li key={l}>{l}</li>)}
      </ul>
      {rechaza && (
        <Campo etiqueta="Motivo del rechazo" requerido tope={MOTIVO_MAX} valor={motivo} onInput={(v) => { setMotivo(v); setErrorMotivo(null); }} error={intento && falta ? MOTIVO_RECHAZO_FALTA : (errorMotivo ?? undefined)} />
      )}
      {accion.error !== null && <Alerta>{accion.error}</Alerta>}
    </Dialogo>
  );
}

function Solicitar({ productos, alSolicitar }: { productos: readonly ProductoPanel[]; alSolicitar: () => void }): JSX.Element {
  const { api } = useApp();
  const avisos = useAvisos();
  const accion = useAccion();
  const clave = 'inventarios.merma.solicitud';
  const [inicial] = useState<BorradorMerma>(MERMA_INICIAL);
  const b = useBorrador<BorradorMerma>(clave, inicial);
  const e = b.valor;
  const sucio = b.hayBorrador && (e.productoId !== '' || e.series.trim() !== '' || e.motivo.trim() !== '' || e.cantidad !== '1');
  const { marcarGuardado } = useCambiosSinGuardar(sucio, [clave]);
  const [intento, setIntento] = useState(false);
  const [pideFoco, setPideFoco] = useState(0);
  const formulario = useRef<HTMLFormElement>(null);
  const operacion = useRef<{ firma: string; id: string } | null>(null);
  useEffect(() => {
    if (pideFoco > 0 && formulario.current !== null) enfocarPrimerError(formulario.current);
  }, [pideFoco]);
  const p = productos.find((x) => x.id === e.productoId);
  const errores = intento ? revisarSolicitud(e, p) : {};
  const series = separar(e.series);

  const solicitar = (ev: Event): void => {
    ev.preventDefault();
    setIntento(true);
    if (p === undefined || Object.keys(revisarSolicitud(e, p)).length > 0) {
      setPideFoco((n) => n + 1);
      return;
    }
    const cantidad = p.conSerie ? series.length : Number(e.cantidad.trim());
    const firma = JSON.stringify([p.id, e.ubicacionId, cantidad, series, e.motivo.trim()]);
    if (operacion.current?.firma !== firma) operacion.current = { firma, id: nuevoId() };
    const operacionId = operacion.current.id;
    void accion.ejecutar(async () => {
      await api.llamar('solicitarMerma', { operacionId, productoId: p.id, ubicacionId: e.ubicacionId as UbicacionId, cantidad, ...(p.conSerie ? { series } : {}), motivo: e.motivo.trim() });
      avisos.ok(`Merma de ${p.nombre} solicitada. Un supervisor o administrador debe resolverla; no mueve el stock hasta entonces.`);
      operacion.current = null;
      marcarGuardado();
      b.descartar();
      setIntento(false);
      alSolicitar();
    });
  };

  return (
    <Seccion titulo="Solicitar una merma">
      <form ref={formulario} class="formulario" onSubmit={solicitar} noValidate>
        <div class="cuadricula">
          <SelectorProducto productos={productos} valor={e.productoId} onCambio={(v) => b.poner({ ...e, productoId: v })} error={errores['producto']} />
          <Selector etiqueta="Almacén" valor={e.ubicacionId} onCambio={(v) => b.poner({ ...e, ubicacionId: v })} opciones={OPCIONES_ALMACEN} />
          {p?.conSerie ? (
            <Campo etiqueta="Series (separadas por coma)" valor={e.series} onInput={(v) => b.poner({ ...e, series: v })} requerido error={errores['series']} />
          ) : (
            <Campo etiqueta="Cantidad" valor={e.cantidad} onInput={(v) => b.poner({ ...e, cantidad: v })} inputMode="numeric" requerido error={errores['cantidad']} />
          )}
          <Campo etiqueta="Motivo" valor={e.motivo} onInput={(v) => b.poner({ ...e, motivo: v })} requerido tope={MOTIVO_MAX} error={errores['motivo']} />
        </div>
        {accion.error && <Alerta>{accion.error}</Alerta>}
        <Boton tipo="submit" ocupado={accion.ocupado}>Solicitar merma</Boton>
      </form>
    </Seccion>
  );
}

export function PantallaMermas(): JSX.Element {
  const { api, usuario } = useApp();
  const productos = useCarga(() => api.llamar('listarProductos', {}), []);
  const [estado, setEstado] = useState<FiltroEstado>('solicitada');
  const mermas = useCarga(() => api.llamar('listarMermas', estado === '' ? {} : { estado }), [estado]);
  const [resolviendo, setResolviendo] = useState<{ merma: MermaVista; decision: 'aprobada' | 'rechazada'; etiqueta: string } | null>(null);
  const [procesando, setProcesando] = useState<string | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const lista = productos.datos ?? [];
  const nombre = (id: string): string => lista.find((x) => x.id === id)?.nombre ?? id;
  const volverAlBoton = (): HTMLElement | null =>
    Array.from(raiz.current?.querySelectorAll<HTMLElement>('button') ?? []).find((x) => x.getAttribute('aria-label') === resolviendo?.etiqueta) ?? null;

  return (
    <div ref={raiz}>
      <h1>Mermas</h1>
      <ConCarga carga={productos}>{(ps) => <Solicitar productos={ps} alSolicitar={mermas.recargar} />}</ConCarga>
      <Seccion titulo="Mermas registradas">
        <div class="inv-filtro">
          <Selector etiqueta="Estado" valor={estado} onCambio={(v) => setEstado(v as FiltroEstado)} opciones={OPCIONES_ESTADO.map((o) => ({ valor: o.valor, texto: o.texto }))} />
        </div>
        <ConCarga carga={mermas}>
          {({ mermas: filas, cortada }) => (
            <Tabla
              titulo="Mermas"
              filas={ordenarMermas(filas)}
              clave={(m) => m.mermaId}
              porPagina={25}
              buscar={{ etiqueta: 'Buscar por producto o motivo', en: (m) => [nombre(m.productoId), m.motivo, m.motivoResolucion ?? ''] }}
              cortada={cortada ? { mostradas: filas.length, mensaje: `Se muestran las primeras ${String(filas.length)} mermas; hay más. Filtre por estado para ver el resto.` } : undefined}
              vacio={{ titulo: estado === 'solicitada' ? 'No hay mermas pendientes' : 'No hay mermas registradas' }}
              columnas={[
                { id: 'fecha', titulo: 'Fecha', valor: (m) => m.fecha, celda: (m) => fechaHora(m.fecha) },
                { id: 'producto', titulo: 'Producto', valor: (m) => nombre(m.productoId), celda: (m) => `${nombre(m.productoId)}${m.series.length > 0 ? ` (${m.series.join(', ')})` : ''} · ${nombreAlmacen(m.ubicacionId)}` },
                { id: 'cantidad', titulo: 'Cantidad', valor: (m) => m.cantidad },
                { id: 'motivo', titulo: 'Motivo', valor: (m) => m.motivo },
                { id: 'estado', titulo: 'Estado', valor: (m) => ESTADO_TEXTO[m.estado], celda: (m) => (procesando === m.mermaId ? 'Procesando…' : ESTADO_TEXTO[m.estado]) },
                { id: 'resolucion', titulo: 'Motivo de la resolución', valor: (m) => m.motivoResolucion ?? '', celda: (m) => m.motivoResolucion ?? '—' },
              ]}
              acciones={(m) =>
                m.estado !== 'solicitada' ? null : m.solicitadaPor === usuario.uid ? (
                  <span class="texto-suave">La resuelve otra persona</span>
                ) : (
                  <div class="fila">
                    <Boton chico ocupado={procesando === m.mermaId} etiqueta={`Aprobar la merma de ${nombre(m.productoId)}`} onClick={() => { setResolviendo({ merma: m, decision: 'aprobada', etiqueta: `Aprobar la merma de ${nombre(m.productoId)}` }); }}>Aprobar</Boton>
                    <Boton chico variante="secundario" deshabilitado={procesando === m.mermaId} etiqueta={`Rechazar la merma de ${nombre(m.productoId)}`} onClick={() => { setResolviendo({ merma: m, decision: 'rechazada', etiqueta: `Rechazar la merma de ${nombre(m.productoId)}` }); }}>Rechazar</Boton>
                  </div>
                )
              }
            />
          )}
        </ConCarga>
      </Seccion>
      {resolviendo !== null && (
        <ResolverMerma
          key={`${resolviendo.merma.mermaId}-${resolviendo.decision}`}
          merma={resolviendo.merma}
          producto={lista.find((x) => x.id === resolviendo.merma.productoId)}
          decision={resolviendo.decision}
          alCerrar={() => setResolviendo(null)}
          alProcesar={(v) => setProcesando(v ? resolviendo.merma.mermaId : null)}
          alCerrarEnfocar={volverAlBoton}
          alResolver={() => {
            setResolviendo(null);
            mermas.recargar();
            productos.recargar();
          }}
        />
      )}
    </div>
  );
}
