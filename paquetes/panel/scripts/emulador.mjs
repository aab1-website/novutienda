// Corre una orden dentro del emulador de Firebase (Auth, Firestore, Storage, Functions y Eventarc) con el proyecto
// ficticio `demo-pruebas` y los puertos de firebase.json. Nada toca Firebase real. Igual que `pnpm test:funciones`
// (plataforma/funciones/scripts/probar.mjs): empaqueta las funciones y genera los secretos de la prueba al vuelo.
//   node paquetes/panel/scripts/emulador.mjs "<orden>"
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';

// Las rutas (firebase.json, dist/funciones) son relativas a la raíz del repositorio.
process.chdir(fileURLToPath(new URL('../../../', import.meta.url)));

const orden = process.argv.slice(2).join(' ');
if (orden === '') {
  console.error('Uso: node paquetes/panel/scripts/emulador.mjs "<orden>"');
  process.exit(2);
}
const config = JSON.parse(readFileSync('firebase.json', 'utf8')).emulators;
const puertos = ['auth', 'firestore', 'storage', 'functions', 'eventarc', 'hub', 'logging'].map((n) => config[n].port);

function ocupado(puerto) {
  return new Promise((resolver) => {
    const s = connect({ host: '127.0.0.1', port: puerto });
    s.once('connect', () => { s.destroy(); resolver(true); });
    s.once('error', () => resolver(false));
  });
}
for (const p of puertos) {
  if (await ocupado(p)) {
    console.error(`El puerto ${p} ya está en uso (otra sesión u otro worktree); no se corre contra un emulador ajeno.`);
    process.exit(1);
  }
}
const construccion = spawnSync('node', ['plataforma/funciones/scripts/empaquetar.mjs'], { stdio: 'inherit' });
if (construccion.status !== 0) process.exit(construccion.status ?? 1);

const env = {
  ...process.env,
  PLATAFORMA_PRUEBAS: '1', PRUEBAS_FUNCIONES_EXIGIR: '1', TENANT_ID: 'tienda-prueba', APP_CHECK_EXIGIDO: process.env.APP_CHECK_EXIGIDO === 'true' ? 'true' : 'false', APP_CHECK_MODO: 'simulado', RECAPTCHA_MODO: 'simulado',
  NOVUCHAT_PEDIDOS_SECRETO: randomBytes(24).toString('hex'), SITIO_RECONSTRUCCION_SECRETO: randomBytes(24).toString('hex'),
  LIMITE_TASA_SAL: randomBytes(16).toString('hex'), CONTACTO_MAXIMO: '3', SITIO_URL: 'https://sitio.ejemplo.test', MEDIOS_BASE_URL: 'https://medios.ejemplo.test',
};
const PARAMETROS = ['TENANT_ID', 'APP_CHECK_EXIGIDO', 'APP_CHECK_MODO', 'RECAPTCHA_MODO', 'CONTACTO_MAXIMO', 'SITIO_URL', 'MEDIOS_BASE_URL'];
writeFileSync('dist/funciones/.env.demo-pruebas', PARAMETROS.map((k) => `${k}=${env[k]}`).join('\n') + '\n');
writeFileSync('dist/funciones/.secret.local', ['NOVUCHAT_PEDIDOS_SECRETO', 'SITIO_RECONSTRUCCION_SECRETO', 'LIMITE_TASA_SAL'].map((k) => `${k}=${env[k]}`).join('\n') + '\n', { mode: 0o600 });
const r = spawnSync('firebase', ['emulators:exec', '--only', 'auth,firestore,storage,functions,eventarc', '--project', 'demo-pruebas', orden], { stdio: 'inherit', env });
rmSync('dist/funciones/.secret.local', { force: true });
process.exit(r.status ?? 1);
