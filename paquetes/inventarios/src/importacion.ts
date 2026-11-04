import type { TransaccionIdentidad } from '@novutienda/nucleo';
import { EntradaInvalida } from './errores.js';
import { UBICACIONES, MAX_LINEAS } from './ids.js';
import type { Autor, Datos } from './motor.js';
import { ejecutarOperacion, exigirAutor, PERMISOS, type ResultadoOperacion } from './operacion.js';
import { prepararProductoNuevo, reservarLimite, validarEntradaProducto, type EntradaProducto } from './productos.js';

export const MAX_BYTES_CSV = 256 * 1024;
const MAX_CELDA = 200;

/** Neutraliza una celda que un programa de planillas interpretaría como fórmula (= + - @, tab, CR). */
export const neutralizarCelda = (v: string): string => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

/** Analiza CSV (RFC 4180): comas, comillas dobles, saltos de línea dentro de comillas. */
export function analizarCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let entre = false;
  let hayCelda = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i] as string;
    if (entre) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          celda += '"';
          i++;
        } else entre = false;
      } else celda += c;
    } else if (c === '"' && celda === '') {
      entre = true;
      hayCelda = true;
    } else if (c === ',') {
      fila.push(celda);
      celda = '';
      hayCelda = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      if (hayCelda || celda !== '') fila.push(celda);
      if (fila.length > 0) filas.push(fila);
      fila = [];
      celda = '';
      hayCelda = false;
    } else celda += c;
  }
  if (entre) throw new EntradaInvalida('CSV con comillas sin cerrar');
  if (hayCelda || celda !== '') fila.push(celda);
  if (fila.length > 0) filas.push(fila);
  return filas;
}

const COLUMNAS = [
  'id', 'nombre', 'categoria', 'marca', 'sku', 'conSerie', 'garantiaMeses', 'minimo', 'precioUSDbo', 'precioUSDar', 'costoUSD', 'activo', 'publicado',
  'stockTienda', 'stockDeposito1', 'stockDeposito2',
] as const;
const OBLIGATORIAS = ['id', 'nombre', 'categoria', 'sku', 'precioUSDbo', 'precioUSDar'];
const COLUMNAS_STOCK = { stockTienda: UBICACIONES[0], stockDeposito1: UBICACIONES[1], stockDeposito2: UBICACIONES[2] } as const;

export interface FilaImportada {
  readonly producto: EntradaProducto;
  readonly stock: readonly { readonly ubicacionId: string; readonly cantidad: number }[];
}

function numero(v: string, nombre: string): number {
  if (!/^\d{1,12}$/.test(v)) throw new EntradaInvalida(`${nombre} debe ser un entero no negativo`);
  return Number(v);
}
function booleano(v: string, nombre: string): boolean {
  if (v !== 'true' && v !== 'false') throw new EntradaInvalida(`${nombre} debe ser true o false`);
  return v === 'true';
}

/** Convierte el CSV en filas validadas. Acumula los errores por fila y lanza una sola `EntradaInvalida`. */
export function leerCsvProductos(csv: string, cargaInicial: boolean): FilaImportada[] {
  if (typeof csv !== 'string' || csv.length === 0 || csv.length > MAX_BYTES_CSV) throw new EntradaInvalida('CSV vacío o demasiado grande');
  const filas = analizarCsv(csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv);
  const [cab, ...datos] = filas;
  if (cab === undefined) throw new EntradaInvalida('CSV sin encabezado');
  for (const c of cab) if (!(COLUMNAS as readonly string[]).includes(c)) throw new EntradaInvalida(`columna desconocida: ${c}`);
  if (new Set(cab).size !== cab.length) throw new EntradaInvalida('columnas repetidas');
  for (const c of OBLIGATORIAS) if (!cab.includes(c)) throw new EntradaInvalida(`falta la columna ${c}`);
  if (!cargaInicial && cab.some((c) => c in COLUMNAS_STOCK)) throw new EntradaInvalida('El CSV no toca el stock: las columnas de stock solo se admiten en la carga inicial');
  if (datos.length < 1 || datos.length > MAX_LINEAS) throw new EntradaInvalida(`El CSV debe tener entre 1 y ${MAX_LINEAS} filas`);

  const errores: string[] = [];
  const salida: FilaImportada[] = [];
  const ids = new Set<string>();
  const skus = new Set<string>();
  for (const [i, f] of datos.entries()) {
    const n = i + 2;
    try {
      if (f.length !== cab.length) throw new EntradaInvalida('número de columnas distinto del encabezado');
      const v = (c: string): string => f[cab.indexOf(c)] ?? '';
      if (f.some((x) => x.length > MAX_CELDA)) throw new EntradaInvalida('celda demasiado larga');
      const opt = (c: string): string | undefined => (cab.includes(c) && v(c) !== '' ? v(c) : undefined);
      const marca = opt('marca');
      const garantia = opt('garantiaMeses');
      const minimo = opt('minimo');
      const costo = opt('costoUSD');
      const conSerie = opt('conSerie');
      const activo = opt('activo');
      const publicado = opt('publicado');
      const producto: EntradaProducto = {
        id: v('id'),
        nombre: neutralizarCelda(v('nombre')),
        categoria: neutralizarCelda(v('categoria')),
        sku: v('sku'),
        ...(marca !== undefined ? { marca: neutralizarCelda(marca) } : {}),
        precioUSD: { bo: numero(v('precioUSDbo'), 'precioUSDbo'), ar: numero(v('precioUSDar'), 'precioUSDar') },
        ...(garantia !== undefined ? { garantiaMeses: numero(garantia, 'garantiaMeses') } : {}),
        ...(minimo !== undefined ? { minimo: numero(minimo, 'minimo') } : {}),
        ...(costo !== undefined ? { costoUSD: numero(costo, 'costoUSD') } : {}),
        ...(conSerie !== undefined ? { conSerie: booleano(conSerie, 'conSerie') } : {}),
        ...(activo !== undefined ? { activo: booleano(activo, 'activo') } : {}),
        ...(publicado !== undefined ? { publicado: booleano(publicado, 'publicado') } : {}),
      };
      const valido = validarEntradaProducto(producto);
      if (ids.has(valido.id)) throw new EntradaInvalida('id repetido en el archivo');
      if (skus.has(valido.sku)) throw new EntradaInvalida('sku repetido en el archivo');
      ids.add(valido.id);
      skus.add(valido.sku);
      const stock: { ubicacionId: string; cantidad: number }[] = [];
      for (const [col, ubicacionId] of Object.entries(COLUMNAS_STOCK)) {
        const x = opt(col);
        if (x === undefined) continue;
        const cantidad = numero(x, col);
        if (cantidad > 0 && valido.conSerie) throw new EntradaInvalida('un producto con serie no admite carga de stock por CSV (use el ingreso con series)');
        if (cantidad > 0) stock.push({ ubicacionId, cantidad });
      }
      salida.push({ producto, stock });
    } catch (err) {
      if (!(err instanceof EntradaInvalida)) throw err;
      errores.push(`fila ${n}: ${err.message}`);
    }
  }
  if (errores.length > 0) throw new EntradaInvalida(`CSV rechazado (${errores.length} error(es))`, errores.slice(0, 20));
  return salida;
}

