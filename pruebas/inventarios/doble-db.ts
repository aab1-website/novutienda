import type { BaseDatosIdentidad, TransaccionIdentidad } from '@plataforma/nucleo';

type Datos = Readonly<Record<string, unknown>>;

function sinUndefined(valor: unknown, ruta: string): void {
  if (valor === undefined) throw new Error(`Firestore no admite undefined: ${ruta}`);
  if (Array.isArray(valor)) valor.forEach((v, i) => sinUndefined(v, `${ruta}[${i}]`));
  else if (typeof valor === 'object' && valor !== null) {
    for (const [k, v] of Object.entries(valor)) sinUndefined(v, `${ruta}.${k}`);
  }
}

/**
 * Doble de base de datos con transacciones serializables (control optimista), como el del núcleo,
 * más las reglas de Firestore que importan aquí: `create` falla si el documento existe, las
 * lecturas posteriores a una escritura se rechazan y no se admiten valores `undefined`.
 */
export class DobleDb implements BaseDatosIdentidad {
  readonly docs = new Map<string, { datos: Datos | undefined; version: number }>();
  reintentos = 0;
  private secuencia = 0;

  poner(ruta: string, datos: Datos | undefined): void {
    this.docs.set(ruta, { datos, version: (this.docs.get(ruta)?.version ?? 0) + 1 });
  }

  dato(ruta: string): Datos | undefined {
    return this.docs.get(ruta)?.datos;
  }

  coleccion(prefijo: string): { ruta: string; datos: Datos }[] {
    return [...this.docs]
      .filter(([r, d]) => r.startsWith(`${prefijo}/`) && d.datos !== undefined)
      .map(([ruta, d]) => ({ ruta, datos: d.datos as Datos }));
  }

  async runTransaction<T>(fn: (tx: TransaccionIdentidad) => Promise<T>): Promise<T> {
    for (;;) {
      const lecturas = new Map<string, number>();
      const escrituras = new Map<string, { datos: Datos | undefined; crear: boolean }>();
      const escribir = (ruta: string, datos: Datos | undefined, crear: boolean): void => {
        if (datos !== undefined) sinUndefined(datos, ruta);
        escrituras.set(ruta, { datos, crear });
      };
      const tx: TransaccionIdentidad = {
        get: async (ruta) => {
          if (escrituras.size > 0) throw new Error(`Lectura después de escribir: ${ruta}`);
          await Promise.resolve();
          const d = this.docs.get(ruta);
          lecturas.set(ruta, d?.version ?? 0);
          return { existe: d?.datos !== undefined, data: () => d?.datos };
        },
        set: (ruta, datos) => escribir(ruta, datos, false),
        delete: (ruta) => escribir(ruta, undefined, false),
        create: (ruta, datos) => {
          if (escrituras.has(ruta)) throw new Error(`create sobre un documento ya escrito en la transacción: ${ruta}`);
          escribir(ruta, datos, true);
        },
        nuevoId: () => `aud${String((this.secuencia += 1))}`,
        marcaTiempoServidor: () => 'MARCA',
      };
      const resultado = await fn(tx);
      const conflicto = [...lecturas].some(([r, v]) => (this.docs.get(r)?.version ?? 0) !== v);
      if (conflicto) {
        this.reintentos += 1;
        continue;
      }
      for (const [r, e] of escrituras) {
        if (e.crear && this.docs.get(r)?.datos !== undefined) throw new Error(`ALREADY_EXISTS: ${r}`);
      }
      for (const [r, e] of escrituras) this.poner(r, e.datos);
      return resultado;
    }
  }
}
