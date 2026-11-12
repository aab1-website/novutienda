import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Boton, Campo, ErrorCarga, Seccion, Vacio } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { useCarga } from '../../ui/hooks.js';
import { nombreAlmacen } from './nombres.js';
import { useProductos } from './usar-productos.js';

const ESTADO_SERIE = { disponible: 'Disponible', vendida: 'Vendida', merma: 'Merma' } as const;

export function Series(): JSX.Element {
  const { api } = useApp();
  const [q, setQ] = useState('');
  const [buscar, setBuscar] = useState('');
  const r = useCarga(() => (buscar === '' ? Promise.resolve([]) : api.llamar('buscarSerie', { serie: buscar })), [buscar]);
  const prod = useProductos();
  return (
    <Seccion titulo="Buscar por número de serie">
      <form class="formulario" role="search" onSubmit={(e) => { e.preventDefault(); setBuscar(q.trim()); }} noValidate>
        <Campo etiqueta="Número de serie (o parte)" valor={q} onInput={setQ} />
        <Boton tipo="submit" motivo={q.trim() === '' ? 'Escriba un número de serie o parte de él.' : undefined}>Buscar</Boton>
      </form>
      {r.error && <ErrorCarga error={r.error} reintentar={r.recargar} />}
      {buscar !== '' && r.datos && r.datos.length === 0 && <Vacio titulo="No se encontró esa serie" />}
      {r.datos && r.datos.length > 0 && (
        <div class="tabla-contenedor" role="region" aria-label="Resultado de la búsqueda por serie" tabIndex={0}>
          <table class="tabla">
            <caption class="solo-lectores">Resultado de la búsqueda por serie</caption>
            <thead><tr><th scope="col">Serie</th><th scope="col">Producto</th><th scope="col">Estado</th><th scope="col">Almacén</th><th scope="col">Venta</th><th scope="col">Garantía hasta</th></tr></thead>
            <tbody>
              {r.datos.map((u) => (
                <tr key={`${u.productoId}-${u.serie}`}>
                  <th scope="row">{u.serie}</th>
                  <td>{prod.lista.find((p) => p.id === u.productoId)?.nombre ?? u.productoId}</td>
                  <td>{ESTADO_SERIE[u.estado]}</td>
                  <td>{nombreAlmacen(u.ubicacionId)}</td>
                  <td>{u.ventaRef ?? '—'}</td>
                  <td>{u.garantiaHasta ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Seccion>
  );
}
