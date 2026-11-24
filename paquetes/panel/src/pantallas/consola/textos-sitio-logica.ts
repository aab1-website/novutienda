/**
 * «Textos del sitio»: misión, visión, cifra de clientes y maqueta de chat. Pasa de los datos del negocio (`sitio/negocio`) al
 * estado del formulario y de vuelta, sin tocar los demás campos del negocio. Los topes son los de la fuente única del núcleo
 * (`LIMITES_TEXTOS_SITIO`).
 */
import { LIMITES_TEXTOS_SITIO, validarCifra, validarInstitucional } from '@novutienda/nucleo';

export const TOPES_TEXTOS = {
  texto: LIMITES_TEXTOS_SITIO.texto, mensajes: LIMITES_TEXTOS_SITIO.mensajes, mensaje: LIMITES_TEXTOS_SITIO.mensaje,
  cifraValor: LIMITES_TEXTOS_SITIO.cifraValor, cifraDetalle: LIMITES_TEXTOS_SITIO.cifraDetalle,
} as const;

export type Emisor = 'cliente' | 'comercio';
export interface MensajeEditable { readonly de: Emisor; readonly texto: string }

/**
 * Topes y formas de los datos de la tienda: COPIA de `LIMITES_NEGOCIO` de `@novutienda/consola/negocio` (el panel no importa la
 * consola); `pruebas/consola/textos-sitio.test.ts` compara cada uno con el original.
 */
export const LIMITES_DATOS = {
  nombre: { min: 1, max: 80 }, lema: { min: 0, max: 160 }, direccion: { min: 1, max: 200 }, horario: { min: 1, max: 200 },
  telefono: { min: 6, max: 30 }, correo: { min: 5, max: 120 },
  formaCorreo: /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/,
  formaTelefono: /^\+?[0-9 ()-]{6,30}$/,
  digitosTelefono: { min: 6, max: 15 },
} as const;

/** Controles C0 y C1, formatos Unicode engañosos y separadores de línea/párrafo (copia de `tieneCaracteresEnganosos`, una línea). */
const RE_ENGANOSO = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const ETIQUETA_HTML = /<\/?[a-zA-Z!][^>]*>/;

/** Largo máximo del enlace del mapa (el del servidor: `LIMITES_NEGOCIO.mapa.max` de `@novutienda/consola/negocio`). */
export const LARGO_MAXIMO_MAPA = 1000;

/**
 * Enlace de Google Maps admitido: https a `www.google.com/maps`, `maps.google.com`, `maps.app.goo.gl` o `goo.gl/maps`, sin
 * credenciales ni puerto. COPIA de `urlMapaSegura` de `@novutienda/consola/negocio` (el panel no importa la consola);
 * `pruebas/consola/textos-sitio.test.ts` fija los mismos casos en ambas.
 */
