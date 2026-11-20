import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { marcaDe } from '../../api/marca.js';
import type { CotizacionesVigentes, MercadoDeclarado, ProductoPanel, VentaPos } from '../../api/tipos.js';
import { Alerta, Boton, Campo, Cargando, ErrorCarga, Selector, Seccion, Vacio } from '../../ui/comun.js';
import { useConfiguracionComercial } from '../../ui/comercial.js';
import { useApp } from '../../ui/contexto.js';
import { AvisoConteoAbierto, ExistenciaOculta } from '../../ui/existencia.js';
import { useCarga } from '../../ui/hooks.js';
import { formatearMonto } from '../../util/dinero.js';
import { cotizacionDeMercado, hayReglaDeRedondeo, monedasDeCobro, precioDeCobro } from './arqueo.js';

const NOMBRE_EN_TEXTO: Readonly<Record<string, string>> = { USD: 'dólares', BOB: 'bolivianos', ARS: 'pesos argentinos' };
const enTexto = (m: string): string => NOMBRE_EN_TEXTO[m] ?? m;

export function Cotizacion({ cot, mercado, moneda }: { cot: CotizacionesVigentes; mercado: MercadoDeclarado; moneda: string }): JSX.Element | null {
  if (!hayReglaDeRedondeo(mercado) && moneda === mercado.monedaVenta) {
    return <Alerta>Falta la regla de redondeo de {mercado.monedaVenta} para este comercio: no se muestran precios en esa moneda. Avise al administrador.</Alerta>;
  }
  if (!mercado.tieneTipoCambio) return null;
  if (moneda === mercado.monedaBase) return <p class="texto-suave">Precios en {enTexto(moneda)}: sin conversión.</p>;
  const c = cotizacionDeMercado(cot, mercado.id);
  if (c === null) return <Alerta>No hay una cotización utilizable para este mercado. Venda en {enTexto(mercado.monedaBase)} o avise al administrador.</Alerta>;
  return (
    <p class="texto-suave" data-prueba="cotizacion">
      Cotización: 1 {mercado.monedaBase} = {String(c.valor).replace('.', ',')} {mercado.monedaVenta} · {c.fuente} · {c.fecha}
      {c.estado === 'ultimo_verificado' ? ' · último valor verificado (la fuente no lo renueva)' : ' · vigente'}
    </p>
  );
}

export interface PropsCatalogo {
  productos: readonly ProductoPanel[];
  ventas: readonly VentaPos[];
  cot: CotizacionesVigentes;
  mercados: readonly MercadoDeclarado[];
  mercado: MercadoDeclarado;
  moneda: string;
  cambiarMercado: (id: string) => void;
  cambiarMoneda: (m: string) => void;
  /** Sin esta función el catálogo es de solo lectura: no hay «Agregar» ni accesos rápidos. */
  alAgregar?: ((p: ProductoPanel) => void) | undefined;
  titulo?: string | undefined;
}

