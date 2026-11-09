// Alta del personal de un tenant: cuentas de correo y contraseña en Firebase Auth + primer administrador.
//
//   node scripts/personal-tenant.mjs <tenant> --entrada <ruta> [--credenciales <ruta>] [--verificar]   solo lectura
//   node scripts/personal-tenant.mjs <tenant> --entrada <ruta> [--credenciales <ruta>] --aplicar       escribe
//
// `--entrada` es un JSON `{ "cuentas": [{ "correo", "rol": "adm|sup|caj", "nombre"? }] }` (ejemplo genérico:
// scripts/demo/personal.json). Las contraseñas (aleatorias, 32 caracteres) se guardan SOLO en el archivo de
// credenciales (por defecto `credenciales.json` junto a la entrada), con permisos 0600 y fuera del repositorio; nunca se
// imprimen. El proyecto sale de GOOGLE_CLOUD_PROJECT (obligatorio; con FIREBASE_AUTH_EMULATOR_HOST y
// FIRESTORE_EMULATOR_HOST apunta al emulador). No imprime identificadores, correos ni contraseñas: solo conteos.
// La lógica vive en plataforma/operador/personal.ts (pura, con Auth y base inyectables).
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cargarManifiestos } from './generar-reglas.mjs';

const falla = (mensaje) => {
  console.error(`personal-tenant: ${mensaje}`);
  process.exit(1);
};

const args = process.argv.slice(2);
const tenant = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').match(/^--(entrada|credenciales)$/));
const valorDe = (bandera) => {
  const i = args.indexOf(bandera);
  return i === -1 ? undefined : args[i + 1];
};
const entradaRuta = valorDe('--entrada');
const credencialesArg = valorDe('--credenciales');
const modos = args.filter((a) => a === '--aplicar' || a === '--verificar');
const desconocidas = args.filter((a) => a.startsWith('--') && !['--aplicar', '--verificar', '--entrada', '--credenciales'].includes(a));
if (tenant === undefined || entradaRuta === undefined || entradaRuta.startsWith('--') || desconocidas.length > 0 || modos.length > 1 || (credencialesArg !== undefined && credencialesArg.startsWith('--'))) {
  falla('uso: personal-tenant.mjs <tenant> --entrada <ruta> [--credenciales <ruta>] [--verificar | --aplicar]');
}
const aplicar = modos[0] === '--aplicar';
if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenant)) falla('el tenant no es un identificador válido');
const proyecto = process.env.GOOGLE_CLOUD_PROJECT;
if (!proyecto) falla('defina GOOGLE_CLOUD_PROJECT');

const rutaCredenciales = resolve(credencialesArg ?? join(dirname(resolve(entradaRuta)), 'credenciales.json'));
// Repositorio público: el archivo de contraseñas nunca puede quedar dentro del árbol de trabajo.
const rel = relative(process.cwd(), rutaCredenciales);
if (rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))) falla('el archivo de credenciales debe estar fuera del repositorio');

let entrada;
try {
  entrada = JSON.parse(readFileSync(resolve(entradaRuta), 'utf8'));
} catch {
  falla('no se pudo leer la entrada (JSON)');
}

await cargarManifiestos(); // registra los ganchos de TypeScript
const { aplicarPersonal, operadorDe } = await import(pathToFileURL(resolve('plataforma/operador/personal.ts')).href);
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
    if (e instanceof Error && e.name === 'ErrorIdentidad') throw e;
    throw new Error(`error de Firebase (${e && typeof e === 'object' && 'code' in e ? String(e.code) : 'desconocido'})`, { cause: e });
  }
};

