/**
 * Reglas de contenido que el sitio exige y que Inventarios, la consola y el panel
 * comparten para rechazar el dato antes de que llegue a una publicación.
 * Funciones puras, sin dependencias.
 */

/** Tope de un precio o costo, en unidades de la moneda base. */
export const TOPE_PRECIO_BASE = 1_000_000;
/** El mismo tope en centavos (Inventarios guarda centavos). */
export const TOPE_PRECIO_BASE_CENTAVOS = TOPE_PRECIO_BASE * 100;

export const RE_SLUG_SITIO = /^[a-z0-9][a-z0-9-]{0,79}$/;
export const LARGO_MAXIMO_CATEGORIA = 60;
export const MAX_CATEGORIAS_SITIO = 40;

/** Razón máxima entre el precio mayor y el menor de un producto antes de avisar. */
const RAZON_DESPROPORCION = 10;

export function esCategoriaValida(valor: string): boolean {
  return (
    typeof valor === 'string' && valor.length <= LARGO_MAXIMO_CATEGORIA && RE_SLUG_SITIO.test(valor)
  );
}

/** Convierte un texto libre en un slug: sin tildes, minúsculas, guiones, hasta 60. */
export function sugerirCategoria(texto: string): string {
  const slug = String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LARGO_MAXIMO_CATEGORIA)
    .replace(/-+$/g, '');
  return slug;
}

export function mensajeCategoriaInvalida(valor: string): string {
  const sugerencia = sugerirCategoria(valor);
  if (sugerencia === '') {
    return 'La categoría va en minúsculas, sin tildes ni espacios, solo letras, números y guiones.';
  }
  return `La categoría va en minúsculas, sin tildes ni espacios: use «${sugerencia}».`;
}

/** true si el importe en centavos supera el tope (o no es un número finito). */
export function excedeTopeCentavos(centavos: number): boolean {
  return !Number.isFinite(centavos) || centavos > TOPE_PRECIO_BASE_CENTAVOS;
}

/** Entero con miles separados por punto (sin Intl, igual en servidor, panel y pruebas). */
export function conMiles(n: number): string {
  const entero = Math.trunc(n);
  const texto = String(Math.abs(entero)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return entero < 0 ? `-${texto}` : texto;
}

/** Nombre en español de las monedas que el producto conoce. */
export const NOMBRES_MONEDA: Readonly<Record<string, string>> = Object.freeze({
  USD: 'dólares',
  BOB: 'bolivianos',
  ARS: 'pesos argentinos',
});

/** Nombre de la moneda, o el propio código si no se conoce. */
export function nombreDeMoneda(codigo: string): string {
  return Object.hasOwn(NOMBRES_MONEDA, codigo) ? (NOMBRES_MONEDA[codigo] as string) : codigo;
}

/** Mensaje para un costo que supera el tope; la moneda del costo va como código. */
export function mensajeCostoSobreTope(monedaCosto: string): string {
  return `El costo va en ${monedaCosto} y supera el tope de ${conMiles(TOPE_PRECIO_BASE)}: revise que no tenga ceros de más ni esté en otra moneda.`;
}

/**
 * Mensaje para un dato ya guardado que no cumple al editar o importar.
 * `campo` viene con su artículo y, si corresponde, su valor entre comillas angulares,
 * p. ej. «La categoría guardada «Audio»» o «El costo guardado»; `detalle` es la
 * oración que explica qué falla (termina en punto).
 */
export function mensajeGuardadoInvalido(campo: string, detalle: string): string {
  return `${campo} no cumple: ${detalle} Corríjalo antes de guardar.`;
}

export interface MercadoPrecio {
  /** Nombre visible del mercado (p. ej. un país). */
  readonly nombre: string;
  readonly monedaBase: string;
  readonly monedaVenta: string;
}

/**
 * Mensaje para un precio de mercado que supera el tope. Si el mercado vende en una
 * moneda distinta de la base, pregunta si se cargó en la moneda de venta.
 */
export function mensajePrecioSobreTope(mercado: MercadoPrecio, nombreMonedaVenta?: string): string {
  const base = `El precio de ${mercado.nombre} va en ${mercado.monedaBase} (moneda base) y supera el tope de ${conMiles(TOPE_PRECIO_BASE)}`;
  if (mercado.monedaVenta === mercado.monedaBase) return `${base}.`;
  const nombre = nombreMonedaVenta ?? nombreDeMoneda(mercado.monedaVenta);
  return `${base}: ¿lo cargó en ${nombre}?`;
}

export interface MercadoMoneda {
  readonly id: string;
  readonly nombre: string;
  readonly monedaBase: string;
}

/**
 * Avisos (nunca bloquean) cuando el precio mayor supera en más de 10 veces al menor
 * entre mercados de la misma moneda base. Precios en centavos; los 0 o inválidos se ignoran.
 */
export function avisoDesproporcion(
  precios: Readonly<Record<string, number>>,
  mercados: ReadonlyArray<MercadoMoneda>,
): string[] {
  const porMoneda = new Map<string, Array<{ nombre: string; precio: number }>>();
  for (const m of mercados) {
    const precio = precios[m.id];
    if (typeof precio !== 'number' || !Number.isFinite(precio) || precio <= 0) continue;
    const lista = porMoneda.get(m.monedaBase) ?? [];
    lista.push({ nombre: m.nombre, precio });
    porMoneda.set(m.monedaBase, lista);
  }
  const avisos: string[] = [];
  for (const [moneda, lista] of porMoneda) {
    if (lista.length < 2) continue;
    let min = lista[0]!;
    let max = lista[0]!;
    for (const e of lista) {
      if (e.precio < min.precio) min = e;
      if (e.precio > max.precio) max = e;
    }
    if (max.precio / min.precio > RAZON_DESPROPORCION) {
      avisos.push(
        `El precio de ${max.nombre} es más de ${RAZON_DESPROPORCION} veces el de ${min.nombre} (ambos en ${moneda}): revise que no haya un error de moneda o de ceros.`,
      );
    }
  }
  return avisos;
}
