// Paleta de la VISTA PREVIA APROXIMADA de las 5 plantillas del sitio. Los valores se copiaron de
// paquetes/website/src/plantillas/plantillas.ts (solo lectura; las fronteras prohíben importarlo): `fondo`, `superficie`,
// `texto`, `acento` y `cta` de cada tema. La plantilla 1 del sitio aprobado («cielo») es la identidad visual del panel.
// Los identificadores son los mismos en el sitio, la consola y el panel (unificados el 04/11/2026).
import type { PlantillaSitio } from '../../api/tipos.js';

export interface PaletaVista {
  readonly nombre: string;
  /** Plantilla del sitio de la que sale la paleta (posición equivalente). */
  readonly origenSitio: string;
}

export const PALETAS: Readonly<Record<PlantillaSitio, PaletaVista>> = {
  cielo: { nombre: 'Cielo', origenSitio: 'cielo' },
  bosque: { nombre: 'Bosque', origenSitio: 'bosque' },
  ambar: { nombre: 'Ámbar', origenSitio: 'ambar' },
  grafito: { nombre: 'Grafito', origenSitio: 'grafito' },
  ciruela: { nombre: 'Ciruela', origenSitio: 'ciruela' },
};
