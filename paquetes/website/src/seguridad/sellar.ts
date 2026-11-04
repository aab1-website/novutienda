/**
 * Sellado y verificación de la CSP sobre el `dist/` generado. Se ejecuta dentro del build:
 * calcula el hash de cada script en línea, escribe `_cabeceras.json` y falla si el HTML
 * contiene algo que la política bloquearía en silencio (manejadores en línea, `style=`,
 * recursos de dominios no declarados, `target=_blank` sin `noopener`).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import type { ConfigMedicion } from '../contenido/tipos.js';
import { cabecerasSeguridad, construirCsp } from './csp.js';

export const ARCHIVO_CABECERAS = '_cabeceras.json';

function* archivos(dir: string, ext: readonly string[]): Generator<string> {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) yield* archivos(ruta, ext);
    else if (ext.includes(extname(nombre))) yield ruta;
  }
}

/** Contenido de cada `<script>` ejecutable sin `src` (los bloques JSON y JSON-LD no se ejecutan). */
export function scriptsEnLinea(html: string): string[] {
  const salida: string[] = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/type\s*=\s*["']?application\/(ld\+)?json["']?/i.test(m[1] ?? '')) continue;
    salida.push(m[2] ?? '');
  }
  return salida;
}

/** Única regla de estilo en línea que Astro emite (hace que sus islas no afecten el diseño). Todo otro `<style>` es un defecto. */
export const ESTILO_ISLAS = 'astro-island,astro-slot,astro-static-slot{display:contents}';

/** Contenido de cada `<style>` en línea. */
export function estilosEnLinea(html: string): string[] {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] ?? '');
}

export const hashDe = (contenido: string): string => `'sha256-${createHash('sha256').update(contenido, 'utf8').digest('base64')}'`;

export interface OpcionesSellado {
  readonly medicion: ConfigMedicion;
  readonly recaptcha: boolean;
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
    const sinDatos = html.replace(/<script[^>]*type\s*=\s*["']?application\/(?:ld\+)?json["']?[^>]*>[\s\S]*?<\/script>/gi, '');
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
