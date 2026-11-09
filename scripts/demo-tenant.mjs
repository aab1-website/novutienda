// Carga de datos de demostración de un tenant por las MISMAS callables del panel (nada se escribe directo en Firestore).
//
//   node scripts/demo-tenant.mjs <tenant> --credenciales <ruta> [--web <ruta>] [--verificar] [--sin-fotos] [--sin-ventas]
//   node scripts/demo-tenant.mjs <tenant> --credenciales <ruta> [--web <ruta>] --aplicar [--sin-fotos] [--sin-ventas]
//
// Inicia sesión con el SDK cliente de Firebase como administrador (y como cajero para las ventas) con el archivo de
// credenciales que dejó personal-tenant.mjs (por defecto, junto a él, `web.json` con la configuración web del proyecto; con
// `--web` se indica otra ruta). Con FIREBASE_AUTH_EMULATOR_HOST / FUNCTIONS_EMULATOR_HOST / FIREBASE_STORAGE_EMULATOR_HOST
// definidos se conecta al emulador y no necesita `web.json` (usa GOOGLE_CLOUD_PROJECT). `--verificar` solo lee y muestra el
// plan; `--aplicar` ejecuta lo que falta: una segunda pasada no escribe nada. No imprime uid, correos, proyecto ni tokens.
// Fixtures: scripts/demo/ (todo ficticio). La planificación vive en plataforma/operador/demo.ts (pura).
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { setTimeout as esperar } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { connectStorageEmulator, getStorage, ref, uploadBytes } from 'firebase/storage';
import { cargarManifiestos } from './generar-reglas.mjs';

const falla = (mensaje) => {
  console.error(`demo-tenant: ${mensaje}`);
  process.exit(1);
};

const args = process.argv.slice(2);
const CON_VALOR = ['--credenciales', '--web'];
const tenant = args.find((a, i) => !a.startsWith('--') && !CON_VALOR.includes(args[i - 1] ?? ''));
const valorDe = (b) => {
  const i = args.indexOf(b);
  return i === -1 ? undefined : args[i + 1];
};
const credencialesRuta = valorDe('--credenciales');
const webArg = valorDe('--web');
const BANDERAS = ['--aplicar', '--verificar', '--sin-fotos', '--sin-ventas', ...CON_VALOR];
const desconocidas = args.filter((a) => a.startsWith('--') && !BANDERAS.includes(a));
const modos = args.filter((a) => a === '--aplicar' || a === '--verificar');
if (
  tenant === undefined || credencialesRuta === undefined || credencialesRuta.startsWith('--') || (webArg !== undefined && webArg.startsWith('--')) ||
  desconocidas.length > 0 || modos.length > 1
) {
  falla('uso: demo-tenant.mjs <tenant> --credenciales <ruta> [--web <ruta>] [--verificar | --aplicar] [--sin-fotos] [--sin-ventas]');
}
if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenant)) falla('el tenant no es un identificador válido');
const aplicar = modos[0] === '--aplicar';
const conFotos = !args.includes('--sin-fotos');
const conVentas = !args.includes('--sin-ventas');

// ---- Archivos locales -------------------------------------------------------------------------------------------
const rutaCred = resolve(credencialesRuta);
const relCred = relative(process.cwd(), rutaCred);
if (relCred === '' || (!relCred.startsWith('..') && !relCred.startsWith('/'))) falla('el archivo de credenciales debe estar fuera del repositorio');
const leerJson = (ruta, que) => {
  try {
    return JSON.parse(readFileSync(ruta, 'utf8'));
  } catch {
    return falla(`no se pudo leer ${que} (JSON)`);
  }
};
const credenciales = leerJson(rutaCred, 'el archivo de credenciales');
const cuentaDe = (rol) => (Array.isArray(credenciales.cuentas) ? credenciales.cuentas.find((c) => c.rol === rol) : undefined);
const cuentaAdm = cuentaDe('adm');
const cuentaCaj = cuentaDe('caj');
const cuentaSup = cuentaDe('sup');
if (cuentaAdm === undefined || cuentaSup === undefined || cuentaCaj === undefined) falla('el archivo de credenciales debe tener las cuentas adm, sup y caj');

const emuladorAuth = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const emuladorFunciones = process.env.FUNCTIONS_EMULATOR_HOST ?? (process.env.FIREBASE_AUTH_EMULATOR_HOST !== undefined ? '127.0.0.1:8245' : undefined);
const emuladorStorage = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const enEmulador = emuladorAuth !== undefined;
let webConfig;
if (enEmulador && webArg === undefined) {
  const proyecto = process.env.GOOGLE_CLOUD_PROJECT;
  if (!proyecto) falla('defina GOOGLE_CLOUD_PROJECT para el emulador');
  webConfig = { apiKey: 'clave-del-emulador', projectId: proyecto, storageBucket: `${proyecto}.appspot.com` };
} else {
  webConfig = leerJson(resolve(webArg ?? join(dirname(rutaCred), 'web.json')), 'la configuración web (web.json)');
  if (typeof webConfig.apiKey !== 'string' || typeof webConfig.projectId !== 'string' || typeof webConfig.storageBucket !== 'string') {
    falla('web.json debe traer apiKey, projectId y storageBucket');
  }
}

