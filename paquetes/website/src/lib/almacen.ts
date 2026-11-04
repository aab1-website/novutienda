/** Acceso tolerante al almacenamiento del navegador (puede estar bloqueado en ventanas privadas). */

export interface AlmacenClaveValor {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
  removeItem(clave: string): void;
}

export function leerSeguro(a: AlmacenClaveValor | null, clave: string): string | null {
  try {
    return a?.getItem(clave) ?? null;
  } catch {
    return null;
  }
}

export function guardarSeguro(a: AlmacenClaveValor | null, clave: string, valor: string): void {
  try {
    a?.setItem(clave, valor);
  } catch {
    /* almacenamiento lleno o bloqueado: la función sigue sin recordar */
  }
}

export function borrarSeguro(a: AlmacenClaveValor | null, clave: string): void {
  try {
    a?.removeItem(clave);
  } catch {
    /* ver guardarSeguro */
  }
}

/** Almacén en memoria para pruebas y como alternativa cuando no hay almacenamiento. */
export function almacenMemoria(): AlmacenClaveValor {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}
