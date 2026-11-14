// Verifica, SOLO LECTURA, que el redondeo de un tenant cumple la decisión D7 (0 a 2 decimales, o múltiplo de al menos 0,01 y
// exacto en centavos; ni «ninguno» ni más de 2 decimales).
//
//   node scripts/verificar-comercial.mjs <tenant> --proyecto <id>
//
// Entorno: GOOGLE_CLOUD_PROJECT igual a --proyecto y NOVUTIENDA_AMBIENTE=staging con GCP_PROJECT_ID_STAGING (o emulador con
// FIRESTORE_EMULATOR_HOST y proyecto demo-*); se niega fuera de ahí (scripts/guardia-operador.mjs). Credenciales por ADC.
// Imprime la forma del tenant, el plan y UNA línea por moneda; nunca el contenido de los documentos. Salida: 0 todo cumple,
// 1 alguna moneda no cumple, 2 no pudo leer o el entorno no es válido. La lógica vive en plataforma/operador/verificar-comercial.ts.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cargarManifiestos } from './generar-reglas.mjs';
import { validarEntorno } from './guardia-operador.mjs';

const falla = (mensaje) => {
  console.error(`verificar-comercial: ${mensaje}`);
  process.exit(2);
};

const USO = 'uso: verificar-comercial.mjs <tenant> --proyecto <id>';
const args = process.argv.slice(2);
let tenant;
let proyectoArg;
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === '--proyecto') {
    i += 1;
    proyectoArg = args[i];
  } else if (a.startsWith('--') || tenant !== undefined) falla(USO);
  else tenant = a;
}
if (tenant === undefined) falla(USO);
if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenant)) falla('el tenant no es un identificador válido');
let proyecto;
try {
  ({ proyecto } = validarEntorno({ proyectoArg, hostsEmulador: ['FIRESTORE_EMULATOR_HOST'] }));
} catch (e) {
  falla(e instanceof Error ? e.message : 'entorno inválido');
}

await cargarManifiestos(); // registra los ganchos de TypeScript
const { verificarComercial, lineasDelInforme } = await import(pathToFileURL(resolve('plataforma/operador/verificar-comercial.ts')).href);
const { getApps, initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
if (getApps().length === 0) initializeApp({ projectId: proyecto });
const firestore = getFirestore();

let tenantDoc;
let redondeoDoc;
try {
  const [t, r] = await Promise.all([firestore.doc(`tenants/${tenant}`).get(), firestore.doc(`tenants/${tenant}/config/redondeo`).get()]);
  tenantDoc = t.exists ? t.data() : undefined;
  redondeoDoc = r.exists ? r.data() : undefined;
} catch (e) {
  // Los errores de Firebase suelen traer el id del proyecto: solo se muestra su código.
  falla(`error de Firebase (${e && typeof e === 'object' && 'code' in e ? String(e.code) : 'desconocido'})`);
}

const r = verificarComercial(tenantDoc, redondeoDoc);
if (!r.ok) falla(r.error);
for (const linea of lineasDelInforme(r.informe)) console.log(linea);
process.exit(r.informe.cumple ? 0 : 1);
