// Compone las cabeceras del sitio: la CSP del sitio estático se SELLA en cada build (hashes de los scripts en
// línea) y queda en `dist/website/_cabeceras.json`; este script la copia a la regla `**` del sitio de Hosting en
// `firebase.json`. Sin sello, el despliegue conserva la CSP estricta base de `firebase.json`.
//
// Uso:  node plataforma/funciones/scripts/componer-hosting.mjs [--firebase firebase.json] [--cabeceras dist/website/_cabeceras.json] [--salida ruta]
// Sin --salida reescribe `firebase.json` en el área de trabajo (en CI es efímera; nada se versiona).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

function argumento(nombre, defecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : defecto;
}

export function componer(firebase, cabeceras) {
  if (!Array.isArray(cabeceras) || cabeceras.length !== 1 || cabeceras[0]?.source !== '**' || !Array.isArray(cabeceras[0].headers)) {
    throw new Error('_cabeceras.json debe contener exactamente una regla con source "**"');
  }
  const sellado = cabeceras[0].headers;
  if (!sellado.some((h) => h.key === 'Content-Security-Policy' && typeof h.value === 'string' && h.value !== '')) {
    throw new Error('_cabeceras.json no trae Content-Security-Policy');
  }
  const copia = structuredClone(firebase);
  const sitio = copia.hosting.find((h) => h.target === 'sitio');
  if (sitio === undefined) throw new Error('firebase.json no tiene el sitio de Hosting "sitio"');
  const regla = sitio.headers.find((h) => h.source === '**');
  if (regla === undefined) throw new Error('el sitio no tiene la regla de cabeceras "**"');
  regla.headers = sellado;
  return copia;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rutaFirebase = argumento('firebase', 'firebase.json');
  const rutaCabeceras = argumento('cabeceras', 'dist/website/_cabeceras.json');
  if (!existsSync(rutaCabeceras)) {
    console.error(`componer-hosting: falta ${rutaCabeceras}; compile el sitio antes (pnpm --filter @novutienda/website build).`);
    process.exit(1);
  }
  const resultado = componer(JSON.parse(readFileSync(rutaFirebase, 'utf8')), JSON.parse(readFileSync(rutaCabeceras, 'utf8')));
  writeFileSync(argumento('salida', rutaFirebase), `${JSON.stringify(resultado, null, 2)}\n`);
  console.log('componer-hosting: cabeceras selladas del sitio incorporadas.');
}
