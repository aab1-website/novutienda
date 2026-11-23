// Siembra `tenants/{t}/sitio/negocio` (versión 1) desde un JSON por entrada estándar. Solo staging o emulador.
//
//   node scripts/sembrar-negocio-sitio.mjs <tenant> --proyecto <id> < negocio.json            prueba en seco (no escribe)
//   node scripts/sembrar-negocio-sitio.mjs <tenant> --proyecto <id> --aplicar < negocio.json  escribe la versión 1 y audita
//
// El JSON llega por stdin (hasta 256 KB; nunca por argumento). Las claves `mercados`, `mercadoInicial`, `logo` y `whatsappTienda`
// se ignoran: no se guardan. No escribe `publicado/negocio`: lo publicado se genera con Publicar en la consola.
// Códigos de salida: 0 = listo (en seco o aplicado); 1 = error (entorno, uso, JSON o datos inválidos, Firebase); 2 = ya existe
// `sitio/negocio` (no se escribe nada).
// Entorno (scripts/guardia-operador.mjs `validarEntorno`): GOOGLE_CLOUD_PROJECT igual a --proyecto; NOVUTIENDA_AMBIENTE=staging con
// GCP_PROJECT_ID_STAGING, o emulador con proyecto demo-*. Rechaza producción. Nunca imprime valores del JSON ni identificadores:
// solo nombres de campo y rutas. La lógica vive en plataforma/operador/negocio-sitio.ts (pura, con la base inyectable).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cargarManifiestos } from './generar-reglas.mjs';
import { validarEntorno } from './guardia-operador.mjs';

const MAX_BYTES = 256 * 1024;
const falla = (mensaje, codigo = 1) => {
  console.error(`sembrar-negocio-sitio: ${mensaje}`);
  process.exit(codigo);
};

const USO = 'uso: sembrar-negocio-sitio.mjs <tenant> --proyecto <id> [--aplicar] < negocio.json';
const args = process.argv.slice(2);
let tenant;
let proyectoArg;
let aplicar = false;
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === '--proyecto') {
    i += 1;
    proyectoArg = args[i];
  } else if (a === '--aplicar') aplicar = true;
  else if (a.startsWith('--') || tenant !== undefined) falla(USO);
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

// Los ganchos de TypeScript se registran ANTES de leer la entrada (el orden inverso rompe la carga del núcleo).
await cargarManifiestos(); // registra los ganchos de TypeScript

// stdin: se lee entero con tope; un JSON mal formado no se cita (el mensaje de JSON.parse puede traer un fragmento).
let crudo;
try {
  const texto = readFileSync(0);
  if (texto.length === 0) falla('la entrada está vacía: pase el JSON por la entrada estándar');
  if (texto.length > MAX_BYTES) falla('la entrada supera 256 KB');
  crudo = JSON.parse(texto.toString('utf8'));
} catch (e) {
  if (e instanceof SyntaxError) falla('la entrada no es un JSON válido');
  falla('no se pudo leer la entrada estándar');
}

// Plataforma no importa un módulo directamente: el validador llega por el registro (`plataforma/registro.ts` lo reexporta).
const registro = await import(pathToFileURL(resolve('plataforma/registro.ts')).href);
if (typeof registro.evaluarNegocioSitio !== 'function') falla('plataforma/registro.ts no exporta evaluarNegocioSitio');
const { sembrarNegocioSitio } = await import(pathToFileURL(resolve('plataforma/operador/negocio-sitio.ts')).href);
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
          set: (ruta, datos) => void tx.set(firestore.doc(ruta), datos),
          create: (ruta, datos) => void tx.create(firestore.doc(ruta), datos),
          nuevoId: (coleccion) => firestore.collection(coleccion).doc().id,
          marcaTiempoServidor: () => FieldValue.serverTimestamp(),
        }),
      ),
    ),
};

try {
  const r = await sembrarNegocioSitio({ db, reloj: { ahora: () => Date.now() }, evaluar: registro.evaluarNegocioSitio }, { tenant, crudo, aplicar });
  if (r.estado === 'invalido') {
    for (const ruta of r.errores) console.error(`  inválido: ${ruta}`);
    falla('el JSON no cumple la regla del negocio del sitio (arriba, las rutas; sin valores)');
  }
  if (r.estado === 'ya-existe') falla('ya-existe: el tenant ya tiene sitio/negocio; no se escribió nada', 2);
  console.log(`  campos: ${r.campos.join(', ')}`);
  for (const a of r.avisos) console.log(`  aviso (nivel estricto): ${a}`);
  console.log(r.aplicado ? 'sembrar-negocio-sitio: aplicado (versión 1).' : 'sembrar-negocio-sitio: sin escritura (use --aplicar para escribir).');
} catch (e) {
  falla(e instanceof Error ? e.message : 'error desconocido');
}
