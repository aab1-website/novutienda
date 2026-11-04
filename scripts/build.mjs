// Construcción mínima: genera dist/ con una página y la sonda de salud.
// Acepta (e ignora) argumentos como `--mode <ambiente>` que pasa el CI.
import { mkdir, writeFile } from 'node:fs/promises';

const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Plataforma</title>
  </head>
  <body>
    <p>Plataforma en construcción.</p>
  </body>
</html>
`;

await mkdir('dist', { recursive: true });
await writeFile('dist/index.html', html);
await writeFile('dist/healthz', 'ok');
console.log('build: dist/index.html y dist/healthz escritos');
