import { EntradaInvalida, ErrorInventario } from './errores.js';
import { analizarCsv } from './importacion.js';

/** Tope de bytes del archivo (CSV o xlsx), igual que el de la consola. */
export const MAX_BYTES_ARCHIVO = 2 * 1024 * 1024;
/** Filas de datos por importación (el encabezado no cuenta). */
export const MAX_FILAS_ARCHIVO = 1000;
export const MAX_COLUMNAS_ARCHIVO = 40;
const MAX_LARGO_CELDA = 1000;

/**
 * Puerto de lectura de hojas de cálculo (.xlsx): primera hoja como matriz de texto, sin ejecutar fórmulas (valor
 * guardado de cada celda, como texto). Lo implementa un adaptador que cablea el coordinador; el módulo no trae
 * ninguna librería de planillas.
 */
export interface LectorHojas {
  leerPrimeraHoja(bytes: Uint8Array): Promise<readonly (readonly string[])[]>;
}

const esZip = (b: Uint8Array): boolean => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** Valida los topes sobre una matriz ya leída (de CSV o de xlsx): un archivo no confiable no decide el trabajo del servidor. */
export function validarMatriz(filas: readonly (readonly string[])[]): void {
  if (filas.length === 0) throw new EntradaInvalida('El archivo no tiene encabezado');
  if (filas.length - 1 > MAX_FILAS_ARCHIVO) throw new EntradaInvalida(`Máximo ${String(MAX_FILAS_ARCHIVO)} filas por importación`);
  for (const f of filas) {
    if (f.length > MAX_COLUMNAS_ARCHIVO) throw new EntradaInvalida(`Máximo ${String(MAX_COLUMNAS_ARCHIVO)} columnas`);
    for (const c of f) if (typeof c !== 'string' || c.length > MAX_LARGO_CELDA) throw new EntradaInvalida(`Hay una celda de más de ${String(MAX_LARGO_CELDA)} caracteres`);
  }
}

/**
 * Lee los bytes de un archivo .csv (UTF-8) o .xlsx; se distinguen por la firma ZIP, no por la extensión. Devuelve la
 * matriz de texto para `leerCsvFilas`. Un archivo que no es ni CSV UTF-8 ni xlsx se rechaza con un mensaje claro.
 */
export async function leerArchivoImportacion(contenido: Uint8Array, lector?: LectorHojas): Promise<readonly (readonly string[])[]> {
  if (contenido.length === 0) throw new EntradaInvalida('El archivo está vacío');
  if (contenido.length > MAX_BYTES_ARCHIVO) throw new EntradaInvalida('El archivo supera 2 MB');
  let filas: readonly (readonly string[])[];
  if (esZip(contenido)) {
    if (lector === undefined) throw new ErrorInventario('failed-precondition', 'La lectura de Excel (.xlsx) no está disponible; use CSV');
    try {
      filas = await lector.leerPrimeraHoja(contenido);
    } catch (e) {
      if (e instanceof ErrorInventario) throw e;
      throw new EntradaInvalida('No se pudo leer el archivo Excel: no es un .xlsx válido');
    }
  } else {
    let texto: string;
    try {
      texto = new TextDecoder('utf-8', { fatal: true }).decode(contenido);
    } catch {
      throw new EntradaInvalida('El archivo no es CSV en UTF-8 ni Excel (.xlsx)');
    }
    if (texto.includes('\u0000')) throw new EntradaInvalida('El archivo no es CSV en UTF-8 ni Excel (.xlsx)');
    filas = analizarCsv(texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto);
  }
  validarMatriz(filas);
  return filas;
}
