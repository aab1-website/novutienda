import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { ProductoPanel, UbicacionId } from '../../api/tipos.js';
import { marcaDe } from '../../api/marca.js';
import { Alerta, Boton, ConCarga, Pestanas, Seccion, Selector } from '../../ui/comun.js';
import { useConfiguracionComercial } from '../../ui/comercial.js';
import { useApp } from '../../ui/contexto.js';
import { useCarga } from '../../ui/hooks.js';
import { AvisoConteoAbierto, ExistenciaOculta } from '../../ui/existencia.js';
import { Tabla } from '../../ui/tabla.js';
import { AyudaInventario } from './ayuda-inventario.js';
import { Conteo } from './conteo.js';
import { ExistenciasPorAlmacen } from './existencias.js';
import { ImportarExportar } from './importar.js';
import { Ajuste, Ingreso, Traspaso } from './movimientos.js';
import { Registro } from './registro.js';
import { Series } from './series.js';
import { useConteosAbiertos } from './usar-conteos-abiertos.js';
import { NOMBRE_ALMACEN, nombreAlmacen } from './nombres.js';
import { ProductoPanelLateral } from './producto-panel.js';
import './inventario.css';

const PESTANAS = [
  { id: 'productos', titulo: 'Productos y existencias' },
  { id: 'existencias', titulo: 'Existencias por almacén' },
  { id: 'ingreso', titulo: 'Ingreso' },
  { id: 'traspasos', titulo: 'Traspasos' },
  { id: 'ajuste', titulo: 'Ajuste' },
  { id: 'conteo', titulo: 'Conteo ciego' },
  { id: 'series', titulo: 'Buscar serie' },
  { id: 'registro', titulo: 'Registro de acciones' },
  { id: 'csv', titulo: 'Importar y exportar' },
];

const ALMACENES: readonly UbicacionId[] = ['tienda', 'deposito-1', 'deposito-2'];
type Mostrar = '' | 'bajo' | 'inactivo';
const OPCIONES_MOSTRAR: readonly { valor: Mostrar; texto: string }[] = [{ valor: '', texto: 'Todos' }, { valor: 'bajo', texto: 'Bajo el mínimo' }, { valor: 'inactivo', texto: 'Inactivos' }];

/** Texto del estado; `null` si está oculto por un conteo abierto (no se inventa «Agotado»). */
const estadoDe = (p: ProductoPanel): string | null => (!p.activo ? 'Inactivo' : p.bajoMinimo === null || p.disponible === null ? null : p.bajoMinimo ? 'Bajo el mínimo' : p.disponible ? 'Disponible' : 'Agotado');
export const MOTIVO_FILTRO_MINIMO = 'No disponible mientras hay un conteo abierto';
const plural = (n: number, uno: string, varios: string): string => `${String(n)} ${n === 1 ? uno : varios}`;

/** Mercados en que el producto está «sin precio», con el nombre declarado por el comercio (sin el nombre, el id). */
function nombresSinPrecio(p: ProductoPanel, mercados: readonly { readonly id: string; readonly nombre: string }[]): string[] {
  return (p.sinPrecio ?? []).map((id) => mercados.find((m) => m.id === id)?.nombre ?? id);
}

