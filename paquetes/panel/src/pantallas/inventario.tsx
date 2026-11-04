import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { nuevoId } from '../api/cliente.js';
import type { CotizacionesVigentes, ProductoPanel, UbicacionId } from '../api/tipos.js';
import { Alerta, Boton, Campo, Cargando, Casilla, ErrorCarga, Pestanas, Seccion, Vacio, Dato } from '../ui/comun.js';
import { useApp } from '../ui/contexto.js';
import { useAccion, useCarga } from '../ui/hooks.js';
import { centavosATexto, formatearMonto, textoACentavos } from '../util/dinero.js';
import { precioDeVenta } from '../util/precio.js';
import { Ajuste, Conteo, Ingreso, Registro, Series, Traspaso, ImportarExportar } from './inventario-ops.js';

const PESTANAS = [
  { id: 'productos', titulo: 'Productos y existencias' },
  { id: 'ingreso', titulo: 'Ingreso' },
  { id: 'traspasos', titulo: 'Traspasos' },
  { id: 'ajuste', titulo: 'Ajuste' },
  { id: 'conteo', titulo: 'Conteo ciego' },
  { id: 'series', titulo: 'Buscar serie' },
  { id: 'registro', titulo: 'Registro de acciones' },
  { id: 'csv', titulo: 'Importar y exportar' },
];

const ALM: { id: UbicacionId; texto: string }[] = [{ id: 'tienda', texto: 'Tienda' }, { id: 'deposito-1', texto: 'Depósito 1' }, { id: 'deposito-2', texto: 'Depósito 2' }];

function Precio({ usd, mercado, cot }: { usd: number; mercado: 'BO' | 'AR'; cot: CotizacionesVigentes }): JSX.Element {
  const p = precioDeVenta(usd, mercado, mercado === 'BO' ? 'BOB' : 'ARS', cot[mercado]);
  return <span>{p.tipo === 'precio' ? formatearMonto(p.centavos, p.moneda) : p.tipo === 'sin_precio' ? 'A consultar' : 'Sin cotización'}</span>;
}

function margen(precio: number, costo: number | undefined): string {
  if (costo === undefined || precio <= 0) return '—';
  return `${(((precio - costo) / precio) * 100).toFixed(1).replace('.', ',')} %`;
}

