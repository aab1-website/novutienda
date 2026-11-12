import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { nuevoId } from '../../api/cliente.js';
import type { UbicacionId } from '../../api/tipos.js';
import { Alerta, Boton, Campo, Cargando, ErrorCarga, Selector, Seccion, Vacio, fechaHora } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { SelectorProducto } from './movimientos.js';

const ALMACENES = [{ valor: 'tienda', texto: 'Tienda' }, { valor: 'deposito-1', texto: 'Depósito 1' }, { valor: 'deposito-2', texto: 'Depósito 2' }];
const ESTADO_TEXTO = { solicitada: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada' } as const;

export function PantallaMermas(): JSX.Element {
  const { api, usuario } = useApp();
  const productos = useCarga(() => api.llamar('listarProductos', {}), []);
  const mermas = useCarga(() => api.llamar('listarMermas', {}), []);
  const accion = useAccion();
  const res = useAccion();
  const [productoId, setProductoId] = useState('');
  const [ubicacionId, setUbicacionId] = useState<UbicacionId>('tienda');
  const [cantidad, setCantidad] = useState('1');
  const [series, setSeries] = useState('');
  const [motivo, setMotivo] = useState('');
  const [operacionId, setOperacionId] = useState(nuevoId);
  const [ok, setOk] = useState<string | null>(null);

  const lista = productos.datos ?? [];
  const p = lista.find((x) => x.id === productoId);
  const listaSeries = series.split(/[\s,;]+/).filter((s) => s !== '');

  const solicitar = (e: Event): void => {
    e.preventDefault();
    if (p === undefined) return;
    void accion.ejecutar(async () => {
      await api.llamar('solicitarMerma', {
        operacionId, productoId: p.id, ubicacionId, cantidad: p.conSerie ? listaSeries.length : Math.floor(Number(cantidad) || 0),
        ...(p.conSerie ? { series: listaSeries } : {}), motivo: motivo.trim(),
      });
      setOk('Merma solicitada. Un supervisor o administrador debe resolverla; no mueve el stock hasta entonces.');
      setMotivo('');
      setSeries('');
      setOperacionId(nuevoId());
      mermas.recargar();
    });
  };

  const resolver = (mermaId: string, decision: 'aprobada' | 'rechazada'): void => {
    void res.ejecutar(async () => {
      await api.llamar('resolverMerma', { operacionId: nuevoId(), mermaId, decision });
      mermas.recargar();
      productos.recargar();
    });
  };

  return (
    <div>
      <h1>Mermas</h1>
      <Seccion titulo="Solicitar una merma">
        {productos.cargando && <Cargando />}
        {productos.error && <ErrorCarga error={productos.error} reintentar={productos.recargar} />}
        {productos.datos && (
          <form class="formulario" onSubmit={solicitar} noValidate>
            <div class="cuadricula">
              <SelectorProducto productos={lista} valor={productoId} onCambio={setProductoId} />
              <Selector etiqueta="Almacén" valor={ubicacionId} onCambio={(v) => setUbicacionId(v as UbicacionId)} opciones={ALMACENES} />
              {p?.conSerie ? (
                <Campo etiqueta="Series (separadas por coma)" valor={series} onInput={setSeries} requerido />
              ) : (
                <Campo etiqueta="Cantidad" valor={cantidad} onInput={setCantidad} inputMode="numeric" requerido />
              )}
              <Campo etiqueta="Motivo" valor={motivo} onInput={setMotivo} requerido />
            </div>
            {accion.error && <Alerta>{accion.error}</Alerta>}
            {ok && <Alerta tipo="ok">{ok}</Alerta>}
            <Boton tipo="submit" ocupado={accion.ocupado} deshabilitado={p === undefined || motivo.trim() === '' || (p.conSerie && listaSeries.length === 0)}>
              Solicitar merma
            </Boton>
          </form>
        )}
      </Seccion>
      <Seccion titulo="Mermas registradas">
        {mermas.cargando && <Cargando />}
        {mermas.error && <ErrorCarga error={mermas.error} reintentar={mermas.recargar} />}
        {res.error && <Alerta>{res.error}</Alerta>}
        {mermas.datos && mermas.datos.length === 0 && <Vacio titulo="No hay mermas registradas" />}
        {mermas.datos && mermas.datos.length > 0 && (
          <table class="tabla">
            <caption class="solo-lectores">Mermas</caption>
            <thead><tr><th scope="col">Fecha</th><th scope="col">Producto</th><th scope="col" class="num">Cantidad</th><th scope="col">Motivo</th><th scope="col">Estado</th><th scope="col"><span class="solo-lectores">Acciones</span></th></tr></thead>
            <tbody>
              {mermas.datos.map((m) => (
                <tr key={m.mermaId}>
                  <td>{fechaHora(m.fecha)}</td>
                  <td>{lista.find((x) => x.id === m.productoId)?.nombre ?? m.productoId}{m.series.length > 0 ? ` (${m.series.join(', ')})` : ''}</td>
                  <td class="num">{m.cantidad}</td>
                  <td>{m.motivo}</td>
                  <td>{ESTADO_TEXTO[m.estado]}</td>
                  <td>
                    {m.estado === 'solicitada' &&
                      (m.solicitadaPor === usuario.uid ? (
                        <span class="texto-suave">La resuelve otra persona</span>
                      ) : (
                        <div class="fila">
                          <Boton chico onClick={() => resolver(m.mermaId, 'aprobada')} ocupado={res.ocupado}>Aprobar</Boton>
                          <Boton chico variante="secundario" onClick={() => resolver(m.mermaId, 'rechazada')} ocupado={res.ocupado}>Rechazar</Boton>
                        </div>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Seccion>
    </div>
  );
}
