// Alta de tenant: `tenants/<t>/config.json` (v2) -> documento `tenants/{t}` en Firestore (L2-5).
//
//   node scripts/alta-tenant.mjs <tenant> [--verificar]   solo lectura: muestra el diff contra el documento actual
//   node scripts/alta-tenant.mjs <tenant> --aplicar       escribe el documento con Admin SDK
//
// El proyecto sale de GOOGLE_CLOUD_PROJECT (obligatorio; con FIRESTORE_EMULATOR_HOST apunta al emulador). No imprime
// identificadores de proyecto ni de tenant. La lógica vive en plataforma/operador/alta.ts (pura, con almacén inyectable).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cargarManifiestos } from './generar-reglas.mjs';

const falla = (mensaje) => {
  console.error(`alta-tenant: ${mensaje}`);
  process.exit(1);
};

const args = process.argv.slice(2);
const tenant = args.find((a) => !a.startsWith('--'));
const banderas = args.filter((a) => a.startsWith('--'));
const desconocidas = banderas.filter((b) => b !== '--aplicar' && b !== '--verificar');
if (tenant === undefined || desconocidas.length > 0 || banderas.length > 1) {
  falla('uso: alta-tenant.mjs <tenant> [--verificar | --aplicar]');
}
const aplicar = banderas[0] === '--aplicar';
if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenant)) falla('el tenant no es un identificador válido');
const proyecto = process.env.GOOGLE_CLOUD_PROJECT;
if (!proyecto) falla('defina GOOGLE_CLOUD_PROJECT');

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
const almacen = {
  leer: (id) =>
    sinIdentificadores(async () => {
      const s = await db.collection('tenants').doc(id).get();
      return s.exists ? s.data() : null;
    }),
  escribir: (id, doc) =>
    sinIdentificadores(async () => {
      await db.collection('tenants').doc(id).set(doc);
    }),
};

try {
  const r = await aplicarAlta({ tenantId: tenant, config, manifiestos, almacen, aplicar });
  if (r.diferencias.length === 0) console.log('alta-tenant: el documento ya coincide con config.json.');
  else for (const d of r.diferencias) console.log(`  ${d}`);
  console.log(r.aplicado ? 'alta-tenant: aplicado.' : 'alta-tenant: sin escritura (use --aplicar para escribir).');
} catch (e) {
  falla(e instanceof Error ? e.message : 'error desconocido');
}