export function FichaProducto({ producto, cot, alGuardar, alCerrar }: { producto: ProductoPanel | null; cot: CotizacionesVigentes; alGuardar: () => void; alCerrar: () => void }): JSX.Element {
  const { api, usuario } = useApp();
  const accion = useAccion();
  const esAdm = usuario.rol === 'adm';
  const nuevo = producto === null;
  const [f, setF] = useState({
    id: producto?.id ?? '', nombre: producto?.nombre ?? '', categoria: producto?.categoria ?? '', marca: producto?.marca ?? '', sku: producto?.sku ?? '',
    activo: producto?.activo ?? true, conSerie: producto?.conSerie ?? false, garantia: producto?.garantiaMeses === undefined ? '' : String(producto.garantiaMeses),
    minimo: producto?.minimo === undefined ? '' : String(producto.minimo), bo: producto ? centavosATexto(producto.precioUSD.bo) : '', ar: producto ? centavosATexto(producto.precioUSD.ar) : '',
    costo: producto?.costoUSD === undefined ? '' : centavosATexto(producto.costoUSD),
  });
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(false), [f]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]): void => setF({ ...f, [k]: v });
  const bo = textoACentavos(f.bo);
  const ar = textoACentavos(f.ar);
  const costo = f.costo.trim() === '' ? undefined : textoACentavos(f.costo);
  const garantia = f.garantia.trim() === '' ? undefined : Number(f.garantia);
  const minimo = f.minimo.trim() === '' ? undefined : Number(f.minimo);
  const valido = f.nombre.trim() !== '' && f.categoria.trim() !== '' && bo !== null && ar !== null && costo !== null &&
    (garantia === undefined || (Number.isInteger(garantia) && garantia >= 1 && garantia <= 120)) && (minimo === undefined || (Number.isInteger(minimo) && minimo >= 0)) &&
    (!nuevo || (/^[a-z0-9][a-z0-9-]{1,59}$/.test(f.id) && f.sku.trim() !== ''));

  const guardar = (e: Event): void => {
    e.preventDefault();
    if (!valido || bo === null || ar === null || costo === null) return;
    void accion.ejecutar(async () => {
      if (nuevo) {
        await api.llamar('crearProducto', {
          operacionId: nuevoId(),
          producto: {
            id: f.id, nombre: f.nombre.trim(), categoria: f.categoria.trim(), ...(f.marca.trim() ? { marca: f.marca.trim() } : {}), sku: f.sku.trim(), activo: f.activo, conSerie: f.conSerie,
            ...(garantia !== undefined ? { garantiaMeses: garantia } : {}), ...(minimo !== undefined ? { minimo } : {}), precioUSD: { bo, ar }, ...(costo !== undefined ? { costoUSD: costo } : {}),
          },
        });
      } else if (producto) {
        const cambios = {
          ...(f.nombre.trim() !== producto.nombre ? { nombre: f.nombre.trim() } : {}), ...(f.categoria.trim() !== producto.categoria ? { categoria: f.categoria.trim() } : {}),
          ...(f.marca.trim() !== (producto.marca ?? '') && f.marca.trim() !== '' ? { marca: f.marca.trim() } : {}), ...(f.activo !== producto.activo ? { activo: f.activo } : {}),
          ...(f.conSerie !== producto.conSerie ? { conSerie: f.conSerie } : {}), ...(garantia !== undefined && garantia !== producto.garantiaMeses ? { garantiaMeses: garantia } : {}),
          ...(minimo !== undefined && minimo !== producto.minimo ? { minimo } : {}), ...(costo !== undefined && costo !== producto.costoUSD ? { costoUSD: costo } : {}),
        };
        if (Object.keys(cambios).length > 0) await api.llamar('actualizarProducto', { operacionId: nuevoId(), productoId: producto.id, cambios });
        if (bo !== producto.precioUSD.bo || ar !== producto.precioUSD.ar) await api.llamar('cambiarPrecioUSD', { productoId: producto.id, precioUSD: { bo: bo / 100, ar: ar / 100 } });
      }
      setOk(true);
      alGuardar();
    });
  };

  return (
    <Seccion titulo={nuevo ? 'Nuevo producto' : `Ficha: ${producto.nombre}`} acciones={<Boton chico variante="secundario" onClick={alCerrar}>Cerrar ficha</Boton>}>
      {!esAdm && <Alerta tipo="info">Solo el administrador edita productos y precios. Usted puede consultar la ficha.</Alerta>}
      <form class="formulario" onSubmit={guardar} noValidate>
        <div class="cuadricula">
          {nuevo && <Campo etiqueta="Identificador (minúsculas, números y guiones)" valor={f.id} onInput={(v) => set('id', v)} requerido />}
          <Campo etiqueta="Nombre" valor={f.nombre} onInput={(v) => set('nombre', v)} requerido deshabilitado={!esAdm} />
          <Campo etiqueta="Categoría" valor={f.categoria} onInput={(v) => set('categoria', v)} requerido deshabilitado={!esAdm} />
          <Campo etiqueta="Marca" valor={f.marca} onInput={(v) => set('marca', v)} deshabilitado={!esAdm} />
          <Campo etiqueta="SKU" valor={f.sku} onInput={(v) => set('sku', v)} deshabilitado={!nuevo || !esAdm} ayuda={nuevo ? undefined : 'El SKU no se edita.'} requerido={nuevo} />
          <Campo etiqueta="Garantía (meses)" valor={f.garantia} onInput={(v) => set('garantia', v)} inputMode="numeric" deshabilitado={!esAdm} />
          <Campo etiqueta="Mínimo de existencias" valor={f.minimo} onInput={(v) => set('minimo', v)} inputMode="numeric" deshabilitado={!esAdm} />
        </div>
        <div class="fila">
          <Casilla etiqueta="Activo" marcado={f.activo} onCambio={(v) => set('activo', v)} deshabilitado={!esAdm} />
          <Casilla etiqueta="Se controla por número de serie" marcado={f.conSerie} onCambio={(v) => set('conSerie', v)} deshabilitado={!esAdm || (!nuevo && (producto?.stockTotal ?? 0) > 0)} />
        </div>
        <fieldset>
          <legend>Precio base en dólares por mercado</legend>
          <div class="cuadricula">
            <div>
              <Campo etiqueta="Bolivia (USD)" valor={f.bo} onInput={(v) => set('bo', v)} inputMode="decimal" requerido deshabilitado={!esAdm} />
              <p class="texto-suave" data-prueba="precio-bo">Hoy: {bo !== null ? <Precio usd={bo} mercado="BO" cot={cot} /> : '—'}</p>
            </div>
            <div>
              <Campo etiqueta="Argentina (USD)" valor={f.ar} onInput={(v) => set('ar', v)} inputMode="decimal" requerido deshabilitado={!esAdm} />
              <p class="texto-suave" data-prueba="precio-ar">Hoy: {ar !== null ? <Precio usd={ar} mercado="AR" cot={cot} /> : '—'}</p>
            </div>
          </div>
        </fieldset>
        {esAdm && (
          <fieldset>
            <legend>Costo y margen (solo administrador)</legend>
            <Campo etiqueta="Costo (USD)" valor={f.costo} onInput={(v) => set('costo', v)} inputMode="decimal" />
            <dl class="datos">
              <Dato etiqueta="Margen Bolivia">{margen(bo ?? 0, costo ?? undefined)}</Dato>
              <Dato etiqueta="Margen Argentina">{margen(ar ?? 0, costo ?? undefined)}</Dato>
            </dl>
          </fieldset>
        )}
        {accion.error && <Alerta>{accion.error}</Alerta>}
        {ok && <Alerta tipo="ok">Producto guardado.</Alerta>}
        {esAdm && <Boton tipo="submit" ocupado={accion.ocupado} deshabilitado={!valido}>{nuevo ? 'Crear producto' : 'Guardar cambios'}</Boton>}
      </form>
    </Seccion>
  );
}

