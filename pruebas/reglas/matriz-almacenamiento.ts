// Constructor PURO de casos de la matriz de Storage: sin Firebase ni emulador.
// Lo ejecuta contra reglas reales pruebas/funciones/storage-reglas.test.ts.
import type { RutaAlmacenamiento } from '@novutienda/nucleo';
import { HOSTILES, personal, ROLES, type Sujeto } from './matriz.js';

export const OPERACIONES_ALMACENAMIENTO = ['get', 'list', 'create', 'update', 'delete'] as const;
export type OperacionAlmacenamiento = (typeof OPERACIONES_ALMACENAMIENTO)[number];

/** Valores de prueba que sustituyen las variables de la ruta. */
export const VALORES_RUTA = { tenant: 'A', productoId: 'p1', subidaId: 's1', resto: 'x/y.jpg' } as const;

export interface PersonaAlmacenamiento {
  readonly nombre: string;
  readonly sujeto: Sujeto;
}

export interface CasoAlmacenamiento {
  readonly descripcion: string;
  /** Ruta concreta bajo `tenants/{tenant}/`, sin variables. */
  readonly ruta: string;
  readonly tenant: string;
  readonly persona: PersonaAlmacenamiento;
  readonly operacion: OperacionAlmacenamiento;
  readonly esperado: boolean;
}

/** Sustituye `{productoId}`, `{subidaId}`, `{x=**}` y cualquier otra `{variable}`. */
export function rutaConcreta(ruta: string): string {
  return ruta
    .split('/')
    .map((s) => {
      if (/^\{[^}=]+=\*\*\}$/.test(s)) return VALORES_RUTA.resto;
      if (s === '{productoId}') return VALORES_RUTA.productoId;
      if (s === '{subidaId}') return VALORES_RUTA.subidaId;
      if (/^\{[^}]+\}$/.test(s)) return `${s.slice(1, -1)}1`;
      return s;
    })
    .join('/');
}

const personas: readonly PersonaAlmacenamiento[] = [
  ...ROLES.map((r) => ({ nombre: `${r}@A`, sujeto: personal(r, VALORES_RUTA.tenant) })),
  ...HOSTILES.map((s) => ({ nombre: s.nombre, sujeto: s })),
];

/** Casos de las rutas de almacenamiento de los manifiestos dados. */
export function construirCasosAlmacenamiento(
  manifiestos: readonly { readonly almacenamiento?: readonly RutaAlmacenamiento[] | undefined }[],
): CasoAlmacenamiento[] {
  const casos: CasoAlmacenamiento[] = [];
  for (const a of manifiestos.flatMap((m) => m.almacenamiento ?? [])) {
    const ruta = rutaConcreta(a.ruta);
    for (const persona of personas) {
      for (const operacion of OPERACIONES_ALMACENAMIENTO) {
        if (operacion === 'create' && a.escritura !== 'servidor') {
          // La subida válida (rol permitido con reserva real) la cubre el emulador.
          const rolesOk: readonly string[] = a.escritura.roles;
          const esRolOk = ROLES.some((r) => persona.nombre === `${r}@A` && rolesOk.includes(r));
          if (esRolOk) continue;
        }
        const lee = operacion === 'get' || operacion === 'list';
        casos.push({
          descripcion: `${persona.nombre} ${operacion} ${a.ruta}`,
          ruta,
          tenant: VALORES_RUTA.tenant,
          persona,
          operacion,
          esperado: lee && a.lectura === 'publica',
        });
      }
    }
  }
  return casos;
}
