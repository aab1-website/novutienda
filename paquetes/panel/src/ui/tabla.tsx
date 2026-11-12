import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useIdUnico } from './ids.js';
import { filtrar, ordenar, paginar, type Orden } from './tabla-logica.js';
import '../estilos/tabla.css';

export interface ColumnaTabla<F> {
  readonly id: string;
  readonly titulo: string;
  readonly valor: (fila: F) => string | number;
  readonly celda?: ((fila: F) => ComponentChildren) | undefined;
  /** La celda de esta columna es el encabezado de la fila (una sola por tabla, normalmente la primera). */
  readonly encabezadoFila?: boolean | undefined;
  readonly ordenable?: boolean | undefined;
}

export interface FiltroTabla<F> {
  readonly id: string;
  readonly etiqueta: string;
  readonly opciones: readonly { readonly valor: string; readonly texto: string }[];
  readonly aplica: (fila: F, valor: string) => boolean;
}

export interface PropsTabla<F> {
  readonly titulo: string;
  readonly filas: readonly F[];
  readonly clave: (fila: F) => string;
  readonly columnas: readonly ColumnaTabla<F>[];
  readonly buscar?: { readonly etiqueta: string; readonly en: (fila: F) => string[] } | undefined;
  readonly filtros?: readonly FiltroTabla<F>[] | undefined;
  readonly porPagina?: number | undefined;
  /** Última columna, sin título visible, para los botones de cada fila. */
  readonly acciones?: ((fila: F) => ComponentChildren) | undefined;
  readonly vacio?: { readonly titulo: string } | undefined;
  /** La lista que llegó está cortada por un tope: se avisa cuántas se muestran. */
  readonly cortada?: { readonly mostradas: number; readonly mensaje: string } | undefined;
  readonly masDelServidor?: { readonly hay: boolean; readonly cargar: () => void; readonly cargando: boolean } | undefined;
  readonly vistaCelular?: 'tarjetas' | 'desplazar' | undefined;
}

const AJUSTE_ARIA = { asc: 'ascending', desc: 'descending' } as const;

/**
 * Tabla del panel: búsqueda sin tildes, filtros, orden por columna, páginas y aviso de lista cortada. Lleva roles
 * explícitos para seguir siendo una tabla aunque el CSS cambie `display` (en celular se vuelve tarjetas).
 */
