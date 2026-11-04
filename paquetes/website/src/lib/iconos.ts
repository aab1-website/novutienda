/**
 * Íconos del sitio (trazos de 24x24, estilo Lucide, licencia ISC). Lista cerrada: el contenido
 * solo puede elegir por identificador (`IdIcono`); nunca inyecta SVG propio.
 */
import type { IdIcono } from '../contenido/tipos.js';

export type Trazo = readonly [forma: 'path' | 'circle' | 'rect', atributos: Readonly<Record<string, string | number>>];

export const ICONOS_UI = [
  'buscar', 'carrito', 'chevron', 'chevron-abajo', 'destello', 'x', 'basura', 'menos', 'mas', 'bolsa', 'prohibido',
  'sol', 'luna', 'flecha-arriba', 'chat', 'enviar', 'etiqueta', 'play', 'anterior', 'siguiente', 'pausa',
] as const;
export type IdIconoUi = (typeof ICONOS_UI)[number];
export type NombreIcono = IdIcono | IdIconoUi;

export const TRAZOS: Readonly<Record<NombreIcono, readonly Trazo[]>> = {
  parlante: [['rect', { x: 4, y: 2, width: 16, height: 20, rx: 2 }], ['path', { d: 'M12 6h.01' }], ['circle', { cx: 12, cy: 14, r: 4 }], ['path', { d: 'M12 14h.01' }]],
  microondas: [['rect', { x: 2, y: 4, width: 20, height: 15, rx: 2 }], ['rect', { x: 6, y: 8, width: 8, height: 7, rx: 1 }], ['path', { d: 'M18 8v7M6 19v2M18 19v2' }]],
  televisor: [['rect', { x: 2, y: 7, width: 20, height: 15, rx: 2 }], ['path', { d: 'm17 2-5 5-5-5' }]],
  lavadora: [['rect', { x: 3, y: 2, width: 18, height: 20, rx: 2 }], ['circle', { cx: 12, cy: 14, r: 5 }], ['path', { d: 'M7 6h.01M11 6h.01' }]],
  aire: [['path', { d: 'M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2M9.6 4.6A2 2 0 1 1 11 8H2m10.6 11.4A2 2 0 1 0 14 16H2' }]],
  congelador: [['path', { d: 'M12 2v20M4.9 6.5l14.2 11M19.1 6.5 4.9 17.5M9 3l3 2 3-2M9 21l3-2 3 2' }]],
  heladera: [['path', { d: 'M5 6a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z' }], ['path', { d: 'M5 10h14M15 7v6' }]],
  cuadricula: [['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }], ['path', { d: 'M3 9h18M3 15h18M9 3v18M15 3v18' }]],
  escudo: [['path', { d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' }], ['path', { d: 'm9 12 2 2 4-4' }]],
  camion: [['path', { d: 'M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2m10 0H9m10 0h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14' }], ['circle', { cx: 17, cy: 18, r: 2 }], ['circle', { cx: 7, cy: 18, r: 2 }]],
  mensaje: [['path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }]],
  tendencia: [['path', { d: 'M22 7 13.5 15.5 8.5 10.5 2 17' }], ['path', { d: 'M16 7h6v6' }]],
  usuario: [['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }], ['circle', { cx: 9, cy: 7, r: 4 }], ['path', { d: 'm16 11 2 2 4-4' }]],
  check: [['circle', { cx: 12, cy: 12, r: 10 }], ['path', { d: 'm9 12 2 2 4-4' }]],
  pin: [['path', { d: 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0' }], ['circle', { cx: 12, cy: 10, r: 3 }]],
  telefono: [['path', { d: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z' }]],
  actualizar: [['path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5' }]],
  buscar: [['circle', { cx: 11, cy: 11, r: 8 }], ['path', { d: 'm21 21-4.3-4.3' }]],
  carrito: [['circle', { cx: 8, cy: 21, r: 1 }], ['circle', { cx: 19, cy: 21, r: 1 }], ['path', { d: 'M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12' }]],
  chevron: [['path', { d: 'm9 18 6-6-6-6' }]],
  'chevron-abajo': [['path', { d: 'm6 9 6 6 6-6' }]],
  destello: [['path', { d: 'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z' }]],
  x: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
  basura: [['path', { d: 'M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' }]],
  menos: [['path', { d: 'M5 12h14' }]],
  mas: [['path', { d: 'M5 12h14M12 5v14' }]],
  bolsa: [['path', { d: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z' }], ['path', { d: 'M3 6h18M16 10a4 4 0 0 1-8 0' }]],
  prohibido: [['circle', { cx: 12, cy: 12, r: 10 }], ['path', { d: 'm4.9 4.9 14.2 14.2' }]],
  sol: [['circle', { cx: 12, cy: 12, r: 4 }], ['path', { d: 'M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41' }]],
  luna: [['path', { d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' }]],
  'flecha-arriba': [['path', { d: 'm5 12 7-7 7 7M12 19V5' }]],
  chat: [['path', { d: 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z' }]],
  enviar: [['path', { d: 'm22 2-7 20-4-9-9-4ZM22 2 11 13' }]],
  etiqueta: [['path', { d: 'M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z' }], ['circle', { cx: 7.5, cy: 7.5, r: 0.5 }]],
  play: [['path', { d: 'M6 3l14 9-14 9Z' }]],
  anterior: [['path', { d: 'm15 18-6-6 6-6' }]],
  siguiente: [['path', { d: 'm9 18 6-6-6-6' }]],
  pausa: [['rect', { x: 6, y: 4, width: 4, height: 16, rx: 1 }], ['rect', { x: 14, y: 4, width: 4, height: 16, rx: 1 }]],
};

export const trazosDe = (nombre: string): readonly Trazo[] => (nombre in TRAZOS ? TRAZOS[nombre as NombreIcono] : TRAZOS.cuadricula);
