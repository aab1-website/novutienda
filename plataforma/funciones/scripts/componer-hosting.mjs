// Compone las cabeceras de los dos sitios: la CSP del sitio estático se SELLA en cada build (hashes de los scripts en
// línea) y queda en `dist/website/_cabeceras.json`; la del panel la define su build (`paquetes/panel/scripts/sellar.mjs`)
// y queda en `dist/panel/_cabeceras.json`. Este script copia cada una a la regla `**` de su sitio de Hosting en
// `firebase.json`. Sin sello, el despliegue conserva la CSP estricta base de `firebase.json`.
//
// Uso:  node plataforma/funciones/scripts/componer-hosting.mjs [--firebase firebase.json] [--cabeceras dist/website/_cabeceras.json]
//         [--cabeceras-panel dist/panel/_cabeceras.json] [--salida ruta]
// Sin --salida reescribe `firebase.json` en el área de trabajo (en CI es efímera; nada se versiona).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

function argumento(nombre, defecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : defecto;
}

function reglaSellada(cabeceras, nombre) {
  if (!Array.isArray(cabeceras) || cabeceras.length !== 1 || cabeceras[0]?.source !== '**' || !Array.isArray(cabeceras[0].headers)) {
    throw new Error(`${nombre}: _cabeceras.json debe contener exactamente una regla con source "**"`);
  }
  const sellado = cabeceras[0].headers;
  if (!sellado.some((h) => h.key === 'Content-Security-Policy' && typeof h.value === 'string' && h.value !== '')) {
    throw new Error(`${nombre}: _cabeceras.json no trae Content-Security-Policy`);
  }
  return sellado;
}

function sustituir(copia, target, sellado) {
  const sitio = copia.hosting.find((h) => h.target === target);
  if (sitio === undefined) throw new Error(`firebase.json no tiene el sitio de Hosting "${target}"`);
  const regla = sitio.headers.find((h) => h.source === '**');
  if (regla === undefined) throw new Error(`el sitio "${target}" no tiene la regla de cabeceras "**"`);
  regla.headers = sellado;
}

/** Sustituye la regla `**` del sitio (y, si se da, la del panel) por las cabeceras selladas en cada build. */
export function componer(firebase, cabecerasSitio, cabecerasPanel) {
  const sitio = reglaSellada(cabecerasSitio, 'sitio');
  const panel = cabecerasPanel === undefined ? undefined : reglaSellada(cabecerasPanel, 'panel');
  const copia = structuredClone(firebase);
  sustituir(copia, 'sitio', sitio);
  if (panel !== undefined) sustituir(copia, 'panel', panel);
  return copia;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rutaFirebase = argumento('firebase', 'firebase.json');
  const rutaCabeceras = argumento('cabeceras', 'dist/website/_cabeceras.json');
  const rutaPanel = argumento('cabeceras-panel', 'dist/panel/_cabeceras.json');
  for (const [ruta, que] of [[rutaCabeceras, 'el sitio (pnpm --filter @novutienda/website build)'], [rutaPanel, 'el panel (pnpm --filter @novutienda/panel build)']]) {
    if (!existsSync(ruta)) {
      console.error(`componer-hosting: falta ${ruta}; compile antes ${que}.`);
      process.exit(1);
    }
  }
  const resultado = componer(JSON.parse(readFileSync(rutaFirebase, 'utf8')), JSON.parse(readFileSync(rutaCabeceras, 'utf8')), JSON.parse(readFileSync(rutaPanel, 'utf8')));
  writeFileSync(argumento('salida', rutaFirebase), `${JSON.stringify(resultado, null, 2)}\n`);
  console.log('componer-hosting: cabeceras selladas del sitio y del panel incorporadas.');
}
