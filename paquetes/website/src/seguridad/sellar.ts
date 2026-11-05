/**
 * Sellado y verificación de la CSP sobre el `dist/` generado. Se ejecuta dentro del build:
 * calcula el hash de cada script en línea, escribe `_cabeceras.json` y falla si el HTML
 * contiene algo que la política bloquearía en silencio (manejadores en línea, `style=`,
 * recursos de dominios no declarados, `target=_blank` sin `noopener`).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import type { ConfigMedicion } from '../contenido/tipos.js';
import { cabecerasSeguridad, construirCsp } from './csp.js';

export const ARCHIVO_CABECERAS = '_cabeceras.json';

function* archivos(dir: string, ext: readonly string[]): Generator<string> {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) yield* archivos(ruta, ext);
    else if (ext.includes(extname(entrada.name))) yield ruta;
  }
}

interface Bloque {
  /** Texto de la etiqueta de apertura entre el nombre y `>` (atributos crudos). */
  readonly atributos: string;
  readonly contenido: string;
  /** Posición del bloque completo en el HTML, para poder quitarlo. */
  readonly inicio: number;
  readonly fin: number;
}

/**
 * Bloques `<etiqueta …>…</etiqueta>` recorridos con `indexOf`, sin expresiones regulares:
 * el HTML del `dist/` es entrada del build y un patrón con cuantificadores anidados
 * sobre él sería vulnerable a ReDoS. La comparación es insensible a mayúsculas.
 */
function bloques(html: string, etiqueta: string): Bloque[] {
  const bajo = html.toLowerCase();
  const apertura = `<${etiqueta}`;
  const cierre = `</${etiqueta}>`;
  const salida: Bloque[] = [];
  let desde = 0;
  for (;;) {
    const inicio = bajo.indexOf(apertura, desde);
    if (inicio < 0) break;
    const trasNombre = inicio + apertura.length;
    const siguiente = bajo.charAt(trasNombre);
    // `<script` también casa con `<scripts…`: exige fin de nombre (espacio, `>` o `/`).
    if (siguiente !== '' && siguiente !== '>' && siguiente !== '/' && !/\s/.test(siguiente)) {
      desde = trasNombre;
      continue;
    }
    const finApertura = bajo.indexOf('>', trasNombre);
    if (finApertura < 0) break;
    const finContenido = bajo.indexOf(cierre, finApertura + 1);
    if (finContenido < 0) break;
    salida.push({
      atributos: html.slice(trasNombre, finApertura),
      contenido: html.slice(finApertura + 1, finContenido),
      inicio,
      fin: finContenido + cierre.length,
    });
    desde = finContenido + cierre.length;
  }
  return salida;
}