export function Tabla<F>(p: PropsTabla<F>): JSX.Element {
  const id = useIdUnico();
  const porPagina = p.porPagina ?? 25;
  const [texto, setTexto] = useState('');
  const [valores, setValores] = useState<Record<string, string>>({});
  const [orden, setOrden] = useState<Orden>(null);
  const [pagina, setPagina] = useState(1);

  const contenedor = useRef<HTMLDivElement>(null);
  const [desplaza, setDesplaza] = useState(false);
  useEffect(() => {
    const el = contenedor.current;
    if (el === null) {
      setDesplaza(false);
      return undefined;
    }
    const medir = (): void => setDesplaza(el.scrollWidth > el.clientWidth);
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  });

  const vacia = p.filas.length === 0;

  const filtros = p.filtros ?? [];
  const visibles = filtrar(p.filas, texto, p.buscar?.en, filtros, valores);
  const colOrden = orden === null ? undefined : p.columnas.find((c) => c.id === orden.columna);
  const ordenadas = ordenar(visibles, colOrden?.valor, orden);
  const pag = paginar(ordenadas, pagina, porPagina);
  const modo = p.vistaCelular ?? (p.columnas.length > 4 ? 'tarjetas' : 'desplazar');

  const alternar = (col: string): void => {
    setOrden((o) => (o === null || o.columna !== col ? { columna: col, sentido: 'asc' } : o.sentido === 'asc' ? { columna: col, sentido: 'desc' } : null));
    setPagina(1);
  };
  const hayControles = !vacia && (p.buscar !== undefined || filtros.length > 0);

  return (
    <div class="tabla-bloque">
      {hayControles && (
        <div class="tabla-controles">
          {p.buscar && (
            <div class="campo tabla-buscar">
              <label for={`${id}-buscar`}>{p.buscar.etiqueta}</label>
              <input id={`${id}-buscar`} type="search" value={texto} autocomplete="off" onInput={(e) => { setTexto((e.currentTarget as HTMLInputElement).value); setPagina(1); }} />
            </div>
          )}
          {filtros.map((f) => (
            <div class="campo" key={f.id}>
              <label for={`${id}-f-${f.id}`}>{f.etiqueta}</label>
              <select id={`${id}-f-${f.id}`} value={valores[f.id] ?? ''} onChange={(e) => { setValores({ ...valores, [f.id]: (e.currentTarget as HTMLSelectElement).value }); setPagina(1); }}>
                <option value="">Todos</option>
                {f.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
      {p.cortada && <p class="tabla-aviso" role="status">{p.cortada.mensaje}</p>}
      {!vacia && <p class="solo-lectores" role="status" aria-live="polite">{`Se muestran ${pag.filas.length} de ${pag.total}`}</p>}
      {vacia ? (
        <div class="vacio"><p class="vacio-titulo">{p.vacio?.titulo ?? 'No hay datos'}</p></div>
      ) : pag.total === 0 ? (
        <p class="tabla-sin-resultados">Sin resultados con esa búsqueda o esos filtros.</p>
      ) : (
        <div ref={contenedor} class="tabla-contenedor" role="region" aria-label={p.titulo} tabIndex={desplaza ? 0 : undefined}>
          <table class={`tabla tabla-${modo}`} role="table">
            <caption class="solo-lectores">{p.titulo}</caption>
            <thead role="rowgroup">
              <tr role="row">
                {p.columnas.map((c) => (
                  <th key={c.id} scope="col" role="columnheader" aria-sort={c.ordenable ? (orden?.columna === c.id ? AJUSTE_ARIA[orden.sentido] : 'none') : undefined}>
                    {c.ordenable ? (
                      <button type="button" class="tabla-orden" onClick={() => alternar(c.id)}>
                        {c.titulo}
                        <span aria-hidden="true">{orden?.columna === c.id ? (orden.sentido === 'asc' ? ' ▲' : ' ▼') : ' ↕'}</span>
                      </button>
                    ) : (
                      c.titulo
                    )}
                  </th>
                ))}
                {p.acciones && <th scope="col" role="columnheader"><span class="solo-lectores">Acciones</span></th>}
              </tr>
            </thead>
            <tbody role="rowgroup">
              {pag.filas.map((fila) => (
                <tr key={p.clave(fila)} role="row">
                  {p.columnas.map((c) =>
                    c.encabezadoFila ? (
                      <th key={c.id} scope="row" role="rowheader" data-etiqueta={c.titulo}>{c.celda ? c.celda(fila) : c.valor(fila)}</th>
                    ) : (
                      <td key={c.id} role="cell" data-etiqueta={c.titulo}>{c.celda ? c.celda(fila) : c.valor(fila)}</td>
                    ),
                  )}
                  {p.acciones && <td role="cell">{p.acciones(fila)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pag.paginas > 1 && (
        <nav class="tabla-paginas" aria-label={`Páginas de ${p.titulo}`}>
          <button type="button" class="boton boton-secundario boton-chico" disabled={pag.pagina <= 1} onClick={() => setPagina(pag.pagina - 1)}>Anterior</button>
          <span class="texto-suave">{`${pag.desde}–${pag.hasta} de ${pag.total}`}</span>
          <button type="button" class="boton boton-secundario boton-chico" disabled={pag.pagina >= pag.paginas} onClick={() => setPagina(pag.pagina + 1)}>Siguiente</button>
        </nav>
      )}
      {p.masDelServidor?.hay && (
        <div class="fila">
          <button type="button" class="boton boton-secundario" disabled={p.masDelServidor.cargando} onClick={p.masDelServidor.cargar}>
            {p.masDelServidor.cargando ? 'Cargando…' : 'Cargar más'}
          </button>
        </div>
      )}
    </div>
  );
}
