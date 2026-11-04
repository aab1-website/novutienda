/** Integración de Astro: al terminar el build verifica el `dist/` y sella la CSP. Falla el build si hay problemas. */
import { fileURLToPath } from 'node:url';
import { verificarDist, sellarDist, type OpcionesSellado } from '../seguridad/sellar.js';

export function integracionSellarCsp(opciones: OpcionesSellado & { readonly hostsPermitidos?: readonly string[] }): {
  readonly name: string;
  readonly hooks: { readonly 'astro:build:done': (args: { dir: URL }) => void };
} {
  return {
    name: 'sellar-csp',
    hooks: {
      'astro:build:done': ({ dir }) => {
        const ruta = fileURLToPath(dir);
        const problemas = verificarDist(ruta, opciones.hostsPermitidos ?? []);
        if (problemas.length > 0) {
          throw new Error(`El sitio incumple la CSP o las prohibiciones:\n - ${problemas.map((p) => `${p.archivo}: ${p.motivo}`).join('\n - ')}`);
        }
        sellarDist(ruta, opciones);
      },
    },
  };
}
