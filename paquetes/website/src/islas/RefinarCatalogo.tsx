import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Mercado, Redondeo } from '@novutienda/nucleo';
import { agotadosAhora } from '../lib/disponibilidad-viva.js';
import { monedaDe } from '../lib/mercado.js';
import { precioLocal } from '../lib/precio-vista.js';
import { contarFiltros, limitesDePrecio, refinar, SIN_FILTROS, type Refinado } from '../lib/refinar.js';
import { textoProductos } from '../lib/paginas.js';
import { Deslizante, textoPrecio } from './Deslizante.js';
import { Dialogo } from './Dialogo.js';
import { useCotizacion, useMercado } from './estado.js';
import { Icono } from './Icono.js';
import { TarjetaCatalogo, type EntradaCatalogo } from './TarjetaCatalogo.js';

interface Props {
  /** Alcance de la página: toda la categoría o toda la marca (no solo la página visible); sin alcance = todo el catálogo. */
  categoria?: string;
  marca?: string;
  /** Marcas del alcance (ya unificadas), para las pastillas. */
  marcas: readonly string[];
  inicial: Mercado;
  mercados: readonly Mercado[];
  redondeo: Redondeo;
  whatsapp: string | null;
  indice?: string;
}

const ANCHO_COLUMNA = '(min-width: 901px)';

/**
 * «Refinar la búsqueda»: UN solo componente de filtros (nombre, marcas, precio) que se presenta como columna a la izquierda en la
 * computadora o como hoja inferior en el celular. Actúa sobre TODO el catálogo con el índice estático (`/indice-productos.json`).
 * Las tarjetas de la página ya vienen en el HTML (sin JavaScript se ven); con filtros activos se ocultan y se pintan los resultados.
 */
