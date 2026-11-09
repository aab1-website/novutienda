// Carga de los fixtures de demostración (catalogo.csv, demo.json, fotos/) desde `scripts/demo/` o desde una carpeta propia
// (`--fixtures <carpeta>`). Una carpeta distinta de la de fábrica puede traer datos reales de un cliente: por eso debe estar
// fuera del repositorio o ignorada por git (misma guardia que las credenciales). Sin identificadores en los mensajes.
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exigirFueraDelRepositorio } from './guardia-operador.mjs';

export const DIR_FIXTURES_DEFECTO = join(dirname(fileURLToPath(import.meta.url)), 'demo');
export const MAX_BYTES_FOTO = 15 * 1024 * 1024; // tope de la regla de Storage

const TIPOS = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic' };

/** Nombre de archivo de foto sin rutas: nada de `/`, `\`, `..` ni caracteres de control. */
export function nombreFotoValido(nombre) {
  return typeof nombre === 'string' && nombre.length > 0 && nombre.length <= 120 && ![...nombre].some((c) => c === '/' || c === '\\' || c.charCodeAt(0) < 32) && !nombre.includes('..') && nombre !== '.';
}

/** contentType de subida según la extensión (jpg, png, webp, heic); lanza para cualquier otra. */
export function tipoContenidoFoto(archivo) {
  const t = TIPOS[extname(archivo).toLowerCase()];
  if (t === undefined) throw new Error('una foto tiene una extensión no admitida (jpg, png, webp o heic)');
  return t;
}

/** Intentos de sondeo (cada uno espera 1,5 s) hasta que el servidor procese una foto: crece con el tamaño y tiene tope. */
export function intentosEspera(bytes) {
  return Math.min(120, 40 + Math.ceil(Math.max(0, bytes) / (512 * 1024)) * 10);
}

const real = (r) => resolve(r);

/**
 * Valida la carpeta y lee los fixtures. `fixtures` indefinido = carpeta de fábrica (versionada, ficticia). Cualquier otra
 * debe estar fuera del repositorio o ignorada por git. Devuelve `{ catalogoCsv, fixture, archivosFoto, bytesFoto, tipos }`.
 */
export function cargarFixtures(fixtures) {
  const personalizada = fixtures !== undefined && real(fixtures) !== real(DIR_FIXTURES_DEFECTO);
  const dir = personalizada ? real(fixtures) : DIR_FIXTURES_DEFECTO;
  if (personalizada) exigirFueraDelRepositorio(dir, 'la carpeta de fixtures');
  const leer = (archivo) => {
    try {
      return readFileSync(join(dir, archivo), 'utf8');
    } catch {
      throw new Error(`no se pudo leer ${archivo} de la carpeta de fixtures`);
    }
  };
  const catalogoCsv = leer('catalogo.csv');
  let fixture;
  try {
    fixture = JSON.parse(leer('demo.json'));
  } catch (e) {
    throw new Error(e instanceof Error && e.message.startsWith('no se pudo leer') ? e.message : 'demo.json no es JSON válido', { cause: e });
  }
  if (!Array.isArray(fixture.fichas)) throw new Error('demo.json no trae «fichas»');
  const archivosFoto = new Map();
  const bytesFoto = {};
  const tipos = {};
  for (const f of fixture.fichas) {
    for (const foto of f.fotos) {
      if (!nombreFotoValido(foto.archivo)) throw new Error('un nombre de foto no es válido (sin «/», «\\» ni «..»)');
      if (archivosFoto.has(foto.archivo)) continue;
      tipos[foto.archivo] = tipoContenidoFoto(foto.archivo);
      const ruta = join(dir, 'fotos', foto.archivo);
      let tam;
      try {
        tam = statSync(ruta).size;
      } catch {
        throw new Error('falta un archivo de foto en la carpeta de fixtures');
      }
      if (tam === 0 || tam > MAX_BYTES_FOTO) throw new Error('una foto está vacía o supera 15 MB');
      archivosFoto.set(foto.archivo, readFileSync(ruta));
      bytesFoto[foto.archivo] = tam;
    }
  }
  return { catalogoCsv, fixture, archivosFoto, bytesFoto, tipos };
}
