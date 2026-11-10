// Ciclo de vida de un tenant: suspender, reactivar o dar de baja (estado en `tenants/{t}`).
//
//   node scripts/estado-tenant.mjs <tenant> --proyecto <id> --a suspendido|activo|baja [--verificar]   solo lectura
//   node scripts/estado-tenant.mjs <tenant> --proyecto <id> --a suspendido|activo|baja --aplicar [--confirmar-baja <tenant>] [--confirmar-produccion]
//
// Al pasar a suspendido o baja revoca los refresh tokens de los miembros y audita. `baja` es terminal y exige repetir el id del
// tenant en --confirmar-baja. Entorno como alta-tenant: GOOGLE_CLOUD_PROJECT igual a --proyecto; NOVUTIENDA_AMBIENTE=staging|emulador, o
// produccion solo con GCP_PROJECT_ID_PROD y --confirmar-produccion (scripts/guardia-operador.mjs). No imprime identificadores.
// La lógica vive en plataforma/operador/estado.ts (pura, con base, miembros y Auth inyectables).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cargarManifiestos } from './generar-reglas.mjs';
import { validarEntornoAlta } from './guardia-operador.mjs';

const falla = (mensaje) => {
  console.error(`estado-tenant: ${mensaje}`);
  process.exit(1);
};

const USO = 'uso: estado-tenant.mjs <tenant> --proyecto <id> --a suspendido|activo|baja [--verificar | --aplicar] [--confirmar-baja <tenant>] [--confirmar-produccion]';
const args = process.argv.slice(2);
let tenant;
let proyectoArg;
let destino;
let confirmacion;
let confirmarProduccion = false;
const banderas = [];
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === '--proyecto') {
    i += 1;
    proyectoArg = args[i];
  } else if (a === '--a') {
    i += 1;
    destino = args[i];
  } else if (a === '--confirmar-baja') {
    i += 1;
    confirmacion = args[i];
  } else if (a === '--confirmar-produccion') confirmarProduccion = true;
  else if (a === '--aplicar' || a === '--verificar') banderas.push(a);
  else if (a.startsWith('--') || tenant !== undefined) falla(USO);
  else tenant = a;
}
if (tenant === undefined || banderas.length > 1 || !['suspendido', 'activo', 'baja'].includes(destino ?? '')) falla(USO);
if (confirmacion !== undefined && confirmacion.startsWith('--')) falla(USO);
const aplicar = banderas[0] === '--aplicar';
if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenant)) falla('el tenant no es un identificador válido');
let proyecto;
try {
  ({ proyecto } = validarEntornoAlta({ proyectoArg, confirmarProduccion, hostsEmulador: ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'] }));
} catch (e) {
  falla(e instanceof Error ? e.message : 'entorno inválido');
}

await cargarManifiestos(); // registra los ganchos de TypeScript
const { cambiarEstado } = await import(pathToFileURL(resolve('plataforma/operador/estado.ts')).href);
const { getApps, initializeApp } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
const { FieldValue, getFirestore } = await import('firebase-admin/firestore');
if (getApps().length === 0) initializeApp({ projectId: proyecto });
const firestore = getFirestore();
const authAdmin = getAuth();

// Los errores de Firebase suelen traer el id del proyecto: solo se muestra su código.
const sinIdentificadores = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    throw new Error(`error de Firebase (${e && typeof e === 'object' && 'code' in e ? String(e.code) : 'desconocido'})`, { cause: e });
  }
};
const db = {
  runTransaction: (fn) =>
    sinIdentificadores(() =>
      firestore.runTransaction((tx) =>
        fn({
          get: async (ruta) => {
            const s = await tx.get(firestore.doc(ruta));
            return { existe: s.exists, data: () => s.data() };
          },
          update: (ruta, datos) => void tx.update(firestore.doc(ruta), datos),
          create: (ruta, datos) => void tx.create(firestore.doc(ruta), datos),
          nuevoId: (coleccion) => firestore.collection(coleccion).doc().id,
          marcaTiempoServidor: () => FieldValue.serverTimestamp(),
        }),
      ),
    ),
};
const miembros = { listarMiembros: (id) => sinIdentificadores(async () => (await firestore.collection(`tenants/${id}/miembros`).listDocuments()).map((d) => d.id)) };
const auth = { revokeRefreshTokens: (uid) => authAdmin.revokeRefreshTokens(uid) };

// Operador de la auditoría: fijo, derivado de la cuenta de servicio de la credencial si existe; nunca de un argumento.
let cuentaOperador;
try {
  const ruta = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (ruta) cuentaOperador = JSON.parse(readFileSync(ruta, 'utf8')).client_email;
} catch {
  cuentaOperador = undefined;
}

try {
  const r = await cambiarEstado({
    tenantId: tenant,
    a: destino,
    db,
    miembros,
    auth,
    operador: typeof cuentaOperador === 'string' ? cuentaOperador : '',
    aplicar,
    ...(confirmacion !== undefined ? { confirmacion } : {}),
  });
  if (r.diferencias.length === 0) console.log(r.aplicado ? 'estado-tenant: ya estaba en ese estado; se repite la revocación.' : 'estado-tenant: el tenant ya está en ese estado.');
  else for (const d of r.diferencias) console.log(`  ${d}`);
  if (r.aplicado) console.log(`estado-tenant: aplicado; sesiones revocadas ${r.revocados}.`);
  else console.log('estado-tenant: sin escritura (use --aplicar para escribir).');
} catch (e) {
  falla(e instanceof Error ? e.message : 'error desconocido');
}
