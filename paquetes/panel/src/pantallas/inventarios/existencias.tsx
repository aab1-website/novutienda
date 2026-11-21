import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { UBICACIONES, type UbicacionId } from '../../api/tipos.js';
import { Alerta, Casilla, Cargando, ErrorCarga, Selector, Seccion } from '../../ui/comun.js';
import { AvisoConteoAbierto } from '../../ui/existencia.js';
import { Tabla } from '../../ui/tabla.js';
import { encabezadoAlmacen, filasDeAlmacen, mensajeAlmacenOculto, type FilaExistencia } from './existencias-logica.js';
import { nombreAlmacen, NOMBRE_ALMACEN, OPCIONES_ALMACEN } from './nombres.js';
import { useProductos } from './usar-productos.js';
import './inventario.css';

/**
 * Pestaña «Existencias por almacén»: una tabla de un almacén por vez, sin cifras si ese almacén está en conteo. */
export function ExistenciasPorAlmacen(): JSX.Element {
  const prod = useProductos();
  const [almacen, setAlmacen] = useState<UbicacionId>(UBICACIONES[0] ?? 'tienda');
  const [incluirCero, setIncluirCero] = useState(false);

  if (prod.cargando) return <Cargando />;
  if (prod.error !== null) return <ErrorCarga error={prod.error} reintentar={prod.recargar} />;

  const nombre = NOMBRE_ALMACEN[almacen];
  const r = filasDeAlmacen(prod.lista, almacen, { incluirCero, conteos: prod.conteos });
  const conteosDelAlmacen = prod.conteos.filter((c) => c.ubicacionId === almacen);

  return (
    <Seccion titulo="Existencias por almacén">
      <div class="cuadricula">
        <Selector etiqueta="Almacén" valor={almacen} onCambio={(v) => setAlmacen(v as UbicacionId)} opciones={OPCIONES_ALMACEN} />
        <Casilla etiqueta="Mostrar también los que están en 0" marcado={incluirCero} onCambio={setIncluirCero} deshabilitado={r.oculto} />
      </div>
      {r.oculto ? (
        <>
          {conteosDelAlmacen.length > 0 && <AvisoConteoAbierto conteos={conteosDelAlmacen} nombreAlmacen={nombreAlmacen} />}
          <Alerta tipo="info">{mensajeAlmacenOculto(nombre)}</Alerta>
        </>
      ) : (
        <>
          <p class="texto-suave" data-prueba="encabezado-existencias">{encabezadoAlmacen(nombre, r.unidades, r.productos)}</p>
          <Tabla<FilaExistencia>
            titulo={`Existencias en ${nombre}`}
            filas={r.filas}
            clave={(f) => f.producto.id}
            buscar={{ etiqueta: 'Buscar por nombre, SKU o categoría', en: (f) => [f.producto.nombre, f.producto.sku, f.producto.categoria] }}
            porPagina={25}
            vistaCelular="tarjetas"
            vacio={{ titulo: incluirCero ? `No hay productos en ${nombre}.` : `No hay productos con existencia en ${nombre}.` }}
            columnas={[
              { id: 'producto', titulo: 'Producto', valor: (f) => f.producto.nombre, encabezadoFila: true, ordenable: true },
              { id: 'sku', titulo: 'SKU', valor: (f) => f.producto.sku, ordenable: true },
              { id: 'categoria', titulo: 'Categoría', valor: (f) => f.producto.categoria, ordenable: true },
              { id: 'existencia', titulo: 'Existencia', valor: (f) => f.cantidad, ordenable: true },
            ]}
          />
        </>
      )}
    </Seccion>
  );
}
