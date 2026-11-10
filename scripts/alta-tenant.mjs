// Alta de tenant: `tenants/<t>/config.json` (v2) -> documento `tenants/{t}` en Firestore (L2-5).
//
//   node scripts/alta-tenant.mjs <tenant> --proyecto <id> [--verificar]   solo lectura: muestra el diff contra el documento actual
//   node scripts/alta-tenant.mjs <tenant> --proyecto <id> --aplicar       escribe el documento con Admin SDK
//
// El proyecto sale de GOOGLE_CLOUD_PROJECT (obligatorio; con FIRESTORE_EMULATOR_HOST apunta al emulador) y debe repetirse en
// --proyecto. NOVUTIENDA_AMBIENTE=staging|emulador como en los demás scripts del operador; producción solo con
// NOVUTIENDA_AMBIENTE=produccion, GCP_PROJECT_ID_PROD igual al proyecto y --confirmar-produccion (scripts/guardia-operador.mjs). No imprime
// identificadores de proyecto ni de tenant. La lógica vive en plataforma/operador/alta.ts (pura, con almacén inyectable).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cargarManifiestos } from './generar-reglas.mjs';
import { validarEntornoAlta } from './guardia-operador.mjs';

const falla = (mensaje) => {
  console.error(`alta-tenant: ${mensaje}`);
  process.exit(1);
};

const USO = 'uso: alta-tenant.mjs <tenant> --proyecto <id> [--verificar | --aplicar] [--confirmar-produccion]';
const args = process.argv.slice(2);
let tenant;
let proyectoArg;
let confirmarProduccion = false;
const banderas = [];
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === '--proyecto') {
    i += 1;
    proyectoArg = args[i];
  } else if (a === '--confirmar-produccion') confirmarProduccion = true;
  else if (a === '--aplicar' || a === '--verificar') banderas.push(a);
  else if (a.startsWith('--') || tenant !== undefined) falla(USO);
  else tenant = a;
}
if (tenant === undefined || banderas.length > 1) falla(USO);
const aplicar = banderas[0] === '--aplicar';
if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenant)) falla('el tenant no es un identificador válido');
let proyecto;
try {
  // Entorno: --proyecto igual a GOOGLE_CLOUD_PROJECT; staging|emulador, o producción solo de forma explícita.
  ({ proyecto } = validarEntornoAlta({ proyectoArg, confirmarProduccion, hostsEmulador: ['FIRESTORE_EMULATOR_HOST'] }));
} catch (e) {
  falla(e instanceof Error ? e.message : 'entorno inválido');
}

let config;
try {
  config = JSON.parse(readFileSync(resolve('tenants', tenant, 'config.json'), 'utf8'));
} catch {
  falla('no se pudo leer tenants/<tenant>/config.json');
}

const manifiestos = await cargarManifiestos();
// Los ganchos de TypeScript ya están registrados por cargarManifiestos.
const { aplicarAlta } = await import(pathToFileURL(resolve('plataforma/operador/alta.ts')).href);
const { getApps, initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
if (getApps().length === 0) initializeApp({ projectId: proyecto });
const db = getFirestore();
// Los errores de Firestore suelen traer el id del proyecto: solo se muestra su código.
const sinIdentificadores = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    throw new Error(`error de Firestore (${e && typeof e === 'object' && 'code' in e ? String(e.code) : 'desconocido'})`, { cause: e });
  }
};
// Serialización con claves ordenadas, para comparar documentos sin depender del orden.
const canonico = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const almacen = {
  leer: (id) =>
    sinIdentificadores(async () => {
      const s = await db.collection('tenants').doc(id).get();
      return s.exists ? s.data() : null;
    }),
  // Transacción: si el documento cambió desde la lectura (p. ej. una suspensión concurrente), aborta en vez de pisarlo.
  escribir: (id, doc, previo) =>
    sinIdentificadores(() =>
      db.runTransaction(async (tx) => {
        const ref = db.collection('tenants').doc(id);
        const s = await tx.get(ref);
        const actual = s.exists ? s.data() : null;
        if (canonico(actual) !== canonico(previo)) {
          throw new Error('el documento cambió durante el alta: reintente');
        }
        tx.set(ref, doc);
      }),
    ),
  // listCollections falla cerrado: si Firestore no responde, el alta se aborta (no se asume «sin datos previos»).
  tieneSubcolecciones: (id) => sinIdentificadores(async () => (await db.collection('tenants').doc(id).listCollections()).length > 0),
};

try {
  const r = await aplicarAlta({ tenantId: tenant, config, manifiestos, almacen, aplicar });
  if (r.diferencias.length === 0) console.log('alta-tenant: el documento ya coincide con config.json.');
  else for (const d of r.diferencias) console.log(`  ${d}`);
  console.log(r.aplicado ? 'alta-tenant: aplicado.' : 'alta-tenant: sin escritura (use --aplicar para escribir).');
} catch (e) {
  falla(e instanceof Error ? e.message : 'error desconocido');
}
