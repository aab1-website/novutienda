// Mapeo host -> tenant (colección `dominios/{host}`): asignar, reasignar o quitar el dominio de un tenant.
//
//   node scripts/dominio-tenant.mjs --host <host> --tenant <tenant> --proyecto <id> [--verificar]   solo lectura (valor por defecto)
//   node scripts/dominio-tenant.mjs --host <host> --tenant <tenant> --proyecto <id> --aplicar [--reasignar] [--confirmar-produccion]
//   node scripts/dominio-tenant.mjs --host <host> [--tenant <tenant>] --proyecto <id> --eliminar --aplicar [--confirmar-produccion]
//
// Un host pertenece a un solo tenant; moverlo a otro exige --reasignar. El tenant debe existir y estar activo o suspendido.
// Entorno como alta-tenant: GOOGLE_CLOUD_PROJECT igual a --proyecto; NOVUTIENDA_AMBIENTE=staging|emulador, o produccion solo con
// GCP_PROJECT_ID_PROD y --confirmar-produccion (scripts/guardia-operador.mjs). No imprime identificadores.
// Compuerta: mientras el secreto de firma de pedidos sea compartido, se rechaza mapear un host a un tenant con `inventarios`
// si otro tenant con `inventarios` ya tiene host mapeado (también con --verificar). Sin escape.
// La lógica vive en plataforma/operador/dominio.ts (pura, con la base inyectable).
import { readFileSync } from 'node:fs';
import { cargarManifiestos } from './generar-reglas.mjs';
import { validarEntornoAlta } from './guardia-operador.mjs';

const falla = (mensaje) => {
  console.error(`dominio-tenant: ${mensaje}`);
  process.exit(1);
};

const USO = 'uso: dominio-tenant.mjs --host <host> [--tenant <tenant>] --proyecto <id> [--verificar | --aplicar] [--reasignar | --eliminar] [--confirmar-produccion]';
const args = process.argv.slice(2);
let host;
let tenant;
let proyectoArg;
let confirmarProduccion = false;
let reasignar = false;
let eliminar = false;
const banderas = [];
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === '--host') {
    i += 1;
    host = args[i];
  } else if (a === '--tenant') {
    i += 1;
    tenant = args[i];
  } else if (a === '--proyecto') {
    i += 1;
    proyectoArg = args[i];
  } else if (a === '--confirmar-produccion') confirmarProduccion = true;
  else if (a === '--reasignar') reasignar = true;
  else if (a === '--eliminar') eliminar = true;
  else if (a === '--aplicar' || a === '--verificar') banderas.push(a);
  else falla(USO);
}
if (host === undefined || host.startsWith('--') || (tenant !== undefined && tenant.startsWith('--'))) falla(USO);
if (banderas.length > 1 || (reasignar && eliminar)) falla(USO);
if (!eliminar && tenant === undefined) falla(USO);
const aplicar = banderas[0] === '--aplicar';
let proyecto;
try {
  ({ proyecto } = validarEntornoAlta({ proyectoArg, confirmarProduccion, hostsEmulador: ['FIRESTORE_EMULATOR_HOST'] }));
} catch (e) {
  falla(e instanceof Error ? e.message : 'entorno inválido');
}

await cargarManifiestos(); // registra los ganchos de TypeScript
const { gestionarDominio, RechazoDominio } = await import(new URL('../plataforma/operador/dominio.ts', import.meta.url).href);
const { getApps, initializeApp } = await import('firebase-admin/app');
const { FieldValue, getFirestore } = await import('firebase-admin/firestore');
if (getApps().length === 0) initializeApp({ projectId: proyecto });
const firestore = getFirestore();

// Los errores de Firebase suelen traer el id del proyecto: solo se muestra su código. Solo los `RechazoDominio` (mensaje sin identificadores) pasan intactos.
class ErrorSeguro extends Error {}
const sinIdentificadores = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof RechazoDominio) throw e;
    throw new ErrorSeguro(`error de Firebase (${e && typeof e === 'object' && 'code' in e ? String(e.code) : 'inesperado'})`);
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
          listar: async (coleccion) => (await tx.get(firestore.collection(coleccion))).docs.map((d) => ({ ruta: d.ref.path, data: () => d.data() })),
          delete: (ruta) => void tx.delete(firestore.doc(ruta)),
          nuevoId: (coleccion) => firestore.collection(coleccion).doc().id,
          marcaTiempoServidor: () => FieldValue.serverTimestamp(),
        }),
      ),
    ),
};

// Operador de la auditoría: fijo, derivado de la cuenta de servicio de la credencial si existe; nunca de un argumento.
let cuentaOperador;
try {
  const ruta = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (ruta) cuentaOperador = JSON.parse(readFileSync(ruta, 'utf8')).client_email;
} catch {
  cuentaOperador = undefined;
}

try {
  const r = await gestionarDominio({
    host,
    ...(tenant !== undefined ? { tenantId: tenant } : {}),
    db,
    operador: typeof cuentaOperador === 'string' ? cuentaOperador : '',
    aplicar,
    reasignar,
    eliminar,
  });
  if (r.diferencias.length === 0) console.log('dominio-tenant: el host ya está asignado a ese tenant.');
  else for (const d of r.diferencias) console.log(`  ${d}`);
  console.log(r.aplicado ? 'dominio-tenant: aplicado.' : 'dominio-tenant: sin escritura (use --aplicar para escribir).');
} catch (e) {
  falla(e instanceof RechazoDominio || e instanceof ErrorSeguro ? e.message : 'error inesperado');
}