function Productos(): JSX.Element {
  const { api, usuario } = useApp();
  const datos = useCarga(async () => ({ productos: await api.llamar('listarProductos', {}), cot: await api.llamar('cotizacionesVigentes', {}) }), []);
  const [q, setQ] = useState('');
  const [soloAlertas, setSoloAlertas] = useState(false);
  const [ficha, setFicha] = useState<ProductoPanel | 'nuevo' | null>(null);
  if (datos.cargando) return <Cargando />;
  if (datos.error || !datos.datos) return <ErrorCarga error={datos.error ?? 'Sin datos'} reintentar={datos.recargar} />;
  const { productos, cot } = datos.datos;
  const alertas = productos.filter((p) => p.bajoMinimo);
  const t = q.trim().toLowerCase();
  const vis = productos.filter((p) => (!soloAlertas || p.bajoMinimo) && (t === '' || p.nombre.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)));
  return (
    <div>
      {alertas.length > 0 && (
        <Alerta tipo="info">
          Alerta de mínimo: {alertas.map((p) => p.nombre).join(', ')}.
        </Alerta>
      )}
      <Seccion titulo="Productos" acciones={usuario.rol === 'adm' ? <Boton chico onClick={() => setFicha('nuevo')}>Nuevo producto</Boton> : undefined}>
        <div class="cuadricula">
          <Campo etiqueta="Buscar por nombre o SKU" valor={q} onInput={setQ} />
          <Casilla etiqueta="Solo bajo el mínimo" marcado={soloAlertas} onCambio={setSoloAlertas} />
        </div>
        {vis.length === 0 ? (
          <Vacio titulo="No hay productos" detalle="Cambie la búsqueda o cree un producto." />
        ) : (
          <table class="tabla">
            <caption class="solo-lectores">Productos y existencias por almacén</caption>
            <thead>
              <tr>
                <th scope="col">Producto</th>
                {ALM.map((a) => <th key={a.id} scope="col" class="num">{a.texto}</th>)}
                <th scope="col" class="num">Total</th>
                <th scope="col">Estado</th>
                <th scope="col"><span class="solo-lectores">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {vis.map((p) => (
                <tr key={p.id}>
                  <th scope="row">{p.nombre}<div class="texto-suave">{p.sku}</div></th>
                  {ALM.map((a) => <td key={a.id} class="num">{p.existencias[a.id]}</td>)}
                  <td class="num">{p.stockTotal ?? '—'}</td>
                  <td>{!p.activo ? 'Inactivo' : p.bajoMinimo ? 'Bajo el mínimo' : p.disponible ? 'Disponible' : 'Agotado'}</td>
                  <td><Boton chico variante="secundario" onClick={() => setFicha(p)} etiqueta={`Ver ficha de ${p.nombre}`}>Ficha</Boton></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Seccion>
      {ficha !== null && <FichaProducto key={ficha === 'nuevo' ? 'nuevo' : ficha.id} producto={ficha === 'nuevo' ? null : ficha} cot={cot} alGuardar={datos.recargar} alCerrar={() => setFicha(null)} />}
    </div>
  );
}

export function PantallaInventario({ sub }: { sub: string }): JSX.Element {
  const { usuario } = useApp();
  const items = PESTANAS.filter((p) => (p.id === 'ajuste' || p.id === 'csv' ? usuario.rol === 'adm' || p.id === 'csv' : true));
  const actual = items.some((i) => i.id === sub) ? sub : 'productos';
  return (
    <div>
      <h1>Inventario</h1>
      <Pestanas etiqueta="Secciones de inventario" base="inventario" actual={actual} items={items} />
      {actual === 'productos' && <Productos />}
      {actual === 'ingreso' && <Ingreso />}
      {actual === 'traspasos' && <Traspaso />}
      {actual === 'ajuste' && <Ajuste />}
      {actual === 'conteo' && <Conteo />}
      {actual === 'series' && <Series />}
      {actual === 'registro' && <Registro />}
      {actual === 'csv' && <ImportarExportar />}
    </div>
  );
}
