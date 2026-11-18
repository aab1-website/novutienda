// Asigna el plan `pruebas` o `base` a un tenant (campo `plan` de `tenants/{t}`). Solo staging o emulador.
//
//   node scripts/plan-tenant.mjs <tenant> --proyecto <id> --plan pruebas|base            muestra lo que haría (no escribe)
//   node scripts/plan-tenant.mjs <tenant> --proyecto <id> --plan pruebas|base --aplicar   escribe y audita
//
// Entorno (scripts/guardia-operador.mjs `validarEntorno`): GOOGLE_CLOUD_PROJECT igual a --proyecto; NOVUTIENDA_AMBIENTE=staging con
// GCP_PROJECT_ID_STAGING, o emulador con proyecto demo-*. Rechaza producción. No imprime identificadores ni datos personales.
// La lógica vive en plataforma/operador/plan.ts (pura, con la base inyectable).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cargarManifiestos } from './generar-reglas.mjs';
import { validarEntorno } from './guardia-operador.mjs';

const falla = (mensaje) => {
  console.error(`plan-tenant: ${mensaje}`);
  process.exit(1);
};

const USO = 'uso: plan-tenant.mjs <tenant> --proyecto <id> --plan pruebas|base [--aplicar]';
const args = process.argv.slice(2);
let tenant;
let proyectoArg;
let plan;
let aplicar = false;
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === '--proyecto') {
    i += 1;
    proyectoArg = args[i];
  } else if (a === '--plan') {
    i += 1;
    plan = args[i];
  } else if (a === '--aplicar') aplicar = true;
  else if (a.startsWith('--') || tenant !== undefined) falla(USO);
  else tenant = a;
}
if (tenant === undefined || !['pruebas', 'base'].includes(plan ?? '')) falla(USO);
if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenant)) falla('el tenant no es un identificador válido');
let proyecto;
let ambiente;
try {
  ({ proyecto, ambiente } = validarEntorno({ proyectoArg, hostsEmulador: ['FIRESTORE_EMULATOR_HOST'] }));
} catch (e) {
  falla(e instanceof Error ? e.message : 'entorno inválido');
}

await cargarManifiestos(); // registra los ganchos de TypeScript
const { asignarPlan } = await import(pathToFileURL(resolve('plataforma/operador/plan.ts')).href);
const { getApps, initializeApp } = await import('firebase-admin/app');
const { FieldValue, getFirestore } = await import('firebase-admin/firestore');
if (getApps().length === 0) initializeApp({ projectId: proyecto });
const firestore = getFirestore();

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

// Operador de la auditoría: derivado de la cuenta de servicio de la credencial si existe; nunca de un argumento.
let cuentaOperador;
try {
  const ruta = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (ruta) cuentaOperador = JSON.parse(readFileSync(ruta, 'utf8')).client_email;
} catch {
  cuentaOperador = undefined;
}

try {
  const r = await asignarPlan({ tenantId: tenant, plan, ambiente, db, operador: typeof cuentaOperador === 'string' ? cuentaOperador : '', aplicar });
  if (r.diferencias.length === 0) console.log('plan-tenant: el tenant ya tiene ese plan.');
  else for (const d of r.diferencias) console.log(`  ${d}`);
  console.log(r.aplicado ? 'plan-tenant: aplicado.' : 'plan-tenant: sin escritura (use --aplicar para escribir).');
} catch (e) {
  falla(e instanceof Error ? e.message : 'error desconocido');
}