export function mapaValido(url: string): boolean {
  // eslint-disable-next-line no-control-regex -- se buscan justamente los caracteres de control
  if (url.length === 0 || url.length > LARGO_MAXIMO_MAPA || /[\u0000-\u001f\s\\]/.test(url)) return false;
  const m = /^https:\/\/([^/?#]*)([^?#]*)/.exec(url);
  if (m === null) return false;
  // El anfitrión debe venir ya en minúsculas (el sitio lo compara tal cual) y sin credenciales ni puerto.
  const host = m[1] ?? '';
  if (host !== host.toLowerCase() || host.includes('@') || host.includes(':')) return false;
  const ruta = (m[2] ?? '').toLowerCase();
  // Sin `.` ni `/` ni `\` codificados (`%2e`, `%2f`, `%5c`) ni segmentos `.` o `..`: permitirían salir de `/maps`.
  if (/%2e|%2f|%5c/.test(ruta) || ruta.split('/').some((x) => x === '.' || x === '..')) return false;
  const enMaps = ruta === '/maps' || ruta.startsWith('/maps/');
  if (host === 'www.google.com' || host === 'goo.gl') return enMaps;
  if (host === 'maps.google.com') return ruta === '' || ruta === '/' || enMaps;
  return host === 'maps.app.goo.gl';
}

export interface EstadoTextos {
  /** Datos de la tienda (pie de página y contacto). Nombre y dirección son obligatorios; el resto, opcional (vacío = no se muestra). */
  readonly nombre: string;
  readonly lema: string;
  readonly direccion: string;
  readonly horario: string;
  readonly telefono: string;
  readonly correo: string;
  /** Enlace de Google Maps de la tienda; vacío = sin enlace. */
  readonly mapa: string;
  readonly mision: string;
  readonly vision: string;
  readonly cifraValor: string;
  readonly cifraDetalle: string;
  readonly cifraConfirmada: boolean;
  readonly mensajes: readonly MensajeEditable[];
}

/** Los datos del negocio tal como los guarda el servidor; solo se leen o escriben los campos de esta pantalla. */
export type NegocioCrudo = Readonly<Record<string, unknown>>;

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const txt = (v: unknown): string => (typeof v === 'string' ? v : '');

export const ESTADO_VACIO: EstadoTextos = { nombre: '', lema: '', direccion: '', horario: '', telefono: '', correo: '', mapa: '', mision: '', vision: '', cifraValor: '', cifraDetalle: '', cifraConfirmada: false, mensajes: [] };

export function aEstado(negocio: NegocioCrudo | null): EstadoTextos {
  if (negocio === null) return ESTADO_VACIO;
  const inst = obj(negocio['institucional']);
  const cifra = obj(obj(negocio['identidad'])['cifra']);
  const valor = obj(cifra['valor']);
  const mensajes = Array.isArray(obj(inst['chat'])['mensajes']) ? (obj(inst['chat'])['mensajes'] as unknown[]) : [];
  return {
    nombre: txt(negocio['nombre']), lema: txt(negocio['lema']), direccion: txt(negocio['direccion']),
    horario: txt(negocio['horario']), telefono: txt(negocio['telefono']), correo: txt(negocio['correo']),
    mapa: txt(negocio['mapa']),
    mision: txt(inst['mision']), vision: txt(inst['vision']),
    cifraValor: txt(valor['texto']), cifraDetalle: txt(cifra['detalle']), cifraConfirmada: valor['confirmada'] === true,
    mensajes: mensajes.map((m): MensajeEditable => ({ de: obj(m)['de'] === 'comercio' ? 'comercio' : 'cliente', texto: txt(obj(m)['texto']) })),
  };
}

/** Los datos del negocio con estos textos aplicados. Lo vacío se omite (misión, visión, chat) o queda en `null` (cifra, horario, teléfono, correo). */
const CLAVES_DATOS: readonly string[] = ['nombre', 'lema', 'direccion', 'horario', 'telefono', 'correo'];

export function aNegocio(negocio: NegocioCrudo, e: EstadoTextos): Record<string, unknown> {
  const resto = Object.fromEntries(Object.entries(negocio).filter(([k]) => k !== 'institucional' && k !== 'mapa' && !CLAVES_DATOS.includes(k)));
  const mapa = e.mapa.trim();
  const mision = e.mision.trim();
  const vision = e.vision.trim();
  const mensajes = e.mensajes.map((m) => ({ de: m.de, texto: m.texto.trim() })).filter((m) => m.texto !== '');
  const inst = { ...(mision === '' ? {} : { mision }), ...(vision === '' ? {} : { vision }), ...(mensajes.length === 0 ? {} : { chat: { mensajes } }) };
  const valor = e.cifraValor.trim();
  const detalle = e.cifraDetalle.trim();
  const cifra = valor === '' && detalle === '' ? null : { valor: { texto: valor, confirmada: e.cifraConfirmada }, detalle };
  // Un dato antiguo que no se tocó se envía tal cual lo guardado (aunque tenga espacios en los bordes); solo lo editado se recorta.
  const dato = (k: string, v: string): string => { const g = negocio[k]; return typeof g === 'string' && g.trim() === v.trim() ? g : v.trim(); };
  const opcional = (k: string, v: string): string | null => (v.trim() === '' ? null : dato(k, v));
  return {
    ...resto,
    nombre: dato('nombre', e.nombre), lema: dato('lema', e.lema), direccion: dato('direccion', e.direccion),
    horario: opcional('horario', e.horario), telefono: opcional('telefono', e.telefono), correo: opcional('correo', e.correo),
    ...(mapa === '' ? {} : { mapa }),
    identidad: { ...obj(negocio['identidad']), cifra },
    ...(Object.keys(inst).length === 0 ? {} : { institucional: inst }),
  };
}

/** Clave del campo del formulario al que corresponde un error de la regla del núcleo (por su ruta). */
function claveDeError(msg: string): string {
  const ruta = msg.slice(0, msg.indexOf(':'));
  if (ruta === 'institucional.mision') return 'mision';
  if (ruta === 'institucional.vision') return 'vision';
  if (ruta === 'cifra.valor.texto') return 'cifraValor';
  if (ruta === 'cifra.detalle') return 'cifraDetalle';
  const m = /^institucional\.chat\.mensajes\[(\d+)\]/.exec(ruta);
  return m ? `mensaje.${m[1] ?? ''}` : 'mensajes';
}

type ClaveDato = 'nombre' | 'lema' | 'direccion' | 'horario' | 'telefono' | 'correo';

/**
 * Datos de la tienda, con lo que exige el servidor en `estricto` (`evaluarNegocioSitio`). Como en el servidor, un campo que no se
 * tocó respecto de lo guardado (`inicial`) no se vuelve a exigir en su forma, para que un dato antiguo no impida guardar otro.
 */
function revisarDatos(e: EstadoTextos, inicial: EstadoTextos | undefined, r: Record<string, string>): void {
  const L = LIMITES_DATOS;
  const revisar = (k: ClaveDato, etiqueta: string, ejemplo: string): void => {
    const v = e[k].trim();
    const { min, max } = L[k];
    const opcional = k === 'horario' || k === 'telefono' || k === 'correo';
    if (v === '') {
      if (!opcional && min > 0) r[k] = `Escriba ${etiqueta}. Por ejemplo: ${ejemplo}.`;
      return;
    }
    if (inicial !== undefined && inicial[k].trim() === v) return;
    if (v.length < min) r[k] = `Escriba al menos ${String(min)} caracteres.`;
    else if (v.length > max) r[k] = `Máximo ${String(max)} caracteres.`;
    else if (RE_ENGANOSO.test(v)) r[k] = 'Use solo letras, números y signos comunes, sin saltos de línea.';
    else if (ETIQUETA_HTML.test(v)) r[k] = 'No se admiten etiquetas ni código; escriba solo el texto.';
    else if (k === 'correo' && !L.formaCorreo.test(v)) r[k] = 'Escriba un correo completo. Ejemplo: ventas@sutienda.com.';
    else if (k === 'telefono') {
      const digitos = v.replace(/[^0-9]/g, '').length;
      if (!L.formaTelefono.test(v) || digitos < L.digitosTelefono.min || digitos > L.digitosTelefono.max) r[k] = 'Escriba un número de 6 a 15 dígitos; puede usar +, espacios, paréntesis y guiones. Ejemplo: +591 2 2123456.';
    }
  };
  revisar('nombre', 'el nombre de la tienda', 'Tienda Ejemplo');
  revisar('lema', 'el lema', 'Todo para su hogar');
  revisar('direccion', 'la dirección', 'Av. Principal 123, zona Centro');
  revisar('horario', 'el horario', 'Lunes a sábado, de 9:00 a 19:00');
  revisar('telefono', 'el teléfono', '+591 2 2123456');
  revisar('correo', 'el correo', 'ventas@sutienda.com');
}

/**
 * Errores por campo (`nombre`, `lema`, `direccion`, `horario`, `telefono`, `correo`, `mision`, `vision`, `cifraValor`, `cifraDetalle`, `mensaje.<i>`, `mensajes`). Vacío = se puede guardar.
 * Largos y cantidades los decide la regla del núcleo (`validarInstitucional`, `validarCifra`) sobre lo que se enviaría;
 * aquí solo se redactan los mensajes y se agregan las reglas propias del formulario (cifra y detalle van juntos).
 */
export function revisarTextos(e: EstadoTextos, inicial?: EstadoTextos): Readonly<Record<string, string>> {
  const r: Record<string, string> = {};
  revisarDatos(e, inicial, r);
  const enviado = aNegocio({}, e);
  const cifra = obj(enviado['identidad'])['cifra'];
  const errores = [...validarInstitucional(enviado['institucional'], 'institucional'), ...validarCifra(cifra, 'cifra')];
  for (const msg of errores) {
    const k = claveDeError(msg);
    if (r[k] !== undefined) continue;
    r[k] = k === 'mensajes' ? `Máximo ${String(TOPES_TEXTOS.mensajes)} mensajes.`
      : k === 'cifraValor' ? `Máximo ${String(TOPES_TEXTOS.cifraValor)} caracteres.`
      : k === 'cifraDetalle' ? `Máximo ${String(TOPES_TEXTOS.cifraDetalle)} caracteres.`
      : k === 'mision' || k === 'vision' ? `Máximo ${String(TOPES_TEXTOS.texto)} caracteres.`
      : `Máximo ${String(TOPES_TEXTOS.mensaje)} caracteres.`;
  }
  const mapa = e.mapa.trim();
  if (mapa !== '' && !mapaValido(mapa)) r['mapa'] = 'Pegue un enlace de Google Maps (que empiece con https://www.google.com/maps, https://maps.app.goo.gl o similar).';
  const valor = e.cifraValor.trim();
  const detalle = e.cifraDetalle.trim();
  if (valor === '' && detalle !== '') r['cifraValor'] = 'Escriba la cifra (por ejemplo, «Más de 500 clientes») o borre también el detalle.';
  if (valor !== '' && detalle === '') r['cifraDetalle'] = 'Escriba el detalle de la cifra (por ejemplo, «familias atendidas desde 2015»).';
  if (e.cifraConfirmada && valor === '') r['cifraValor'] = 'No se puede confirmar una cifra vacía.';
  return r;
}

export const iguales = (a: EstadoTextos, b: EstadoTextos): boolean => JSON.stringify(a) === JSON.stringify(b);