const aUsuario = (u) => ({
  uid: u.uid,
  disabled: u.disabled === true,
  emailVerified: u.emailVerified === true,
  proveedores: u.providerData.map((p) => p.providerId),
  claims: u.customClaims,
});
const auth = {
  getUser: (uid) =>
    sinIdentificadores(async () => {
      const u = await authAdmin.getUser(uid);
      return { customClaims: u.customClaims, providerData: u.providerData.map((p) => ({ providerId: p.providerId })), emailVerified: u.emailVerified };
    }),
  setCustomUserClaims: (uid, claims) => sinIdentificadores(() => authAdmin.setCustomUserClaims(uid, { ...claims })),
  revokeRefreshTokens: (uid) => sinIdentificadores(() => authAdmin.revokeRefreshTokens(uid)),
  buscarPorCorreo: (correo) =>
    sinIdentificadores(async () => {
      try {
        return aUsuario(await authAdmin.getUserByEmail(correo));
      } catch (e) {
        if (e && typeof e === 'object' && e.code === 'auth/user-not-found') return null;
        throw e;
      }
    }),
  crear: ({ correo, contrasena, nombre }) =>
    sinIdentificadores(async () => (await authAdmin.createUser({ email: correo, password: contrasena, emailVerified: true, ...(nombre !== undefined ? { displayName: nombre } : {}) })).uid),
  listarUsuarios: () =>
    sinIdentificadores(async () => {
      const salida = [];
      let token;
      do {
        const pagina = await authAdmin.listUsers(1000, token);
        salida.push(...pagina.users.map(aUsuario));
        token = pagina.pageToken;
      } while (token !== undefined);
      return salida;
    }),
};

// Base transaccional de identidad sobre Firestore (las lecturas van antes de las escrituras).
const limpiar = (datos) => Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== undefined));
const db = {
  runTransaction: (fn) =>
    sinIdentificadores(() =>
      firestore.runTransaction((tx) =>
        fn({
          get: async (ruta) => {
            const s = await tx.get(firestore.doc(ruta));
            return { existe: s.exists, data: () => s.data() };
          },
          set: (ruta, datos) => void tx.set(firestore.doc(ruta), limpiar(datos)),
          create: (ruta, datos) => void tx.create(firestore.doc(ruta), limpiar(datos)),
          delete: (ruta) => void tx.delete(firestore.doc(ruta)),
          nuevoId: (coleccion) => firestore.collection(coleccion).doc().id,
          marcaTiempoServidor: () => FieldValue.serverTimestamp(),
        }),
      ),
    ),
};

const credenciales = {
  leer: async () => {
    if (!existsSync(rutaCredenciales)) return [];
    try {
      const x = JSON.parse(readFileSync(rutaCredenciales, 'utf8'));
      return Array.isArray(x.cuentas) ? x.cuentas : [];
    } catch {
      throw new Error('el archivo de credenciales existe pero no es un JSON válido');
    }
  },
  guardar: async (cuentas) => {
    const temporal = `${rutaCredenciales}.tmp`;
    writeFileSync(temporal, `${JSON.stringify({ cuentas }, null, 2)}\n`, { mode: 0o600 });
    chmodSync(temporal, 0o600);
    renameSync(temporal, rutaCredenciales);
  },
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
  const r = await aplicarPersonal({
    tenantId: tenant,
    entrada,
    auth,
    db,
    credenciales,
    aleatorios: (n) => randomBytes(n),
    operador: operadorDe(typeof cuentaOperador === 'string' ? cuentaOperador : undefined),
    aplicar,
  });
  console.log(`personal-tenant: cuentas ${r.cuentas}, existentes ${r.existentes}, creadas ${r.creadas}, administrador asignado ${r.adminAsignado ? 1 : 0}.`);
  if (r.diferencias.length === 0) console.log('personal-tenant: el personal ya coincide con la entrada.');
  else for (const d of r.diferencias) console.log(`  ${d}`);
  console.log(r.aplicado ? 'personal-tenant: aplicado.' : 'personal-tenant: sin escritura (use --aplicar para escribir).');
} catch (e) {
  falla(e instanceof Error ? e.message : 'error desconocido');
}