const dirDemo = resolve('scripts/demo');
const catalogoCsv = readFileSync(join(dirDemo, 'catalogo.csv'), 'utf8');
const fixture = leerJson(join(dirDemo, 'demo.json'), 'scripts/demo/demo.json');
const bytesFoto = {};
const archivosFoto = new Map();
for (const f of fixture.fichas) {
  for (const foto of f.fotos) {
    if (!archivosFoto.has(foto.archivo)) {
      const datos = readFileSync(join(dirDemo, 'fotos', foto.archivo));
      archivosFoto.set(foto.archivo, datos);
      bytesFoto[foto.archivo] = datos.length;
    }
  }
}

await cargarManifiestos(); // registra los ganchos de TypeScript
const { planificarDemo, ventaIdDemo } = await import(pathToFileURL(resolve('plataforma/operador/demo.ts')).href);

// ---- Sesiones y llamadas ----------------------------------------------------------------------------------------
// Un SDK cliente por sesión: la de administración y la de caja no se mezclan.
const sesiones = new Map();
async function sesion(actor) {
  const previa = sesiones.get(actor);
  if (previa !== undefined) return previa;
  const app = initializeApp(webConfig, `demo-${actor}`);
  const auth = getAuth(app);
  if (emuladorAuth !== undefined) connectAuthEmulator(auth, `http://${emuladorAuth}`, { disableWarnings: true });
  const funciones = getFunctions(app, 'us-east1');
  if (emuladorFunciones !== undefined) {
    const [host, puerto] = emuladorFunciones.split(':');
    connectFunctionsEmulator(funciones, host, Number(puerto));
  }
  const almacenamiento = getStorage(app);
  if (emuladorStorage !== undefined) {
    const [host, puerto] = emuladorStorage.split(':');
    connectStorageEmulator(almacenamiento, host, Number(puerto));
  }
  const cuenta = actor === 'adm' ? cuentaAdm : cuentaCaj;
  try {
    // El claim del cajero se asigna durante esta misma corrida: el token se pide fresco.
    const cred = await signInWithEmailAndPassword(auth, cuenta.correo, cuenta.contrasena);
    await cred.user.getIdToken(true);
  } catch (e) {
    throw new Error(`no se pudo iniciar sesión como ${actor} (${e && typeof e === 'object' && 'code' in e ? String(e.code) : 'desconocido'})`, { cause: e });
  }
  const s = { funciones, almacenamiento, auth };
  sesiones.set(actor, s);
  return s;
}

