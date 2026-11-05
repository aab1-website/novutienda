// Servidor estático de pruebas: sirve dist/panel-humo con las cabeceras selladas (_cabeceras.json), igual que lo hará el
// alojamiento. Es la versión compilada con los dobles en memoria (modo `humo`), no la que va a producción.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// `DIR_PANEL`: carpeta bajo dist/ a servir (por omisión la compilación con dobles; `panel-emulador` para el emulador).
const RAIZ = resolve(fileURLToPath(new URL(`../../../dist/${process.env.DIR_PANEL ?? 'panel-humo'}`, import.meta.url)));
const PUERTO = Number(process.env.PUERTO_HUMO ?? 4341);
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

if (!existsSync(join(RAIZ, '_cabeceras.json'))) {
  console.error('Falta _cabeceras.json en la carpeta de dist/ a servir: compile antes con `pnpm run build:humo` o `build:emulador`.');
  process.exit(1);
}
const cabeceras = Object.fromEntries(JSON.parse(readFileSync(join(RAIZ, '_cabeceras.json'), 'utf8'))[0].headers.map((h) => [h.key, h.value]));

function archivoPara(ruta) {
  const limpia = normalize(decodeURIComponent(ruta)).replace(/^(\.\.[/\\])+/, '');
  const abs = join(RAIZ, limpia === '/' || limpia === '.' ? 'index.html' : limpia);
  return abs.startsWith(RAIZ) && existsSync(abs) && statSync(abs).isFile() && !abs.endsWith('_cabeceras.json') ? abs : null;
}

createServer((req, res) => {
  const ruta = new URL(req.url ?? '/', 'http://x').pathname;
  const archivo = archivoPara(ruta);
  if (archivo === null) {
    res.writeHead(404, { ...cabeceras, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
    return;
  }
  res.writeHead(200, { ...cabeceras, 'Content-Type': TIPOS[extname(archivo)] ?? 'application/octet-stream' });
  res.end(readFileSync(archivo));
}).listen(PUERTO, '127.0.0.1', () => console.log(`Servidor de pruebas en http://127.0.0.1:${PUERTO}`));