const ES_JSON = (atributos: string): boolean => /type\s*=\s*["']?application\/(ld\+)?json["']?/i.test(atributos);
const TIENE_SRC = (atributos: string): boolean => /\bsrc\s*=/i.test(atributos);

/** Contenido de cada `<script>` ejecutable sin `src` (los bloques JSON y JSON-LD no se ejecutan). */
export function scriptsEnLinea(html: string): string[] {
  return bloques(html, 'script')
    .filter((b) => !TIENE_SRC(b.atributos) && !ES_JSON(b.atributos))
    .map((b) => b.contenido);
}

/** El HTML sin los bloques `<script type="application/json|ld+json">`, que son datos y no ejecutan. */
function sinBloquesJson(html: string): string {
  let salida = '';
  let desde = 0;
  for (const b of bloques(html, 'script')) {
    if (!ES_JSON(b.atributos)) continue;
    salida += html.slice(desde, b.inicio);
    desde = b.fin;
  }
  return salida + html.slice(desde);
}

/** Única regla de estilo en línea que Astro emite (hace que sus islas no afecten el diseño). Todo otro `<style>` es un defecto. */
export const ESTILO_ISLAS = 'astro-island,astro-slot,astro-static-slot{display:contents}';

/** Contenido de cada `<style>` en línea. */
export function estilosEnLinea(html: string): string[] {
  return bloques(html, 'style').map((b) => b.contenido);
}

export const hashDe = (contenido: string): string => `'sha256-${createHash('sha256').update(contenido, 'utf8').digest('base64')}'`;

export interface OpcionesSellado {
  readonly medicion: ConfigMedicion;
  readonly recaptcha: boolean;
  readonly appCheck?: boolean;
  readonly origenMedios: string | null;
}

/** Hashes únicos de todos los scripts en línea del directorio, ordenados. */
export function hashesDeDist(dir: string): string[] {
  const hashes = new Set<string>();
  for (const f of archivos(dir, ['.html'])) for (const s of scriptsEnLinea(readFileSync(f, 'utf8'))) hashes.add(hashDe(s));
  return [...hashes].sort();
}

/** Hashes de los estilos en línea autorizados (solo `ESTILO_ISLAS`). */
export function hashesEstiloDeDist(dir: string): string[] {
  const hashes = new Set<string>();
  for (const f of archivos(dir, ['.html'])) {
    for (const s of estilosEnLinea(readFileSync(f, 'utf8'))) if (s === ESTILO_ISLAS) hashes.add(hashDe(s));
  }
  return [...hashes].sort();
}

const HOSTS_DE_CARGA = /(?:\bsrc|\bhref|\bposter|\bsrcset|\baction)\s*=\s*["'](https?:)?\/\/([^/"'?#\s]+)/gi;

export interface Problema {
  readonly archivo: string;
  readonly motivo: string;
}

/** Revisa el HTML y el CSS del `dist/` en busca de lo que la CSP bloquearía o de prácticas prohibidas. */
export function verificarDist(dir: string, permitidos: readonly string[] = []): Problema[] {
  const problemas: Problema[] = [];
  const falla = (archivo: string, motivo: string): void => void problemas.push({ archivo: relative(dir, archivo), motivo });
  for (const f of archivos(dir, ['.html'])) {
    const html = readFileSync(f, 'utf8');
    const sinDatos = sinBloquesJson(html);
    if (/\son[a-z]+\s*=\s*["']/i.test(sinDatos)) falla(f, 'manejador de eventos en línea (onclick=…)');
    if (/\sstyle\s*=\s*["']/i.test(sinDatos)) falla(f, 'atributo style en línea (la CSP lo bloquea)');
    for (const s of estilosEnLinea(sinDatos)) if (s !== ESTILO_ISLAS) falla(f, 'etiqueta <style> en línea no autorizada (la CSP la bloquea)');
    if (/(?:href|src|action)\s*=\s*["']\s*javascript:/i.test(sinDatos)) falla(f, 'URL javascript:');
    for (const m of sinDatos.matchAll(/<a\b[^>]*\btarget\s*=\s*["']_blank["'][^>]*>/gi)) {
      if (!/\brel\s*=\s*["'][^"']*\bnoopener\b/i.test(m[0])) falla(f, `enlace con target=_blank sin noopener: ${m[0].slice(0, 80)}`);
    }
    for (const m of sinDatos.matchAll(HOSTS_DE_CARGA)) {
      const host = m[2] ?? '';
      if (!permitidos.includes(host)) falla(f, `recurso o enlace a un dominio externo no declarado: ${host}`);
    }
  }
  for (const f of archivos(dir, ['.css'])) {
    const css = readFileSync(f, 'utf8');
    for (const m of css.matchAll(/url\(\s*["']?(https?:)?\/\/([^/)"'\s]+)/gi)) falla(f, `CSS carga un recurso externo: ${m[2] ?? ''}`);
    if (/@import\s+(?:url\()?["']?https?:/i.test(css)) falla(f, 'CSS con @import externo');
  }
  return problemas;
}

/** Calcula los hashes, escribe `_cabeceras.json` y devuelve la CSP resultante. */
export function sellarDist(dir: string, o: OpcionesSellado): string {
  const csp = construirCsp({ hashesScript: hashesDeDist(dir), hashesEstilo: hashesEstiloDeDist(dir), ...o });
  const cabeceras = { source: '**', headers: cabecerasSeguridad(csp) };
  writeFileSync(join(dir, ARCHIVO_CABECERAS), `${JSON.stringify([cabeceras], null, 2)}\n`, 'utf8');
  return csp;
}
