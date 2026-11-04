// Paleta de la VISTA PREVIA APROXIMADA de las 5 plantillas del sitio. Los valores se copiaron de
// paquetes/website/src/plantillas/plantillas.ts (solo lectura; las fronteras prohíben importarlo): `fondo`, `superficie`,
// `texto`, `acento` y `cta` de cada tema. La plantilla 1 del sitio aprobado («cielo») es la identidad visual del panel.
//
// PENDIENTE DE RECONCILIAR: la consola valida los identificadores marfil, oceano, bosque, terracota y grafito
// (paquetes/consola/src/plantillas.ts) y el sitio usa cielo, bosque, ambar, grafito y ciruela. Mientras no se unifiquen,
// el panel envía a la consola sus identificadores y dibuja la paleta del sitio que ocupa la MISMA POSICIÓN en la lista.
import type { PlantillaSitio } from '../api/tipos.js';

export interface PaletaVista {
  readonly nombre: string;
  /** Plantilla del sitio de la que sale la paleta (posición equivalente). */
  readonly origenSitio: string;
}

export const PALETAS: Readonly<Record<PlantillaSitio, PaletaVista>> = {
  marfil: { nombre: 'Marfil', origenSitio: 'cielo' },
  oceano: { nombre: 'Océano', origenSitio: 'bosque' },
  bosque: { nombre: 'Bosque', origenSitio: 'ambar' },
  terracota: { nombre: 'Terracota', origenSitio: 'grafito' },
  grafito: { nombre: 'Grafito', origenSitio: 'ciruela' },
};
