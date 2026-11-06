// Matriz de pruebas de reglas generada desde el registro de módulos:
// colección × rol × operación, más negativas fijas. No es una prueba por sí
// misma: la usan reglas.test.ts (contra las reglas reales y contra mutantes).
import { deleteDoc, doc, getDoc, getDocs, collection, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { ManifiestoReglas } from '../../scripts/generar-reglas.mjs';

export const ROLES = ['caj', 'sup', 'adm'] as const;
export type RolPrueba = (typeof ROLES)[number];
export const OPERACIONES = ['get', 'list', 'create', 'update', 'delete'] as const;
export type Operacion = (typeof OPERACIONES)[number];

export const TENANT_A = 'tenant-a';
export const TENANT_B = 'tenant-b';
const ID_NUEVO = 'nuevo';

export interface Sujeto {
  readonly nombre: string;
  /** Token de Auth; `null` = sin autenticar. */
  readonly token: Record<string, unknown> | null;
}

export interface Caso {
  readonly descripcion: string;
  readonly sujeto: Sujeto;
  readonly tenant: string;
  readonly ruta: string;
  readonly operacion: Operacion;
  /** `raiz`: la ruta no cuelga de `tenants/{t}`. Por defecto `tenant`. */
  readonly ambito?: 'tenant' | 'raiz';
  readonly esperado: boolean;
}

const claim = (t: Record<string, string>, extra: Record<string, unknown> = {}) => ({ pl: { t, v: 1, ...extra } });
// Por defecto el correo está verificado; las negativas lo sobrescriben.
const conProveedor = (proveedor: string, resto: Record<string, unknown> = {}) => ({
  firebase: { sign_in_provider: proveedor },
  email_verified: true,
  ...resto,
});

export const personal = (rol: string, tenant = TENANT_A): Sujeto => ({
  nombre: `${rol}@${tenant}`,
  token: conProveedor('password', claim({ [tenant]: rol })),
});

/** Los 13 sujetos hostiles: ninguno abre ninguna operación. */
export const HOSTILES: readonly Sujeto[] = [
  { nombre: 'sin autenticar', token: null },
  { nombre: 'anónimo con claim válido', token: conProveedor('anonymous', claim({ [TENANT_A]: 'adm' })) },
  { nombre: 'autenticado sin claims', token: conProveedor('password') },
  { nombre: 'claim sin tenants', token: conProveedor('password', claim({})) },
  { nombre: 'proveedor google.com', token: conProveedor('google.com', claim({ [TENANT_A]: 'adm' })) },
  { nombre: 'proveedor custom', token: conProveedor('custom', claim({ [TENANT_A]: 'adm' })) },
  { nombre: 'correo no verificado', token: conProveedor('password', { ...claim({ [TENANT_A]: 'adm' }), email_verified: false }) },
  { nombre: 'sin dato de verificación de correo', token: { firebase: { sign_in_provider: 'password' }, ...claim({ [TENANT_A]: 'adm' }) } },
  { nombre: 'correo verificado como texto', token: conProveedor('password', { ...claim({ [TENANT_A]: 'adm' }), email_verified: 'true' }) },
  { nombre: 'sin proveedor', token: claim({ [TENANT_A]: 'adm' }) },
  { nombre: 'acceso de plataforma sin rol', token: conProveedor('password', claim({}, { p: true })) },
  { nombre: 'rol de otro tenant', token: conProveedor('password', claim({ [TENANT_B]: 'adm' })) },
  { nombre: 'rol con valor inválido', token: conProveedor('password', claim({ [TENANT_A]: 'root' })) },
];

type Coleccion = ManifiestoReglas['colecciones'][number];

function permitido(c: Coleccion, rol: string, operacion: Operacion): boolean {
  if (operacion === 'get' || operacion === 'list') return c.lectura.includes(rol);
  return c.escritura !== 'servidor' && c.escritura.includes(rol);
}

/** Todos los casos: matriz positiva y negativa por colección más negativas fijas. */
export function construirCasos(manifiestos: readonly ManifiestoReglas[]): Caso[] {
  const casos: Caso[] = [];
  const colecciones = manifiestos.flatMap((m) => m.colecciones);

  for (const c of colecciones) {
    // Raíz: fuera de tenants/{t}; solo el servidor la toca, así que todo se niega.
    const raiz = c.ambito === 'raiz';
    const ambito: Pick<Caso, 'ambito'> = raiz ? { ambito: 'raiz' } : {};
    for (const rol of ROLES) {
      for (const op of OPERACIONES) {
        casos.push({
          descripcion: `${rol} ${op} ${c.ruta}`,
          sujeto: personal(rol),
          tenant: TENANT_A,
          ruta: c.ruta,
          operacion: op,
          ...ambito,
          esperado: !raiz && permitido(c, rol, op),
        });
      }
    }

    // Negativas fijas: nada de esto abre ninguna operación.
    for (const s of HOSTILES) {
      for (const op of OPERACIONES) {
        casos.push({ descripcion: `${s.nombre} ${op} ${c.ruta}`, sujeto: s, tenant: TENANT_A, ruta: c.ruta, operacion: op, ...ambito, esperado: false });
      }
    }

    // Rol de un tenant usado en otro: dir en A y caj en B vale solo caj en B.
    const mixto: Sujeto = {
      nombre: 'dir en A y caj en B',
      token: conProveedor('password', claim({ [TENANT_A]: 'adm', [TENANT_B]: 'caj' })),
    };
    for (const op of raiz ? [] : OPERACIONES) {
      casos.push({ descripcion: `${mixto.nombre} ${op} ${c.ruta} en B`, sujeto: mixto, tenant: TENANT_B, ruta: c.ruta, operacion: op, esperado: permitido(c, 'caj', op) });
    }
  }

  // Rutas no declaradas y raíz del tenant: negación final.
  for (const rol of ROLES) {
    for (const ruta of ['no-declarada', 'auditoria-falsa']) {
      for (const op of OPERACIONES) {
        casos.push({ descripcion: `${rol} ${op} ${ruta} (no declarada)`, sujeto: personal(rol), tenant: TENANT_A, ruta, operacion: op, esperado: false });
      }
    }
  }
  return casos;
}

/** Ruta de la colección del caso: `ruta` si es de raíz; si no, bajo `tenants/{t}`. */
function rutaColeccion(caso: Caso): string {
  return caso.ambito === 'raiz' ? caso.ruta : `tenants/${caso.tenant}/${caso.ruta}`;
}

function referencia(db: Firestore, caso: Caso, id: string) {
  return doc(db, `${rutaColeccion(caso)}/${id}`);
}

async function ejecutar(db: Firestore, caso: Caso): Promise<boolean> {
  try {
    switch (caso.operacion) {
      case 'get':
        await getDoc(referencia(db, caso, 'd1'));
        break;
      case 'list':
        await getDocs(collection(db, rutaColeccion(caso)));
        break;
      case 'create':
        await setDoc(referencia(db, caso, ID_NUEVO), { x: 1 });
        break;
      case 'update':
        await updateDoc(referencia(db, caso, 'd1'), { x: 2 });
        break;
      case 'delete':
        await deleteDoc(referencia(db, caso, 'd1'));
        break;
    }
    return true;
  } catch (error) {
    // Solo una denegación de las reglas cuenta como «denegado». Cualquier otro
    // error (emulador caído, red, reglas que no compilan) debe hacer fallar la
    // prueba, no dejar verde una negativa.
    if ((error as { code?: unknown }).code === 'permission-denied') return false;
    throw error;
  }
}

/** Siembra un documento por colección en ambos tenants (o uno solo si es de raíz), sin pasar por las reglas. */
async function sembrar(env: RulesTestEnvironment, casos: readonly Caso[]): Promise<void> {
  const deTenant = [...new Set(casos.filter((c) => c.ambito !== 'raiz').map((c) => c.ruta))];
  const deRaiz = [...new Set(casos.filter((c) => c.ambito === 'raiz').map((c) => c.ruta))];
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const tenant of [TENANT_A, TENANT_B]) {
      for (const ruta of deTenant) await setDoc(doc(db, `tenants/${tenant}/${ruta}/d1`), { x: 0 });
    }
    // Las raíces no cuelgan de ningún tenant: se siembran una sola vez.
    for (const ruta of deRaiz) await setDoc(doc(db, `${ruta}/d1`), { x: 0 });
  });
}