/**
 * Importa productos desde CSV (adm). Solo crea productos nuevos (hasta 50 filas, todo o nada).
 * El CSV no toca stock salvo en la carga inicial (`cargaInicial: true`, productos sin serie).
 */
export async function importarProductosCsv(
  tx: TransaccionIdentidad,
  e: { tenantId: string; operacionId: string; por: Autor; csv: string; cargaInicial?: boolean },
): Promise<ResultadoOperacion<Datos>> {
  const cargaInicial = e.cargaInicial === true;
  const filas = leerCsvProductos(e.csv, cargaInicial);
  return ejecutarOperacion(tx, {
    tenantId: e.tenantId,
    operacionId: e.operacionId,
    tipo: 'importar-csv',
    accion: 'inventarios.importar-csv',
    carga: { cargaInicial, filas },
    por: exigirAutor(e.por),
    roles: PERMISOS.importacion,
    construir: async (t) => {
      await reservarLimite(t, 'productos', filas.length);
      for (const f of filas) {
        const valido = validarEntradaProducto(f.producto);
        await prepararProductoNuevo(t, valido, UBICACIONES);
        for (const s of f.stock) t.mover(valido.id, s.ubicacionId, s.cantidad, { tipo: 'ingreso' });
      }
      return {
        resultado: { creados: filas.length, productos: filas.map((f) => f.producto.id) },
        referencia: cargaInicial ? { tipo: 'carga-inicial', id: e.operacionId } : { tipo: 'importacion', id: e.operacionId },
        tipoMovimiento: 'ingreso',
      };
    },
  });
}

export interface ProductoExportable {
  readonly id: string;
  readonly nombre: string;
  readonly categoria: string;
  readonly marca?: string;
  readonly sku: string;
  readonly conSerie: boolean;
  readonly garantiaMeses?: number;
  readonly minimo?: number;
  readonly precioUSD: { readonly bo: number; readonly ar: number };
  readonly costoUSD?: number;
  readonly activo: boolean;
  readonly publicado: boolean;
}

const celdaCsv = (v: string): string => {
  const n = neutralizarCelda(v);
  return /[",\r\n]/.test(n) ? `"${n.replace(/"/g, '""')}"` : n;
};

/** Exporta productos a CSV neutralizando toda celda de texto que empiece con = + - @. Sin costos salvo que vengan. */
export function exportarProductosCsv(productos: readonly ProductoExportable[]): string {
  const cab = ['id', 'nombre', 'categoria', 'marca', 'sku', 'conSerie', 'garantiaMeses', 'minimo', 'precioUSDbo', 'precioUSDar', 'costoUSD', 'activo', 'publicado'];
  const filas = productos.map((p) =>
    [
      p.id, p.nombre, p.categoria, p.marca ?? '', p.sku, String(p.conSerie), p.garantiaMeses?.toString() ?? '', p.minimo?.toString() ?? '',
      String(p.precioUSD.bo), String(p.precioUSD.ar), p.costoUSD?.toString() ?? '', String(p.activo), String(p.publicado),
    ].map(celdaCsv).join(','),
  );
  return `${[cab.join(','), ...filas].join('\r\n')}\r\n`;
}
