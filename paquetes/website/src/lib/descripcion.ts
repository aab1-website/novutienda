/**
 * Descripción de la ficha: conversor propio de un Markdown sencillo a bloques tipados.
 *
 * La consola guarda las descripciones con un subconjunto mínimo: `## título` (hasta `####`), listas con `* `, `- ` o `+ `
 * (a veces `* - texto`), `**negrita**` y párrafos. Aquí se convierte en datos (nunca en HTML): el componente que los pinta
 * usa elementos reales y todo texto pasa escapado por Astro, así que un `<script>` se muestra literal. No hay enlaces ni
 * imágenes: `[x](url)` queda como texto. Un texto sin marcas produce párrafos con el mismo texto (los saltos de línea se
 * conservan; el estilo usa `white-space: pre-line`, como antes).
 */

export interface Tramo {
  readonly texto: string;
  readonly negrita: boolean;
}

export type BloqueDescripcion =
  | { readonly tipo: 'titulo'; readonly nivel: 2 | 3 | 4; readonly tramos: readonly Tramo[] }
  | { readonly tipo: 'parrafo'; readonly tramos: readonly Tramo[] }
  | { readonly tipo: 'lista'; readonly items: readonly (readonly Tramo[])[] };

// Todo el análisis es lineal en el largo de la línea: sin cuantificadores anidados ni retroceso (la descripción viene de la consola).
const RE_TITULO = /^\s{0,3}(#{1,6})[ \t]+(.*)$/;
const RE_ITEM = /^\s*[*-][ \t]+(.*)$/;
const esBlanco = (c: string | undefined): boolean => c === ' ' || c === '\t';
const esEspacio = (c: string): boolean => /\s/.test(c);
const esFinDeLinea = (c: string): boolean => c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029';

/** Quita las marcas de cierre de un título (`## Texto ##`): solo si van precedidas de espacio o tab. `C#` queda intacto. */
function sinCierreDeTitulo(resto: string): string {
  const r = resto.trimEnd();
  let i = r.length;
  while (i > 0 && r[i - 1] === '#') i--;
  if (i === r.length || (i > 0 && !esBlanco(r[i - 1]))) return r;
  return r.slice(0, i).trimEnd();
}

/** Quita los marcadores de lista repetidos al inicio (`* - texto`); devuelve el resto, que puede quedar vacío. */
function sinMarcasDeItem(texto: string): string {
  let i = 0;
  for (;;) {
    const c = texto[i];
    if ((c === '*' || c === '-') && esBlanco(texto[i + 1])) {
      i++;
      while (esBlanco(texto[i])) i++;
    } else break;
  }
  return texto.slice(i);
}

/** Una línea formada solo por `*`, `-` y espacios (`* * *`) es un separador, no un ítem. */
const soloMarcas = (t: string): boolean => { for (const c of t) if (c !== '*' && c !== '-' && !esEspacio(c)) return false; return true; };

/** Parte un texto en tramos normales y en negrita. Un `**` sin cierre queda literal. Una pasada, sin retroceso. */
export function tramosDe(texto: string): Tramo[] {
  const tramos: Tramo[] = [];
  const n = texto.length;
  let desde = 0;
  let i = 0;
  while (i + 2 < n) {
    if (texto[i] !== '*' || texto[i + 1] !== '*' || esEspacio(texto[i + 2]!)) { i++; continue; }
    // Cierre: el primer `**` en j >= i+3 cuyo carácter anterior no es blanco, dentro de la misma línea.
    let j = i + 3;
    let cierre = -1;
    for (; j + 1 < n; j++) {
      const previo = texto[j - 1]!;
      if (esFinDeLinea(previo)) break;
      if (texto[j] === '*' && texto[j + 1] === '*' && !esEspacio(previo)) { cierre = j; break; }
    }
    if (cierre < 0) {
      // Ninguna apertura entre i y el fin de línea (o del texto) puede cerrar: se salta hasta ahí.
      i = Math.max(i + 1, j);
      continue;
    }
    if (i > desde) tramos.push({ texto: texto.slice(desde, i), negrita: false });
    tramos.push({ texto: texto.slice(i + 2, cierre), negrita: true });
    desde = cierre + 2;
    i = desde;
  }
  if (desde < n) tramos.push({ texto: texto.slice(desde), negrita: false });
  return tramos;
}

export function convertirDescripcion(entrada: string): BloqueDescripcion[] {
  const bloques: BloqueDescripcion[] = [];
  let parrafo: string[] = [];
  let items: Tramo[][] = [];
  const cerrarParrafo = (): void => {
    if (parrafo.length > 0) bloques.push({ tipo: 'parrafo', tramos: tramosDe(parrafo.join('\n')) });
    parrafo = [];
  };
  const cerrarLista = (): void => {
    if (items.length > 0) bloques.push({ tipo: 'lista', items });
    items = [];
  };
  for (const linea of entrada.replace(/\r\n?/g, '\n').split('\n')) {
    if (linea.trim() === '') { cerrarParrafo(); cerrarLista(); continue; }
    const t = RE_TITULO.exec(linea);
    const textoTitulo = t === null ? '' : sinCierreDeTitulo(t[2] ?? '');
    if (t !== null && textoTitulo !== '') {
      cerrarParrafo(); cerrarLista();
      const marcas = (t[1] ?? '#').length;
      bloques.push({ tipo: 'titulo', nivel: marcas <= 2 ? 2 : marcas === 3 ? 3 : 4, tramos: tramosDe(textoTitulo) });
      continue;
    }
    const it = RE_ITEM.exec(linea);
    if (it !== null) {
      cerrarParrafo();
      const texto = sinMarcasDeItem(it[1] ?? '').trim(); // `* - texto`
      if (texto !== '' && !soloMarcas(texto)) items.push(tramosDe(texto)); // `* * *` es un separador: se omite
      continue;
    }
    cerrarLista();
    parrafo.push(linea.trim());
  }
  cerrarParrafo(); cerrarLista();
  return bloques;
}

const unir = (tramos: readonly Tramo[]): string => tramos.map((t) => t.texto).join('');

/** Texto plano de una descripción (sin marcas, espacios colapsados): resumen de la tarjeta, meta description y JSON-LD. */
export function descripcionPlana(entrada: string): string {
  const partes = convertirDescripcion(entrada).flatMap((b) => (b.tipo === 'lista' ? b.items.map(unir) : [unir(b.tramos)]));
  return partes.join(' ').replace(/\s+/g, ' ').trim();
}

/** Recorta con puntos suspensivos al llegar a `max` caracteres (mismo criterio que el recorte previo: max-3 y «…»). */
export const recortar = (texto: string, max: number): string => (texto.length > max ? `${texto.slice(0, max - 3).trimEnd()}…` : texto);

/**
 * Nivel de encabezado real de cada nivel presente, sin saltar niveles: el menor presente es `base` (en la ficha, 2, porque
 * el `h1` es el nombre del producto) y cada distinto siguiente sube uno, con tope en 6.
 */
export function nivelesReales(bloques: readonly BloqueDescripcion[], base: number): ReadonlyMap<number, number> {
  const presentes = [...new Set(bloques.flatMap((b) => (b.tipo === 'titulo' ? [b.nivel] : [])))].sort((a, b) => a - b);
  return new Map(presentes.map((n, i) => [n, Math.min(base + i, 6)]));
}
