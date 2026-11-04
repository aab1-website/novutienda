// Servidor estático de pruebas: sirve dist/website con las cabeceras selladas (_cabeceras.json),
// igual que lo hará el alojamiento, y traduce las URL limpias (/productos -> productos.html).
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(fileURLToPath(new URL('../../../dist/website', import.meta.url)));
const PUERTO = Number(process.env.PUERTO_HUMO ?? 4331);
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

if (!existsSync(join(RAIZ, '_cabeceras.json'))) {
  console.error('Falta dist/website/_cabeceras.json: compila antes el sitio (astro build).');
  process.exit(1);
}
const cabeceras = Object.fromEntries(JSON.parse(readFileSync(join(RAIZ, '_cabeceras.json'), 'utf8'))[0].headers.map((h) => [h.key, h.value]));

function archivoPara(ruta) {
  const limpia = normalize(decodeURIComponent(ruta)).replace(/^(\.\.[/\\])+/, '');
  for (const c of [limpia, `${limpia}.html`, join(limpia, 'index.html')]) {
    const abs = join(RAIZ, c);
    if (abs.startsWith(RAIZ) && existsSync(abs) && statSync(abs).isFile() && !abs.endsWith('_cabeceras.json')) return abs;
  }
  return null;
}

createServer((req, res) => {
  const ruta = new URL(req.url ?? '/', 'http://x').pathname;
  let archivo = archivoPara(ruta);
  let estado = 200;
  if (archivo === null) {
    archivo = join(RAIZ, '404.html');
    estado = 404;
  }
  res.writeHead(estado, { ...cabeceras, 'Content-Type': TIPOS[extname(archivo)] ?? 'application/octet-stream' });
  res.end(readFileSync(archivo));
}).listen(PUERTO, '127.0.0.1', () => console.log(`Servidor de pruebas en http://127.0.0.1:${PUERTO}`));
