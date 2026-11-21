import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { UnidadSerie } from '../../api/tipos.js';
import { Alerta, Boton, Campo, Casilla, ErrorCarga, Seccion, Vacio } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { AvisoConteoAbierto } from '../../ui/existencia.js';
import { useCarga } from '../../ui/hooks.js';
import { Tabla } from '../../ui/tabla.js';
import { useConteosAbiertos } from './usar-conteos-abiertos.js';
import { nombreAlmacen } from './nombres.js';
import { useProductos } from './usar-productos.js';

const ESTADO_SERIE = { disponible: 'Disponible', vendida: 'Vendida', merma: 'Merma' } as const;

/** Con un conteo abierto, «no se encontró» puede significar «está oculta»: se le dice a quien busca. */
export function textoSerieOculta(conteos: readonly { readonly ubicacionId: string }[]): string | undefined {
  if (conteos.length === 0) return undefined;
  const donde = conteos.length === 1 ? `el almacén ${nombreAlmacen(conteos[0]?.ubicacionId ?? '')} tiene` : `los almacenes ${conteos.map((c) => nombreAlmacen(c.ubicacionId)).join(', ')} tienen`;
  return `No se encontró, o está oculta: ${donde} un conteo abierto y sus series disponibles no se muestran hasta cerrarlo.`;
}

export function Series(): JSX.Element {
  const { api, usuario } = useApp();
  const puedePorInicio = usuario.rol === 'sup' || usuario.rol === 'adm';
  const [porInicio, setPorInicio] = useState(false);
  const [conInicio, setConInicio] = useState(false);
  const [q, setQ] = useState('');
  const [buscar, setBuscar] = useState('');
  const r = useCarga(() => (buscar === '' ? Promise.resolve([]) : api.llamar('buscarSerie', conInicio ? { serie: buscar, porInicio: true } : { serie: buscar })), [buscar, conInicio]);
  const prod = useProductos();
  const abiertos = useConteosAbiertos();
  const conteos = prod.conteos.length > 0 ? prod.conteos : abiertos;
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
      {buscar !== '' && r.datos && r.datos.length === 0 && <Vacio titulo={textoSerieOculta(conteos) ?? 'No se encontró esa serie'} />}
      {r.datos && r.datos.length > 0 && (
        <Tabla<UnidadSerie>
          titulo="Resultado de la búsqueda por serie"
          filas={r.datos}
          clave={(u) => `${u.productoId}-${u.serie}`}
          vistaCelular="tarjetas"
          columnas={[
            { id: 'serie', titulo: 'Serie', valor: (u) => u.serie, encabezadoFila: true },
            { id: 'producto', titulo: 'Producto', valor: (u) => prod.lista.find((p) => p.id === u.productoId)?.nombre ?? u.productoId },
            { id: 'estado', titulo: 'Estado', valor: (u) => ESTADO_SERIE[u.estado] },
            { id: 'almacen', titulo: 'Almacén', valor: (u) => nombreAlmacen(u.ubicacionId) },
            { id: 'venta', titulo: 'Venta', valor: (u) => u.ventaRef ?? '—' },
            { id: 'garantia', titulo: 'Garantía hasta', valor: (u) => u.garantiaHasta ?? '—' },
          ]}
        />
      )}
    </Seccion>
  );
}