function Productos(): JSX.Element {
  const { api, usuario, puedeVer } = useApp();
  const comercial = useConfiguracionComercial();
  const mercados = comercial.estado === 'lista' ? comercial.comercial.mercados : [];
  const carga = useCarga(async () => ({ productos: await api.llamar('listarProductos', {}), cot: await api.llamar('cotizacionesVigentes', {}) }), [], undefined, { alVolver: true });
  const [mostrar, setMostrar] = useState<Mostrar>('');
  const [abierto, setAbierto] = useState<{ producto: ProductoPanel | null; etiqueta: string } | null>(null);
  // Tras guardar, la lista se vuelve a leer: hasta que llegue, la fila muestra datos viejos y abrirla ofrecería editar sobre ellos.
  const [releyendo, setReleyendo] = useState<unknown>(null);
  const releyendoAhora = releyendo !== null && releyendo === carga.datos && carga.error === null;
  const raiz = useRef<HTMLDivElement>(null);
  const esAdm = usuario.rol === 'adm';
  const volverAlBoton = (): HTMLElement | null => {
    const etiqueta = abierto?.etiqueta;
    return Array.from(raiz.current?.querySelectorAll<HTMLElement>('button')??[]).find((b) => (b.getAttribute('aria-label') ?? b.textContent) === etiqueta) ?? null;
  };
  return (
    <div ref={raiz}>
      <ConCarga carga={carga}>
        {({ productos, cot }) => {
          // La marca viaja en la propia lista: se lee antes de filtrar, que la pierde.
          const marca = marcaDe(productos);
          const ocultas = marca !== undefined;
          const conteos = marca?.conteosAbiertos ?? [];
          const modo: Mostrar = ocultas && mostrar === 'bajo' ? '' : mostrar;
          const bajos = ocultas ? 0 : productos.filter((p) => p.bajoMinimo === true).length;
          const filas = productos.filter((p) => (modo === 'bajo' ? p.bajoMinimo === true : modo === 'inactivo' ? !p.activo : true));
          const opcionesMostrar = ocultas ? OPCIONES_MOSTRAR.filter((o) => o.valor !== 'bajo') : OPCIONES_MOSTRAR;
          return (
            <>
              {ocultas && <AvisoConteoAbierto conteos={conteos} nombreAlmacen={nombreAlmacen} />}
              {bajos > 0 && (
                <Alerta tipo="info">
                  <span data-prueba="linea-minimo">{plural(bajos, 'producto bajo el mínimo', 'productos bajo el mínimo')} · </span>
                  <Boton chico variante="secundario" onClick={() => setMostrar(modo === 'bajo' ? '' : 'bajo')}>{modo === 'bajo' ? 'Ver todos' : 'Ver'}</Boton>
                </Alerta>
              )}
              <Seccion titulo="Productos" acciones={esAdm && comercial.estado === 'lista' ? <Boton chico deshabilitado={releyendoAhora} onClick={() => setAbierto({ producto: null, etiqueta: 'Nuevo producto' })}>Nuevo producto</Boton> : undefined}>
                {comercial.estado === 'error' && <Alerta>{`No se pudo leer la configuración comercial: ${comercial.mensaje}`}</Alerta>}
                <div class="inv-filtro">
                  <Selector etiqueta="Mostrar" valor={modo} onCambio={(v) => setMostrar(v as Mostrar)} opciones={opcionesMostrar.map((o) => ({ valor: o.valor, texto: o.texto }))} ayuda={ocultas ? `Filtro «Bajo el mínimo»: ${MOTIVO_FILTRO_MINIMO}.` : undefined} />
                </div>
                <Tabla
                  titulo="Productos y existencias por almacén"
                  filas={filas}
                  clave={(p) => p.id}
                  buscar={{ etiqueta: 'Buscar por nombre, SKU, categoría o marca', en: (p) => [p.nombre, p.sku, p.categoria, p.marca ?? ''] }}
                  porPagina={25}
                  vacio={{ titulo: modo === '' ? 'No hay productos. Cree el primero con «Nuevo producto».' : 'Ningún producto cumple ese filtro.' }}
                  columnas={[
                    { id: 'producto', titulo: 'Producto', valor: (p) => p.nombre, encabezadoFila: true, ordenable: true, celda: (p) => <>{p.nombre}<div class="texto-suave">{p.sku}</div>{(p.sinPrecio ?? []).length > 0 && <div class="texto-suave" data-prueba="sin-precio"><strong>Sin precio</strong>{mercados.length > 1 ? `: ${nombresSinPrecio(p, mercados).join(', ')}` : ''}</div>}</> },
                    ...ALMACENES.map((a) => ({
                      id: a,
                      titulo: NOMBRE_ALMACEN[a],
                      valor: (p: ProductoPanel) => p.existencias[a] ?? -1,
                      celda: (p: ProductoPanel) => (p.existencias[a] === null ? <ExistenciaOculta /> : p.existencias[a]),
                      ordenable: !ocultas,
                    })),
                    { id: 'total', titulo: 'Total', valor: (p) => p.stockTotal ?? -1, celda: (p) => (p.stockTotal === null ? <ExistenciaOculta /> : (p.stockTotal ?? '—')), ordenable: !ocultas },
                    { id: 'estado', titulo: 'Estado', valor: (p) => estadoDe(p) ?? '', celda: (p) => estadoDe(p) ?? <ExistenciaOculta />, ordenable: !ocultas },
                  ]}
                  acciones={(p) => (
                    <div class="fila">
                      <Boton chico variante="secundario" deshabilitado={releyendoAhora} onClick={() => setAbierto({ producto: p, etiqueta: `Datos del producto de ${p.nombre}` })} etiqueta={`Datos del producto de ${p.nombre}`}>Datos del producto</Boton>
                      {puedeVer('catalogo') && <a href="#/catalogo/fichas" aria-label={`Fotos y página en el sitio de ${p.nombre}`}>Fotos y página en el sitio</a>}
                    </div>
                  )}
                />
              </Seccion>
              {abierto !== null && comercial.estado === 'lista' && (
                <ProductoPanelLateral
                  key={abierto.producto?.id ?? 'nuevo'}
                  producto={abierto.producto}
                  cot={cot}
                  comercial={comercial.comercial}
                  existentes={productos.map((p) => ({ id: p.id, sku: p.sku, categoria: p.categoria }))}
                  alCerrarEnfocar={volverAlBoton}
                  alCerrar={(guardado) => {
                    setAbierto(null);
                    if (guardado) {
                      setReleyendo(carga.datos);
                      carga.recargar();
                    }
                  }}
                />
              )}
            </>
          );
        }}
      </ConCarga>
    </div>
  );
}

