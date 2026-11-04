/** Límite de tasa: puerto y una implementación en memoria (ventana fija) para pruebas y desarrollo. */

export interface ResultadoLimite {
  readonly permitido: boolean;
  readonly reintentarEnSeg: number;
}

export interface LimiteTasa {
  intentar(clave: string, ahoraMs: number): Promise<ResultadoLimite>;
}

export function limiteMemoria(maximo: number, ventanaMs: number): LimiteTasa {
  const cubos = new Map<string, { inicio: number; usos: number }>();
  return {
    intentar(clave, ahora) {
      for (const [k, c] of cubos) if (ahora - c.inicio >= ventanaMs) cubos.delete(k);
      const c = cubos.get(clave) ?? { inicio: ahora, usos: 0 };
      c.usos += 1;
      cubos.set(clave, c);
      const permitido = c.usos <= maximo;
      return Promise.resolve({ permitido, reintentarEnSeg: permitido ? 0 : Math.max(1, Math.ceil((c.inicio + ventanaMs - ahora) / 1000)) });
    },
  };
}
