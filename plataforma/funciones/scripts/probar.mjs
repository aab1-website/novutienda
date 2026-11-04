// test:funciones — empaqueta las funciones y corre la suite de pruebas/funciones contra el emulador de
// Firebase (Auth, Firestore, Storage, Functions y Eventarc) con el proyecto ficticio demo-pruebas y los puertos
// de firebase.json. Nada toca Firebase real: el proyecto `demo-*` no existe en la nube. Los secretos de la
// prueba se generan al vuelo y no se guardan.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';

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
    console.error(`test:funciones: el puerto ${p} ya está en uso (otra sesión u otro worktree); no se corre contra un emulador ajeno.`);
    process.exit(1);
  }
}

const construccion = spawnSync('node', ['plataforma/funciones/scripts/empaquetar.mjs'], { stdio: 'inherit' });
if (construccion.status !== 0) process.exit(construccion.status ?? 1);

const env = {
  ...process.env,
  PLATAFORMA_PRUEBAS: '1',
  TENANT_ID: 'casa-bermejo',
  APP_CHECK_MODO: 'simulado',
  RECAPTCHA_MODO: 'simulado',
  NOVUCHAT_PEDIDOS_SECRETO: randomBytes(24).toString('hex'),
  SITIO_RECONSTRUCCION_SECRETO: randomBytes(24).toString('hex'),
  LIMITE_TASA_SAL: randomBytes(16).toString('hex'),
  CONTACTO_MAXIMO: '3',
  SITIO_URL: 'https://sitio.ejemplo.test',
  MEDIOS_BASE_URL: 'https://medios.ejemplo.test',
};
// Los parámetros no secretos los lee el emulador de `.env.<proyecto>` junto al código (no del entorno del proceso).
const PARAMETROS = ['TENANT_ID', 'APP_CHECK_MODO', 'RECAPTCHA_MODO', 'CONTACTO_MAXIMO', 'SITIO_URL', 'MEDIOS_BASE_URL'];
writeFileSync('dist/funciones/.env.demo-pruebas', PARAMETROS.map((k) => `${k}=${env[k]}`).join('\n') + '\n');
// El emulador lee los secretos de `.secret.local` junto al código (no de Secret Manager). `dist/` está ignorado.
writeFileSync(
  'dist/funciones/.secret.local',
  ['NOVUCHAT_PEDIDOS_SECRETO', 'SITIO_RECONSTRUCCION_SECRETO', 'LIMITE_TASA_SAL'].map((k) => `${k}=${env[k]}`).join('\n') + '\n',
  { mode: 0o600 },
);
const comando = `npx vitest --run --no-file-parallelism pruebas/funciones ${process.argv.slice(2).join(' ')}`.trim();
const r = spawnSync(
  'firebase',
  ['emulators:exec', '--only', 'auth,firestore,storage,functions,eventarc', '--project', 'demo-pruebas', comando],
  { stdio: 'inherit', env },
);
process.exit(r.status ?? 1);