/** Elimina el documento creado por un `create` permitido, sin pasar por las reglas. */
async function quitarNuevo(env: RulesTestEnvironment, caso: Caso): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await deleteDoc(doc(ctx.firestore(), `${rutaColeccion(caso)}/${ID_NUEVO}`));
  });
}

/**
 * Ejecuta los casos y devuelve los que no coinciden con lo esperado. Con
 * `detenerEnPrimero` corta en el primer desajuste (útil para mutantes).
 */
export async function ejecutarMatriz(
  env: RulesTestEnvironment,
  casos: readonly Caso[],
  detenerEnPrimero = false,
): Promise<string[]> {
  const fallos: string[] = [];
  await sembrar(env, casos);
  for (const caso of casos) {
    const ctx = caso.sujeto.token === null ? env.unauthenticatedContext() : env.authenticatedContext('u1', caso.sujeto.token);
    const resultado = await ejecutar(ctx.firestore() as unknown as Firestore, caso);
    if (resultado !== caso.esperado) {
      fallos.push(`${caso.descripcion}: esperado ${caso.esperado ? 'permitido' : 'denegado'}, fue ${resultado ? 'permitido' : 'denegado'}`);
      if (detenerEnPrimero) break;
    }
    // Un borrado permitido consume el documento sembrado: se repone.
    if (caso.operacion === 'delete' && resultado) await sembrar(env, [caso]);
    // Un create permitido deja el documento: sin quitarlo, el siguiente create
    // sobre el mismo id sería en realidad un update y se evaluaría otra regla.
    if (caso.operacion === 'create' && resultado) await quitarNuevo(env, caso);
  }
  return fallos;
}