/** Lista de productos con su precio y existencia; busca por nombre, SKU o marca. Respeta el `null` del conteo ciego. */
export function CatalogoVenta({ productos, ventas, cot, mercados, mercado, moneda, cambiarMercado, cambiarMoneda, alAgregar, titulo }: PropsCatalogo): JSX.Element {
  const [busqueda, setBusqueda] = useState('');
  const [categoria, setCategoria] = useState('');
  const monedas = monedasDeCobro(mercado);
  const categorias = [...new Set(productos.map((p) => p.categoria))].sort();
  const q = busqueda.trim().toLowerCase();
  const visibles = productos
    .filter((p) => p.activo)
    .filter((p) => categoria === '' || p.categoria === categoria)
    .filter((p) => q === '' || p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.marca ?? '').toLowerCase().includes(q));
  const vendidos = new Map<string, number>();
  for (const v of ventas) for (const l of v.lineas) vendidos.set(l.productoId, (vendidos.get(l.productoId) ?? 0) + l.cantidad);
  const rapidos = alAgregar === undefined ? [] : [...productos.filter((p) => p.activo && p.disponible !== false)].sort((a, b) => (vendidos.get(b.id) ?? 0) - (vendidos.get(a.id) ?? 0) || a.nombre.localeCompare(b.nombre)).slice(0, 6);

  return (
    <Seccion titulo={titulo ?? 'Productos'}>
      <div class="cuadricula">
        <Campo etiqueta="Buscar por nombre, SKU o marca" valor={busqueda} onInput={setBusqueda} nombre="buscar" />
        <Selector etiqueta="Categoría" valor={categoria} onCambio={setCategoria} opciones={[{ valor: '', texto: 'Todas' }, ...categorias.map((c) => ({ valor: c, texto: c }))]} />
        {mercados.length > 1 && <Selector etiqueta="Lista de precios" valor={mercado.id} onCambio={cambiarMercado} opciones={mercados.map((m) => ({ valor: m.id, texto: m.nombre }))} />}
        {monedas.length > 1 && <Selector etiqueta="Moneda de la venta" valor={moneda} onCambio={cambiarMoneda} opciones={monedas.map((m) => ({ valor: m, texto: m }))} />}
      </div>
      <Cotizacion cot={cot} mercado={mercado} moneda={moneda} />
      {alAgregar !== undefined && rapidos.length > 0 && (
        <div role="group" aria-label="Accesos rápidos" class="fila rapidos">
          {rapidos.map((p) => (
            <button key={p.id} type="button" class="boton boton-secundario boton-chico" onClick={() => alAgregar(p)}>
              {p.nombre}
            </button>
          ))}
        </div>
      )}
      {visibles.length === 0 ? (
        <Vacio titulo="No hay productos que coincidan" detalle="Pruebe con otra búsqueda o categoría." />
      ) : (
        <ul class="lista-productos">
          {visibles.map((p) => {
            const pr = precioDeCobro(p, mercado, moneda, cot);
            return (
              <li key={p.id} class="producto-tarjeta">
                <div>
                  <strong>{p.nombre}</strong>
                  <div class="texto-suave">
                    {p.categoria}
                    {p.marca ? ` · ${p.marca}` : ''} · Tienda: {p.existencias.tienda === null ? <ExistenciaOculta /> : p.existencias.tienda}
                    {p.conSerie ? ' · con serie' : ''}
                  </div>
                  <div class="precio" data-prueba="precio">
                    {pr.tipo === 'precio' ? formatearMonto(pr.centavos, pr.moneda) : pr.tipo === 'sin_precio' ? 'A consultar' : pr.tipo === 'sin_redondeo' ? 'Sin regla de redondeo' : 'Sin cotización'}
                  </div>
                </div>
                {alAgregar !== undefined && (
                  <Boton chico variante="secundario" onClick={() => alAgregar(p)} deshabilitado={pr.tipo !== 'precio'} etiqueta={`Agregar ${p.nombre}`}>
                    Agregar
                  </Boton>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Seccion>
  );
}

/** Sin turno abierto se puede mirar el catálogo, pero no vender: sin carrito ni botones «Agregar». */
export function CatalogoSoloLectura(): JSX.Element {
  const comercial = useConfiguracionComercial();
  if (comercial.estado === 'cargando') return <Cargando />;
  if (comercial.estado === 'error') return <Alerta>{comercial.mensaje}</Alerta>;
  if (comercial.comercial.mercados.length === 0) return <Alerta>El comercio no tiene mercados declarados.</Alerta>;
  return <CatalogoCargado mercados={comercial.comercial.mercados} />;
}

function CatalogoCargado({ mercados }: { mercados: readonly MercadoDeclarado[] }): JSX.Element {
  const { api } = useApp();
  const datos = useCarga(async () => ({ productos: await api.llamar('listarProductos', {}), cot: await api.llamar('cotizacionesVigentes', {}) }), []);
  const [mercadoId, setMercadoId] = useState(mercados[0]?.id ?? '');
  const mercado = mercados.find((m) => m.id === mercadoId) ?? mercados[0];
  const [moneda, setMoneda] = useState(mercados[0]?.monedaVenta ?? '');
  if (datos.cargando) return <Cargando />;
  if (datos.error || !datos.datos || mercado === undefined) return <ErrorCarga error={datos.error ?? 'Sin datos'} reintentar={datos.recargar} />;
  const conteos = marcaDe(datos.datos.productos)?.conteosAbiertos ?? [];
  return (
    <div class="terminal">
      <AvisoConteoAbierto conteos={conteos} />
      <CatalogoVenta
        productos={datos.datos.productos}
        ventas={[]}
        cot={datos.datos.cot}
        mercados={mercados}
        mercado={mercado}
        moneda={moneda}
        cambiarMercado={(id) => { setMercadoId(id); setMoneda(mercados.find((m) => m.id === id)?.monedaVenta ?? ''); }}
        cambiarMoneda={setMoneda}
        titulo="Productos (solo consulta)"
      />
    </div>
  );
}