/** Error legible sin identificadores: el código del servidor y su mensaje (apto para usuarios). */
class ErrorLlamada extends Error {
  constructor(codigo, mensaje) {
    super(`${codigo}: ${mensaje}`);
    this.codigo = codigo;
  }
}
async function llamar(actor, modulo, accion, datos = {}) {
  const s = await sesion(actor);
  try {
    const r = await httpsCallable(s.funciones, modulo)({ accion, tenantId: tenant, datos });
    return r.data;
  } catch (e) {
    const codigo = e && typeof e === 'object' && 'code' in e ? String(e.code).replace(/^functions\//, '') : 'internal';
    const mensaje = e && typeof e === 'object' && 'message' in e && codigo !== 'internal' ? String(e.message).slice(0, 160) : 'error de la llamada';
    throw new ErrorLlamada(codigo, mensaje);
  }
}
const leerOpcional = async (actor, modulo, accion, datos) => {
  try {
    return await llamar(actor, modulo, accion, datos);
  } catch (e) {
    if (e instanceof ErrorLlamada && e.codigo === 'not-found') return null;
    throw e;
  }
};

// ---- Lectura del estado (solo callables de lectura) -------------------------------------------------------------
async function leerEstado() {
  const usuarios = (await llamar('adm', 'consola', 'listarUsuarios')).usuarios ?? [];
  const cuenta = async (c) => {
    const r = await leerOpcional('adm', 'consola', 'buscarUsuarioPorCorreo', { correo: c.correo });
    if (r === null) return null;
    return { uid: String(r.uid), rolActual: usuarios.find((u) => u.uid === r.uid)?.rol ?? null };
  };
  const ubicaciones = ((await llamar('adm', 'inventarios', 'ubicaciones')).ubicaciones ?? []).map((u) => u.id);
  const productos = ((await llamar('adm', 'inventarios', 'listarProductos', {})).productos ?? []).map((p) => p.id);
  const series = {};
  const productosConSerie = [...new Set(fixture.series.map((g) => g.productoId))].filter((id) => productos.includes(id));
  for (const productoId of productosConSerie) {
    for (const u of (await llamar('adm', 'inventarios', 'series', { productoId })).unidades ?? []) series[u.serie] = u.ubicacionId;
  }
  const plantilla = (await llamar('adm', 'recibos', 'leerPlantilla', {})).plantilla ?? null;
  const configSitio = (await llamar('adm', 'consola', 'configSitio', {})).config ?? null;
  const fichas = {};
  for (const f of (await llamar('adm', 'consola', 'fichas', {})).fichas ?? []) fichas[f.productoId] = f.ficha;
  const medios = {};
  for (const f of fixture.fichas) {
    if (!productos.includes(f.productoId)) continue;
    medios[f.productoId] = ((await llamar('adm', 'medios', 'listarMedios', { productoId: f.productoId })).medios ?? []).map((m) => m.id);
  }
  const t = await llamar('adm', 'consola', 'tablero', {});
  const turnos = ((await llamar('adm', 'pos', 'turnos', { limite: 30 })).turnos ?? []).map((x) => ({ turnoId: x.turnoId, estado: x.estado }));
  const ventas = [];
  for (const v of fixture.pos.ventas) {
    const id = ventaIdDemo(v.clave);
    if ((await leerOpcional('adm', 'pos', 'venta', { ventaId: id })) !== null) ventas.push(id);
  }
  return {
    cuentas: { sup: await cuenta(cuentaSup), caj: await cuenta(cuentaCaj) },
    ubicaciones, productos, series, plantilla, configSitio, fichas, medios,
    tablero: { versionPublicada: Number(t.versionPublicada ?? 0), cambiosSinPublicar: Number(t.cambiosSinPublicar ?? 0) },
    turnos, ventas,
  };
}

// ---- Fotos -----------------------------------------------------------------------------------------------------
async function subirFoto(paso) {
  const bytes = archivosFoto.get(paso.archivo);
  if (bytes === undefined) throw new Error('archivo de foto desconocido');
  const reserva = await llamar('adm', 'medios', 'reservarSubida', { subidaId: paso.subidaId, productoId: paso.productoId, tipo: 'foto', bytes: bytes.length });
  const s = await sesion('adm');
  try {
    await uploadBytes(ref(s.almacenamiento, reserva.rutaOriginal), bytes, { contentType: 'image/png' });
  } catch (e) {
    throw new Error(`no se pudo subir la foto (${e && typeof e === 'object' && 'code' in e ? String(e.code) : 'desconocido'})`, { cause: e });
  }
  // El disparador de Storage también finaliza la subida: si gana él, finalizarSubida responde «ya resuelta» y se espera el estado.
  try {
    await llamar('adm', 'medios', 'finalizarSubida', { subidaId: paso.subidaId });
    return;
  } catch (e) {
    if (!(e instanceof ErrorLlamada) || e.codigo !== 'failed-precondition') throw e;
  }
  for (let i = 0; i < 40; i += 1) {
    const r = await llamar('adm', 'medios', 'estadoSubida', { subidaId: paso.subidaId });
    if (r.estado === 'procesada') return;
    if (r.estado === 'rechazada') throw new Error('el servidor rechazó una foto');
    await esperar(1500);
  }
  throw new Error('una foto no terminó de procesarse a tiempo');
}

// ---- Ejecución --------------------------------------------------------------------------------------------------
try {
  const estado = await leerEstado();
  const plan = planificarDemo(catalogoCsv, fixture, estado, { fotos: conFotos, ventas: conVentas, bytesFoto });
  if (plan.diferencias.length === 0) console.log('demo-tenant: el tenant ya tiene los datos de demostración.');
  else for (const d of plan.diferencias) console.log(`  ${d}`);
  for (const b of plan.bloqueos) console.log(`  BLOQUEO: ${b}`);
  console.log(`demo-tenant: pasos pendientes ${plan.pasos.length}.`);
  if (!aplicar) {
    console.log('demo-tenant: sin escritura (use --aplicar para escribir).');
  } else if (plan.bloqueos.length > 0) {
    falla('hay bloqueos: no se escribe nada');
  } else {
    const porEtapa = new Map();
    for (const paso of plan.pasos) {
      if (paso.tipo === 'foto') await subirFoto(paso);
      else await llamar(paso.como, paso.modulo, paso.accion, paso.datos);
      porEtapa.set(paso.etapa, (porEtapa.get(paso.etapa) ?? 0) + 1);
    }
    for (const [etapa, n] of porEtapa) console.log(`  ${etapa}: ${n}`);
    console.log('demo-tenant: aplicado.');
  }
} catch (e) {
  falla(e instanceof Error ? e.message : 'error desconocido');
}
process.exit(0); // los SDK cliente dejan conexiones abiertas
