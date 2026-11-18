import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Alerta, Boton, Campo, Casilla, ErrorCarga, Seccion, Vacio } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { AvisoConteoAbierto } from '../../ui/existencia.js';
import { useCarga } from '../../ui/hooks.js';
import { nombreAlmacen } from './nombres.js';
import { useProductos } from './usar-productos.js';

const ESTADO_SERIE = { disponible: 'Disponible', vendida: 'Vendida', merma: 'Merma' } as const;

export function Series(): JSX.Element {
  const { api, usuario } = useApp();
  const puedePorInicio = usuario.rol === 'sup' || usuario.rol === 'adm';
  const [porInicio, setPorInicio] = useState(false);
  const [conInicio, setConInicio] = useState(false);
  const [q, setQ] = useState('');
  const [buscar, setBuscar] = useState('');
  const r = useCarga(() => (buscar === '' ? Promise.resolve([]) : api.llamar('buscarSerie', conInicio ? { serie: buscar, porInicio: true } : { serie: buscar })), [buscar, conInicio]);
  const prod = useProductos();
  // La marca viene de la lista de productos (la de `buscarSerie` no la trae): con un conteo abierto las series disponibles se ocultan.
  return (
    <Seccion titulo="Buscar por número de serie">
      {prod.ocultas && <AvisoConteoAbierto conteos={prod.conteos} nombreAlmacen={nombreAlmacen} />}
      {prod.ocultas && <Alerta tipo="info">Las series disponibles están ocultas mientras hay un conteo abierto.</Alerta>}
      <form class="formulario" role="search" onSubmit={(e) => { e.preventDefault(); setBuscar(q.trim()); setConInicio(puedePorInicio && porInicio); }} noValidate>
        <Campo etiqueta={puedePorInicio ? 'Número de serie (completo, o sus primeros 4 caracteres o más)' : 'Número de serie'} valor={q} onInput={setQ} />
        {puedePorInicio && <Casilla etiqueta="Buscar por el comienzo" marcado={porInicio} onCambio={setPorInicio} />}
        <Boton tipo="submit" motivo={q.trim() === '' ? 'Escriba un número de serie.' : porInicio && puedePorInicio && q.trim().length < 4 ? 'Escriba al menos 4 caracteres.' : undefined}>Buscar</Boton>
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
