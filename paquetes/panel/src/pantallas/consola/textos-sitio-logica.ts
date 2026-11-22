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

export interface EstadoTextos {
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

export const ESTADO_VACIO: EstadoTextos = { mision: '', vision: '', cifraValor: '', cifraDetalle: '', cifraConfirmada: false, mensajes: [] };

export function aEstado(negocio: NegocioCrudo | null): EstadoTextos {
  if (negocio === null) return ESTADO_VACIO;
  const inst = obj(negocio['institucional']);
  const cifra = obj(obj(negocio['identidad'])['cifra']);
  const valor = obj(cifra['valor']);
  const mensajes = Array.isArray(obj(inst['chat'])['mensajes']) ? (obj(inst['chat'])['mensajes'] as unknown[]) : [];
  return {
    mision: txt(inst['mision']), vision: txt(inst['vision']),
    cifraValor: txt(valor['texto']), cifraDetalle: txt(cifra['detalle']), cifraConfirmada: valor['confirmada'] === true,
    mensajes: mensajes.map((m): MensajeEditable => ({ de: obj(m)['de'] === 'comercio' ? 'comercio' : 'cliente', texto: txt(obj(m)['texto']) })),
  };
}

/** Los datos del negocio con estos textos aplicados. Lo vacío se omite (misión, visión, chat) o queda en `null` (cifra). */
export function aNegocio(negocio: NegocioCrudo, e: EstadoTextos): Record<string, unknown> {
  const resto = Object.fromEntries(Object.entries(negocio).filter(([k]) => k !== 'institucional'));
  const mision = e.mision.trim();
  const vision = e.vision.trim();
  const mensajes = e.mensajes.map((m) => ({ de: m.de, texto: m.texto.trim() })).filter((m) => m.texto !== '');
  const inst = { ...(mision === '' ? {} : { mision }), ...(vision === '' ? {} : { vision }), ...(mensajes.length === 0 ? {} : { chat: { mensajes } }) };
  const valor = e.cifraValor.trim();
  const detalle = e.cifraDetalle.trim();
  const cifra = valor === '' && detalle === '' ? null : { valor: { texto: valor, confirmada: e.cifraConfirmada }, detalle };
  return {
    ...resto,
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

/**
 * Errores por campo (`mision`, `vision`, `cifraValor`, `cifraDetalle`, `mensaje.<i>`, `mensajes`). Vacío = se puede guardar.
 * Largos y cantidades los decide la regla del núcleo (`validarInstitucional`, `validarCifra`) sobre lo que se enviaría;
 * aquí solo se redactan los mensajes y se agregan las reglas propias del formulario (cifra y detalle van juntos).
 */
export function revisarTextos(e: EstadoTextos): Readonly<Record<string, string>> {
  const r: Record<string, string> = {};
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
  const valor = e.cifraValor.trim();
  const detalle = e.cifraDetalle.trim();
  if (valor === '' && detalle !== '') r['cifraValor'] = 'Escriba la cifra (por ejemplo, «Más de 500 clientes») o borre también el detalle.';
  if (valor !== '' && detalle === '') r['cifraDetalle'] = 'Escriba el detalle de la cifra (por ejemplo, «familias atendidas desde 2015»).';
  if (e.cifraConfirmada && valor === '') r['cifraValor'] = 'No se puede confirmar una cifra vacía.';
  return r;
}

export const iguales = (a: EstadoTextos, b: EstadoTextos): boolean => JSON.stringify(a) === JSON.stringify(b);