/**
 * El enlace «Ver movimientos» de Mermas lleva el producto en la ruta: `#/inventario/registro?producto=<id>`. El enrutador del
 * panel parte la ruta solo por «/», así que el parámetro llega pegado a la pestaña y se separa aquí.
 */
export function separarSub(sub: string): { pestana: string; producto: string } {
  const [pestana = '', consulta = ''] = sub.split('?');
  return { pestana, producto: new URLSearchParams(consulta).get('producto') ?? '' };
}

/** Aviso de conteo para quien no recibe la marca en las listas (el administrador); cajeros y supervisores lo ven en cada pestaña. */
function AvisoParaAdm(): JSX.Element | null {
  const conteos = useConteosAbiertos();
  return <AvisoConteoAbierto conteos={conteos} nombreAlmacen={nombreAlmacen} />;
}

export function PantallaInventario({ sub: subCrudo }: { sub: string }): JSX.Element {
  const { usuario } = useApp();
  const { pestana: sub, producto } = separarSub(subCrudo);
  const items = PESTANAS.filter((p) => (p.id === 'ajuste' || p.id === 'csv' ? usuario.rol === 'adm' || p.id === 'csv' : true));
  const actual = items.some((i) => i.id === sub) ? sub : 'productos';
  return (
    <div>
      <div class="inv-encabezado">
        <h1>Inventario</h1>
        <AyudaInventario />
      </div>
      <Pestanas etiqueta="Secciones de inventario" base="inventario" actual={actual} items={items} />
      {usuario.rol === 'adm' && actual !== 'conteo' && <AvisoParaAdm />}
      {actual === 'productos' && <Productos />}
      {actual === 'existencias' && <ExistenciasPorAlmacen />}
      {actual === 'ingreso' && <Ingreso />}
      {actual === 'traspasos' && <Traspaso />}
      {actual === 'ajuste' && <Ajuste />}
      {actual === 'conteo' && <Conteo />}
      {actual === 'series' && <Series />}
      {actual === 'registro' && <Registro key={producto} productoInicial={producto} />}
      {actual === 'csv' && <ImportarExportar />}
    </div>
  );
}
