import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { MovimientoVista, ProductoPanel, TipoMovimiento } from '../../api/tipos.js';
import { useAvisos } from '../../ui/avisos.js';
import { Boton, Campo, ConCarga, Selector, Seccion, Vacio, fechaHora } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { useCarga } from '../../ui/hooks.js';
import { Tabla } from '../../ui/tabla.js';
import { aCsv, descargarTexto } from '../../util/csv.js';
import { nombreAlmacen, nombreTipo, OPCIONES_ALMACEN, NOMBRE_TIPO } from './nombres.js';
import { useProductos } from './usar-productos.js';

const TIPOS: { valor: string; texto: string }[] = [{ valor: '', texto: 'Todos' }, ...(Object.entries(NOMBRE_TIPO) as [string, string][]).map(([valor, texto]) => ({ valor, texto }))];

const mensajeCortada = (n: number): string => `Se muestran los primeros ${String(n)} movimientos; hay más. Afine los filtros (fechas, tipo o producto) para ver el resto.`;

/** Tabla de movimientos con búsqueda, filtro por almacén y páginas. Con `cortada`, avisa que la lista no está completa. */
export function TablaMovimientos({ movs, productos, cortada = false }: { movs: readonly MovimientoVista[]; productos: readonly ProductoPanel[]; cortada?: boolean }): JSX.Element {
  const nombre = (id: string): string => productos.find((p) => p.id === id)?.nombre ?? id;
  return (
    <Tabla
      titulo="Movimientos de inventario"
      filas={movs}
      clave={(m) => m.id}
      porPagina={25}
      buscar={{ etiqueta: 'Buscar por producto, usuario o motivo', en: (m) => [nombre(m.productoId), m.por, m.motivo ?? ''] }}
      filtros={[{ id: 'almacen', etiqueta: 'Almacén', opciones: OPCIONES_ALMACEN.map((o) => ({ valor: o.valor, texto: o.texto })), aplica: (m, v) => m.ubicacionId === v }]}
      cortada={cortada ? { mostradas: movs.length, mensaje: mensajeCortada(movs.length) } : undefined}
      vacio={{ titulo: 'No hay movimientos' }}
      columnas={[
        { id: 'fecha', titulo: 'Fecha', valor: (m) => m.fecha, celda: (m) => fechaHora(m.fecha), ordenable: true },
        { id: 'tipo', titulo: 'Tipo', valor: (m) => nombreTipo(m.tipo), ordenable: true },
        { id: 'producto', titulo: 'Producto', valor: (m) => nombre(m.productoId), ordenable: true },
        { id: 'almacen', titulo: 'Almacén', valor: (m) => nombreAlmacen(m.ubicacionId) },
        { id: 'cantidad', titulo: 'Cantidad', valor: (m) => m.delta, celda: (m) => (m.delta > 0 ? `+${String(m.delta)}` : String(m.delta)), ordenable: true },
        { id: 'usuario', titulo: 'Usuario', valor: (m) => `${m.por} (${m.rol})` },
      ]}
    />
  );
}

export function Registro(): JSX.Element {
  const { api } = useApp();
  const avisos = useAvisos();
  const prod = useProductos();
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [tipo, setTipo] = useState('');
  const [productoId, setProductoId] = useState('');
  const [filtro, setFiltro] = useState({});
  const r = useCarga(() => api.llamar('listarMovimientos', filtro), [filtro]);
  const exportar = (): void => {
    const lista = r.datos?.movimientos ?? [];
    const filas: (string | number | undefined)[][] = lista.map((m) => [m.fecha, m.tipo, m.productoId, m.ubicacionId, m.delta, m.saldoUbicacion, m.por, m.rol, m.motivo]);
    const cortada = r.datos?.cortada === true;
    // El archivo mismo dice que está cortado: quien lo abra sin ver la pantalla no lo toma por completo.
    if (cortada) filas.push([`AVISO: lista cortada. Solo trae los primeros ${String(lista.length)} movimientos; hay más. Afine los filtros y exporte de nuevo.`]);
    descargarTexto(cortada ? 'movimientos-inventario-cortado.csv' : 'movimientos-inventario.csv', aCsv(['fecha', 'tipo', 'productoId', 'almacen', 'cantidad', 'saldo', 'usuario', 'rol', 'motivo'], filas));
    if (cortada) avisos.info('El CSV está cortado: solo trae los primeros movimientos. Afine los filtros para exportar el resto.');
    else avisos.ok('Archivo exportado.');
  };
  return (
    <Seccion titulo="Registro de acciones">
      <form class="formulario" role="search" onSubmit={(e) => { e.preventDefault(); setFiltro({ ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}), ...(tipo ? { tipo: tipo as TipoMovimiento } : {}), ...(productoId ? { productoId } : {}) }); }} noValidate>
        <div class="cuadricula">
          <Campo etiqueta="Desde" tipo="date" valor={desde} onInput={setDesde} />
          <Campo etiqueta="Hasta" tipo="date" valor={hasta} onInput={setHasta} />
          <Selector etiqueta="Tipo" valor={tipo} onCambio={setTipo} opciones={TIPOS} />
          <Selector etiqueta="Producto" valor={productoId} onCambio={setProductoId} opciones={[{ valor: '', texto: 'Todos' }, ...prod.lista.map((p) => ({ valor: p.id, texto: p.nombre }))]} />
        </div>
        <div class="fila">
          <Boton tipo="submit">Filtrar</Boton>
          <Boton variante="secundario" onClick={exportar} motivo={(r.datos?.movimientos.length ?? 0) === 0 ? 'No hay movimientos que exportar con estos filtros.' : undefined}>Exportar CSV</Boton>
        </div>
      </form>
      <ConCarga carga={r}>
        {(d) => (d.movimientos.length === 0 ? <Vacio titulo="No hay movimientos con esos filtros" /> : <TablaMovimientos movs={d.movimientos} productos={prod.lista} cortada={d.cortada} />)}
      </ConCarga>
    </Seccion>
  );
}
