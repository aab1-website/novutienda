import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Config de Playwright: aquí la ruta relativa es del propio paquete.
/* eslint-disable no-restricted-imports */
import { contenidoEjemplo } from '../src/contenido/ejemplo.ts';
/* eslint-enable no-restricted-imports */

/** Productos del contenido de prueba: más de 24 para que el catálogo, las categorías y las marcas tengan varias páginas. */
const PRODUCTOS_DE_PRUEBA = 41;

/** Se ejecuta antes del servidor (`node paginas-preparar.mts`). Compila el sitio con 41 productos (los del ejemplo repetidos con otro id) en `dist/prueba-paginas`, en el mismo disco. */
function preparar(): void {
  const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const destino = resolve(raiz, 'dist/prueba-paginas');
  const archivo = resolve(raiz, 'dist/prueba-paginas-contenido.json');
  const base = contenidoEjemplo.productos;
  const productos = Array.from({ length: PRODUCTOS_DE_PRUEBA }, (_, i) => {
    const b = base[i % base.length]!;
    return i < base.length ? b : { ...b, id: `${b.id}-x${i}`, slug: `${b.slug}-x${i}`, destacado: false, disponible: true };
  });
  mkdirSync(resolve(raiz, 'dist'), { recursive: true });
  writeFileSync(archivo, JSON.stringify({ ...contenidoEjemplo, config: { ...contenidoEjemplo.config, mapa: 'https://maps.app.goo.gl/AbC123' }, productos }));
  rmSync(destino, { recursive: true, force: true });
  execFileSync('pnpm', ['--filter', '@novutienda/website', 'run', 'build'], {
    cwd: raiz,
    stdio: 'inherit',
    env: { ...process.env, SITIO_OUT_DIR: destino, SITIO_CONTENIDO: archivo, APP_ENV: 'staging', MEDIOS_BASE_URL: 'https://medios.invalid' },
  });
}

preparar();
