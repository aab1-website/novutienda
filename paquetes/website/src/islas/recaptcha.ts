/** reCAPTCHA Enterprise: se descarga solo cuando la persona empieza a usar el formulario. */

interface Enterprise {
  ready(fn: () => void): void;
  execute(clave: string, opciones: { action: string }): Promise<string>;
}
declare global {
  interface Window {
    grecaptcha?: { enterprise?: Enterprise };
  }
}

const URL = 'https://www.google.com/recaptcha/enterprise.js';
let carga: Promise<void> | null = null;

export function cargarRecaptcha(clave: string): Promise<void> {
  carga ??= new Promise<void>((resolver, rechazar) => {
    const s = document.createElement('script');
    s.src = `${URL}?render=${encodeURIComponent(clave)}`;
    s.async = true;
    s.onload = () => resolver();
    s.onerror = () => {
      carga = null;
      rechazar(new Error('recaptcha'));
    };
    document.head.appendChild(s);
  });
  return carga;
}

export async function obtenerTokenRecaptcha(clave: string, accion: string): Promise<string> {
  await cargarRecaptcha(clave);
  const e = window.grecaptcha?.enterprise;
  if (e === undefined) throw new Error('recaptcha');
  await new Promise<void>((r) => e.ready(r));
  return e.execute(clave, { action: accion });
}

/** Proveedor opcional de token de App Check, que el cableado del despliegue puede registrar en la ventana. */
export type ProveedorAppCheck = () => Promise<string | null>;
export function proveedorAppCheck(): ProveedorAppCheck | null {
  const p = (window as unknown as Record<string, unknown>)['cbAppCheck'];
  return typeof p === 'function' ? (p as ProveedorAppCheck) : null;
}
