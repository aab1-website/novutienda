// Contrato único de los textos del sitio (misión, visión, chat, viñetas de la ficha y cifra).
// Lo importan el sitio y la consola para no duplicar límites ni reglas. Funciones puras, sin dependencias.

export const LIMITES_TEXTOS_SITIO = {
  /** Misión y visión: de 1 a `texto` caracteres. */
  texto: 600,
  /** Maqueta de chat: de 1 a `mensajes` mensajes de 1 a `mensaje` caracteres. */
  mensajes: 6,
  mensaje: 300,
  /** Características destacadas de un producto: de 1 a `caracteristicas` viñetas de 1 a `caracteristica` caracteres. */
  caracteristicas: 8,
  caracteristica: 160,
  /** Cifra del contador: `valor.texto` de 1 a `cifraValor` y su detalle de 1 a `cifraDetalle`. */
  cifraValor: 20,
  cifraDetalle: 120,
  /** Bloques de «Nosotros»: de 1 a `bloquesNosotros` bloques, cada uno con título y de 1 a `parrafosBloque` párrafos. */
  bloquesNosotros: 6,
  tituloBloque: 80,
  parrafosBloque: 6,
  parrafoBloque: 1000,
} as const;

export type AutorMensajeChat = 'cliente' | 'comercio';

export interface MensajeChatTexto {
  readonly de: AutorMensajeChat;
  readonly texto: string;
}

export interface BloqueNosotros {
  readonly titulo: string;
  readonly parrafos: readonly string[];
}

export interface TextosInstitucionales {
  readonly mision?: string;
  readonly vision?: string;
  readonly chat?: { readonly mensajes: readonly MensajeChatTexto[] };
  /** Bloques con título de la sección «Nosotros»; ausente = no se dibuja. */
  readonly nosotros?: readonly BloqueNosotros[];
}

const largoValido = (v: unknown, max: number): boolean => typeof v === 'string' && v.trim().length >= 1 && v.length <= max;

/** Errores (ruta + motivo) de un texto de 1 a `max` caracteres; lista vacía si es válido. */
export function validarTextoSitio(v: unknown, ruta: string, max: number): string[] {
  return largoValido(v, max) ? [] : [`${ruta}: debe ser un texto de 1 a ${max} caracteres`];
}

/** Errores de una lista de viñetas (1 a 8 de 1 a 160); `undefined` es válido (campo opcional). */
export function validarCaracteristicas(v: unknown, ruta: string): string[] {
  if (v === undefined) return [];
  const L = LIMITES_TEXTOS_SITIO;
  if (!Array.isArray(v) || v.length < 1 || v.length > L.caracteristicas) return [`${ruta}: debe ser una lista de 1 a ${L.caracteristicas} viñetas`];
  return v.flatMap((t, i) => validarTextoSitio(t, `${ruta}[${i}]`, L.caracteristica));
}

/** Errores de la cifra del contador (`valor.texto` y `detalle`); `null` o `undefined` es válido (sin cifra). */
export function validarCifra(v: unknown, ruta: string): string[] {
  if (v === undefined || v === null) return [];
  if (typeof v !== 'object' || Array.isArray(v)) return [`${ruta}: debe ser un objeto`];
  const c = v as Record<string, unknown>;
  const valor = c['valor'];
  const texto = typeof valor === 'object' && valor !== null ? (valor as Record<string, unknown>)['texto'] : undefined;
  return [
    ...validarTextoSitio(texto, `${ruta}.valor.texto`, LIMITES_TEXTOS_SITIO.cifraValor),
    ...validarTextoSitio(c['detalle'], `${ruta}.detalle`, LIMITES_TEXTOS_SITIO.cifraDetalle),
  ];
}

// Sin etiquetas HTML (`<`, `>`) ni caracteres de control (los saltos de línea también lo son).
// eslint-disable-next-line no-control-regex
const CARACTER_NO_PERMITIDO = /[<>\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

const textoLimpio = (v: unknown, ruta: string, max: number): string[] => {
  const e = validarTextoSitio(v, ruta, max);
  if (e.length > 0) return e;
  return CARACTER_NO_PERMITIDO.test(v as string) ? [`${ruta}: no admite HTML, saltos de línea ni caracteres de control`] : [];
};

function validarNosotros(v: unknown, ruta: string): string[] {
  const L = LIMITES_TEXTOS_SITIO;
  if (!Array.isArray(v) || v.length < 1 || v.length > L.bloquesNosotros) return [`${ruta}: debe ser una lista de 1 a ${L.bloquesNosotros} bloques`];
  return v.flatMap((b, i) => {
    const r = `${ruta}[${i}]`;
    if (typeof b !== 'object' || b === null || Array.isArray(b)) return [`${r}: debe ser un objeto`];
    const x = b as Record<string, unknown>;
    const parrafos = x['parrafos'];
    const ep =
      !Array.isArray(parrafos) || parrafos.length < 1 || parrafos.length > L.parrafosBloque
        ? [`${r}.parrafos: debe ser una lista de 1 a ${L.parrafosBloque} párrafos`]
        : parrafos.flatMap((p, j) => textoLimpio(p, `${r}.parrafos[${j}]`, L.parrafoBloque));
    return [...textoLimpio(x['titulo'], `${r}.titulo`, L.tituloBloque), ...ep];
  });
}

/** Errores de los textos institucionales (misión, visión y chat); cada campo es opcional. */
export function validarInstitucional(v: unknown, ruta: string): string[] {
  if (v === undefined) return [];
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return [`${ruta}: debe ser un objeto`];
  const o = v as Record<string, unknown>;
  const L = LIMITES_TEXTOS_SITIO;
  const errores: string[] = [];
  for (const k of ['mision', 'vision'] as const) if (o[k] !== undefined) errores.push(...validarTextoSitio(o[k], `${ruta}.${k}`, L.texto));
  if (o['chat'] !== undefined) {
    const chat = o['chat'];
    const mensajes = typeof chat === 'object' && chat !== null ? (chat as Record<string, unknown>)['mensajes'] : undefined;
    if (!Array.isArray(mensajes) || mensajes.length < 1 || mensajes.length > L.mensajes) {
      errores.push(`${ruta}.chat.mensajes: debe ser una lista de 1 a ${L.mensajes} mensajes`);
    } else {
      mensajes.forEach((m, i) => {
        const x = typeof m === 'object' && m !== null ? (m as Record<string, unknown>) : {};
        const r = `${ruta}.chat.mensajes[${i}]`;
        if (x['de'] !== 'cliente' && x['de'] !== 'comercio') errores.push(`${r}.de: debe ser 'cliente' o 'comercio'`);
        errores.push(...validarTextoSitio(x['texto'], `${r}.texto`, L.mensaje));
      });
    }
  }
  if (o['nosotros'] !== undefined) errores.push(...validarNosotros(o['nosotros'], `${ruta}.nosotros`));
  return errores;
}
