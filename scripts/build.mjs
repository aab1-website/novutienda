// Build raíz: `pnpm build -- --mode <staging|production>` (o APP_ENV=<ambiente> pnpm build).
//
// 1. Compila el sitio (`@novutienda/website`, salida dist/website con `_cabeceras.json` sellado) y el panel
//    (`@novutienda/panel`, salida dist/panel con su `_cabeceras.json`), cada uno con su propio script de build.
// 2. Ejecuta plataforma/funciones/scripts/componer-hosting.mjs para incorporar las CSP selladas del sitio y del panel a una
//    COPIA de firebase.json: dist/firebase.json. El firebase.json versionado no se toca; el CI despliega con la
//    copia que viaja en el artifact de dist/ (se despliega exactamente lo que se construyó).
// 3. Verifica que dist/ quede listo: index.html y `_cabeceras.json` en ambos sitios y los `public` de Hosting
//    de dist/firebase.json existentes.
//
// /healthz ya no es un archivo estático: lo atiende la función `api` (rewrite de Hosting). Ver
// docs/arquitectura/decisiones.md («Contrato de dist/»).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const AMBIENTES = ['staging', 'production'];

function leerModo(argv) {
  const args = argv.filter((a) => a !== '--');
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--mode') return args[i + 1];
    if (args[i].startsWith('--mode=')) return args[i].slice('--mode='.length);
  }
  return process.env.APP_ENV || 'staging';
}

function fallar(mensaje) {
  console.error(`build: ${mensaje}`);
  process.exit(1);
}

function correr(descripcion, comando, args, env) {
  console.log(`build: ${descripcion}`);
  const r = spawnSync(comando, args, { stdio: 'inherit', env });
  if (r.error) fallar(`${descripcion}: ${r.error.message}`);
  if (r.status !== 0) fallar(`${descripcion} terminó con código ${r.status}`);
}

const modo = leerModo(process.argv.slice(2));
if (!AMBIENTES.includes(modo)) fallar(`modo «${modo}» no válido; use --mode ${AMBIENTES.join(' | ')}`);

const env = { ...process.env, APP_ENV: modo };

// Salidas de una construcción anterior (incluido el contrato viejo: dist/index.html y dist/healthz).
for (const ruta of ['dist/website', 'dist/panel', 'dist/firebase.json', 'dist/index.html', 'dist/healthz']) {
  rmSync(ruta, { recursive: true, force: true });
}

correr('sitio (@novutienda/website)', 'pnpm', ['--filter', '@novutienda/website', 'run', 'build'], env);
correr('panel (@novutienda/panel)', 'pnpm', ['--filter', '@novutienda/panel', 'run', 'build'], env);

for (const ruta of ['dist/website/index.html', 'dist/website/_cabeceras.json', 'dist/panel/index.html', 'dist/panel/_cabeceras.json']) {
  if (!existsSync(ruta)) fallar(`falta ${ruta} tras compilar`);
}

correr('cabeceras selladas del sitio → dist/firebase.json', 'node', [
  'plataforma/funciones/scripts/componer-hosting.mjs',
  '--firebase', 'firebase.json',
  '--cabeceras', 'dist/website/_cabeceras.json',
  '--salida', 'dist/firebase.json',
], env);

const compuesto = JSON.parse(readFileSync('dist/firebase.json', 'utf8'));
const targets = (compuesto.hosting ?? []).map((h) => h.target).sort();
if (targets.join(',') !== 'panel,sitio') fallar(`dist/firebase.json debe declarar los targets sitio y panel (tiene: ${targets.join(', ') || 'ninguno'})`);
for (const h of compuesto.hosting) {
  if (!existsSync(`${h.public}/index.html`)) fallar(`el target ${h.target} publica ${h.public}, que no tiene index.html`);
}

console.log(`build (${modo}): dist/website y dist/panel listos; dist/firebase.json con las CSP selladas del sitio y del panel.`);
