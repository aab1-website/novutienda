// Empaqueta las funciones para desplegar y para el emulador: un solo `index.js` (los paquetes del monorepo son
// TypeScript y `workspace:*` no se instala con npm en Cloud Build) más un `package.json` limpio que declara solo
// las dependencias de ejecución, con las MISMAS versiones exactas que `plataforma/funciones/package.json`, y su `package-lock.json`.
// Salida: dist/funciones/ (ignorada por git y por ESLint; es el `source` de `functions` en firebase.json).
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..');
const dist = join(raiz, '..', '..', 'dist', 'funciones');
const origen = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'));

// Nativos o grandes que Cloud Build instala por su cuenta; el resto se incluye en el paquete.
const EXTERNOS = ['firebase-admin', 'firebase-functions', 'sharp'];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [join(raiz, 'servidor/index.ts')],
  outfile: join(dist, 'index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: EXTERNOS.flatMap((n) => [n, `${n}/*`]),
  banner: { js: "import { createRequire as __crearRequire } from 'node:module'; const require = __crearRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'warning',
});

const dependencias = Object.fromEntries(EXTERNOS.map((n) => [n, origen.dependencies[n]]));
if (Object.values(dependencias).some((v) => typeof v !== 'string' || !/^\d+\.\d+\.\d+$/.test(v))) {
  throw new Error('Las dependencias de ejecución deben tener versión exacta');
}
writeFileSync(
  join(dist, 'package.json'),
  `${JSON.stringify({ name: 'plataforma-funciones', version: origen.version, private: true, type: 'module', main: 'index.js', engines: { node: '22' }, dependencies: dependencias }, null, 2)}\n`,
);
// Lockfile del paquete que se despliega. Cloud Build instala con `npm ci` si hay `package-lock.json` (instalación reproducible y
// analizable); sin él, `npm install` resolvería otras versiones de lo transitivo en cada despliegue y nadie las habría analizado.
// Se genera SIN instalar nada (`--package-lock-only`) y antes del enlace a node_modules (npm no debe seguirlo). El CI lo analiza con
// osv-scanner en el mismo job (ci-node-firebase.yml, paso «osv-scanner del paquete de Functions»).
const lock = spawnSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dist, stdio: 'inherit' });
if (lock.status !== 0 || !existsSync(join(dist, 'package-lock.json'))) {
  throw new Error('No se pudo generar dist/funciones/package-lock.json (npm install --package-lock-only); el despliegue no sería reproducible');
}
const raizLock = JSON.parse(readFileSync(join(dist, 'package-lock.json'), 'utf8')).packages?.[''] ?? {};
for (const [nombre, version] of Object.entries(dependencias)) {
  if (raizLock.dependencies?.[nombre] !== version) throw new Error(`El lockfile no fija ${nombre}@${version}`);
}
// Solo para el emulador y el desarrollo local: el emulador busca `.bin/firebase-functions` y los módulos junto
// al código. `firebase deploy` ignora `node_modules` (ver `ignore` en firebase.json) y Cloud Build instala los suyos.
if (existsSync(join(raiz, 'node_modules'))) symlinkSync(join(raiz, 'node_modules'), join(dist, 'node_modules'), 'dir');
// Parámetros de Functions: `firebase deploy` los lee de `dist/funciones/.env*` DESPUÉS de este predeploy, y este
// script borra `dist/funciones/` al empezar. El CI escribe el archivo y lo señala con FUNCIONES_PARAMETROS; aquí se
// copia al final para que llegue al despliegue. Sin la variable no se copia nada (emulador y desarrollo local).
const parametros = process.env['FUNCIONES_PARAMETROS'];
if (parametros) {
  if (!existsSync(parametros)) throw new Error(`FUNCIONES_PARAMETROS apunta a un archivo inexistente: ${parametros}`);
  copyFileSync(parametros, join(dist, '.env'));
  console.log('empaquetar: parámetros de Functions copiados a dist/funciones/.env');
}
console.log(`empaquetar: ${'dist/funciones/index.js'}, package.json y package-lock.json escritos`);
