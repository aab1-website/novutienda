/**
 * Genera la hoja de estilos de las plantillas: variables `--cb-*` por plantilla y tema.
 * El tema sigue al dispositivo por defecto; el atributo `data-tema` (claro u oscuro) lo fuerza.
 * Se publica como archivo propio (`/plantillas.css`) para que la CSP no necesite estilos en línea.
 */
import { IDS_PLANTILLA } from '../contenido/tipos.js';
import { PLANTILLAS, type TokensTema } from './plantillas.js';

const NOMBRE_VAR: Readonly<Record<keyof TokensTema, string>> = {
  fondo: '--cb-fondo', seccion: '--cb-seccion', superficie: '--cb-superficie', superficie2: '--cb-superficie-2',
  texto: '--cb-texto', textoSuave: '--cb-texto-suave', acento: '--cb-acento', cta: '--cb-cta', ctaTexto: '--cb-cta-texto',
  ctaHover: '--cb-cta-hover', borde: '--cb-borde', bordeControl: '--cb-borde-control', peligro: '--cb-peligro',
};

const declaraciones = (t: TokensTema): string =>
  (Object.keys(NOMBRE_VAR) as (keyof TokensTema)[]).map((k) => `${NOMBRE_VAR[k]}:${t[k]};`).join('');

export function cssPlantillas(): string {
  const partes: string[] = [];
  for (const id of IDS_PLANTILLA) {
    const p = PLANTILLAS[id];
    const sel = `html[data-plantilla="${id}"]`;
    partes.push(`${sel}{color-scheme:light;${declaraciones(p.claro)}--cb-acento-heroe:${p.oscuro.acento};}`);
    partes.push(`@media (prefers-color-scheme:dark){${sel}:not([data-tema="claro"]){color-scheme:dark;${declaraciones(p.oscuro)}}}`);
    partes.push(`${sel}[data-tema="oscuro"]{color-scheme:dark;${declaraciones(p.oscuro)}}`);
    partes.push(`${sel}[data-tema="claro"]{color-scheme:light;${declaraciones(p.claro)}}`);
  }
  return `${partes.join('\n')}\n`;
}