export default function RefinarCatalogo({ categoria, marca, marcas, inicial, mercados, redondeo, whatsapp, indice = '/indice-productos.json' }: Props) {
  const [mercado] = useMercado(inicial, mercados);
  const cot = useCotizacion(mercado);
  const [filtro, setFiltro] = useState<Refinado>(SIN_FILTROS);
  const [abierto, setAbierto] = useState(false);
  const [columna, setColumna] = useState(false);
  const [entradas, setEntradas] = useState<readonly EntradaCatalogo[] | null>(null);
  const [agotados, setAgotados] = useState<ReadonlySet<string>>(new Set());
  const [fallo, setFallo] = useState(false);
  const pedido = useRef(false);

  useEffect(() => {
    const m = window.matchMedia(ANCHO_COLUMNA);
    const poner = (): void => setColumna(m.matches);
    poner();
    m.addEventListener('change', poner);
    return () => m.removeEventListener('change', poner);
  }, []);

  const cargar = (): void => {
    if (pedido.current) return;
    pedido.current = true;
    setFallo(false);
    fetch(indice, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('indice'))))
      .then((j: readonly EntradaCatalogo[]) => {
        setEntradas(j);
        void agotadosAhora(j.map((e) => e.i)).then(setAgotados);
      })
      .catch(() => {
        pedido.current = false;
        setFallo(true);
      });
  };
  useEffect(() => {
    if (columna || abierto) cargar();
  }, [columna, abierto]);

  // Productos que se agotaron después de construir el sitio: se ocultan de las tarjetas que ya vienen en la página.
  useEffect(() => {
    const tarjetas = Array.from(document.querySelectorAll<HTMLElement>('[data-lista-servidor] [data-producto-id]'));
    void agotadosAhora(tarjetas.map((t) => t.dataset['productoId'] ?? '')).then((a) => {
      for (const t of tarjetas) t.hidden = a.has(t.dataset['productoId'] ?? '');
    });
  }, []);

  const precioDe = (e: EntradaCatalogo): number | null => precioLocal(e.p[mercado], mercado, cot, redondeo);
  const enAlcance = useMemo(
    () => (entradas ?? []).filter((e) => (categoria === undefined || e.c === categoria) && (marca === undefined || e.marca === marca) && !agotados.has(e.i)),
    [entradas, categoria, marca, agotados],
  );
  const limites = useMemo(() => limitesDePrecio(enAlcance.map(precioDe)), [enAlcance, mercado, cot, redondeo]);
  const resultados = useMemo(() => refinar(enAlcance, filtro, precioDe), [enAlcance, filtro, mercado, cot, redondeo]);

  // Cambiar de moneda cambia los límites: el filtro de precio se reinicia.
  useEffect(() => setFiltro((f) => (f.rango === null ? f : { ...f, rango: null })), [mercado]);

  const activos = contarFiltros(filtro);
  const hay = activos > 0;
  useEffect(() => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-lista-servidor], nav.paginacion')) el.hidden = hay;
  }, [hay]);

  // En el celular la categoría actual se deja a la vista en su fila con desplazamiento.
  useEffect(() => {
    const fila = document.querySelector<HTMLElement>('.nav-categorias');
    const actual = fila?.querySelector<HTMLElement>('[aria-current="page"]');
    if (fila !== null && fila !== undefined && actual !== null && actual !== undefined) fila.scrollLeft = Math.max(0, actual.offsetLeft - fila.offsetLeft - 16);
  }, []);

  const moneda = monedaDe(mercado);
  const quitarMarca = (m: string): void => setFiltro((f) => ({ ...f, marcas: f.marcas.filter((x) => x !== m) }));
  const alternarMarca = (m: string): void => setFiltro((f) => ({ ...f, marcas: f.marcas.includes(m) ? f.marcas.filter((x) => x !== m) : [...f.marcas, m] }));
  const cambiarRango = (bajo: number, alto: number): void =>
    setFiltro((f) => ({ ...f, rango: limites !== null && bajo <= limites.min && alto >= limites.max ? null : [bajo, alto] }));

  const panel = (enHoja: boolean) => (
    <form class={enHoja ? 'refinar-panel' : 'refinar-panel refinar-columna'} aria-label="Refinar la búsqueda" onSubmit={(e) => e.preventDefault()}>
      <label class="refinar-campo">
        <span class="refinar-titulo">Nombre</span>
        <input type="search" value={filtro.texto} placeholder="Nombre del producto" autocomplete="off" onInput={(e) => setFiltro({ ...filtro, texto: (e.target as HTMLInputElement).value })} />
      </label>
      {marca === undefined && marcas.length > 1 && (
        <fieldset class="refinar-grupo">
          <legend class="refinar-titulo">Marca</legend>
          <div class="refinar-marcas">
            {marcas.map((m) => (
              <button key={m} type="button" class="refinar-pastilla" aria-pressed={filtro.marcas.includes(m)} onClick={() => alternarMarca(m)}>{m}</button>
            ))}
          </div>
        </fieldset>
      )}
      <div class="refinar-grupo">
        <p class="refinar-titulo">Precio ({moneda})</p>
        {limites !== null ? (
          <>
            <Deslizante min={limites.min} max={limites.max} paso={limites.paso} bajo={filtro.rango?.[0] ?? limites.min} alto={filtro.rango?.[1] ?? limites.max} moneda={moneda} onCambio={cambiarRango} />
            <p class="refinar-rango" aria-hidden="true">
              <span>{textoPrecio(filtro.rango?.[0] ?? limites.min, moneda)}</span>
              <span>{textoPrecio(filtro.rango?.[1] ?? limites.max, moneda)}</span>
            </p>
          </>
        ) : (
          <p class="aviso-estado">{entradas === null ? 'Cargando precios…' : 'No hay un rango de precios para elegir.'}</p>
        )}
      </div>
      {fallo && <p class="aviso-estado" role="alert">No pudimos cargar el catálogo. Revisa tu conexión e inténtalo de nuevo.</p>}
      <div class="refinar-acciones">
        {enHoja && <button type="button" class="boton boton-cta boton-compacto" onClick={() => setAbierto(false)}>Ver {textoProductos(resultados.length)}</button>}
        <button type="button" class="boton boton-secundario boton-compacto" disabled={!hay} onClick={() => setFiltro(SIN_FILTROS)}>Limpiar</button>
      </div>
    </form>
  );

  return (
    <>
      {columna && <aside class="filtros" aria-label="Filtros">{panel(false)}</aside>}
      <div class="refinar-superior">
        <div class="refinar-barra">
          {!columna && (
            <button
              type="button" class="refinar-boton" aria-haspopup="dialog" aria-expanded={abierto}
              aria-label={hay ? `Refinar la búsqueda, ${activos} ${activos === 1 ? 'filtro activo' : 'filtros activos'}` : 'Refinar la búsqueda'}
              onClick={() => setAbierto(true)} onPointerEnter={cargar} onFocus={cargar}
            >
              <Icono nombre="filtro" tamano={16} />
              <span>Refinar la búsqueda</span>
              {hay && <span class="refinar-cuenta" aria-hidden="true">{activos}</span>}
            </button>
          )}
          {hay && (
            <ul class="refinar-chips" aria-label="Filtros activos">
              {filtro.texto.trim() !== '' && <li><button type="button" class="refinar-chip" aria-label={`Quitar el filtro «${filtro.texto.trim()}»`} onClick={() => setFiltro({ ...filtro, texto: '' })}>«{filtro.texto.trim()}» <Icono nombre="x" tamano={12} /></button></li>}
              {filtro.marcas.map((m) => <li key={m}><button type="button" class="refinar-chip" aria-label={`Quitar la marca ${m}`} onClick={() => quitarMarca(m)}>{m} <Icono nombre="x" tamano={12} /></button></li>)}
              {filtro.rango !== null && <li><button type="button" class="refinar-chip" aria-label="Quitar el filtro de precio" onClick={() => setFiltro({ ...filtro, rango: null })}>{textoPrecio(filtro.rango[0], moneda)} – {textoPrecio(filtro.rango[1], moneda)} <Icono nombre="x" tamano={12} /></button></li>}
            </ul>
          )}
        </div>
        <p class="aviso-estado refinar-estado" role="status">{hay && entradas !== null ? textoProductos(resultados.length) : ''}</p>
        {hay && entradas !== null && resultados.length === 0 && (
          <p class="aviso-estado">No encontramos productos con esos filtros. <button type="button" class="enlace-boton" onClick={() => setFiltro(SIN_FILTROS)}>Limpiar filtros</button></p>
        )}
        {hay && resultados.length > 0 && (
          <div class="grilla-productos">
            {resultados.map((e) => <TarjetaCatalogo key={e.i} e={e} inicial={inicial} mercados={mercados} redondeo={redondeo} whatsapp={whatsapp} />)}
          </div>
        )}
      </div>
      {!columna && abierto && (
        <Dialogo titulo="Refinar la búsqueda" variante="inferior" onCerrar={() => setAbierto(false)}>{panel(true)}</Dialogo>
      )}
    </>
  );
}
