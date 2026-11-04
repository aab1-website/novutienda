/**
 * Lista blanca de enlaces: `https://`, `tel:`, `mailto:` y rutas internas (`/ruta`).
 * Nunca se admiten `javascript:`, `data:`, `http:`, `//host` ni credenciales en la URL.
 */
export type ResultadoEnlace = { readonly ok: true; readonly valor: string } | { readonly ok: false; readonly error: string };

const MAX_ENLACE = 2000;
const RUTA_INTERNA = /^\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)(?:\?[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?(?:#[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?$/;
/** https://host[:puerto][/ruta][?consulta][#ancla]; el host exige dominio con punto (sin IP ni credenciales). */
const HTTPS =
  /^https:\/\/((?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}(?::\d{1,5})?)(\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?(\?[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?(?:#[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?$/;
const TEL = /^tel:\+?[0-9]{6,15}$/;
const MAILTO = /^mailto:[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}(?:\?(?:subject|body)=[A-Za-z0-9._~%+-]{0,200})?$/;

function sinBlancosNiControl(t: string): boolean {
  for (const c of t) {
    const p = c.codePointAt(0) ?? 0;
    if (p <= 32 || p === 127 || p === 0x5c) return false; // espacio, control y barra invertida
  }
  return true;
}

export function validarEnlace(url: unknown): ResultadoEnlace {
  if (typeof url !== 'string' || url === '') return { ok: false, error: 'el enlace es obligatorio' };
  if (url.length > MAX_ENLACE) return { ok: false, error: 'el enlace es demasiado largo' };
  if (!sinBlancosNiControl(url)) return { ok: false, error: 'el enlace no admite espacios, caracteres de control ni barras invertidas' };

  if (url.startsWith('/')) {
    if (url.startsWith('//')) return { ok: false, error: 'el enlace no puede empezar con //' };
    if (!RUTA_INTERNA.test(url)) return { ok: false, error: 'ruta interna con caracteres no permitidos' };
    const camino = url.split(/[?#]/, 1)[0] ?? '';
    if (camino.split('/').some((s) => s === '..' || s === '.')) return { ok: false, error: 'la ruta no admite segmentos . ni ..' };
    return { ok: true, valor: url };
  }
  if (url.startsWith('https://')) {
    const m = HTTPS.exec(url);
    if (m === null) return { ok: false, error: 'URL https mal formada (sin credenciales ni caracteres no permitidos)' };
    const [, host = '', ruta = '', consulta = ''] = m;
    if ((host.toLowerCase().split(':')[0] ?? '') === 'wa.me' && (!/^\/\d{8,15}$/.test(ruta) || !/^(?:\?[A-Za-z0-9._~%+=&-]{0,500})?$/.test(consulta))) {
      return { ok: false, error: 'enlace de wa.me inválido (se espera /número)' };
    }
    return { ok: true, valor: url };
  }
  if (TEL.test(url) || MAILTO.test(url)) return { ok: true, valor: url };
  return { ok: false, error: 'enlace fuera de la lista blanca (https, tel, mailto o ruta interna)' };
}
