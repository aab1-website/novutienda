/** Lista cerrada de plantillas de color. Cada una trae tokens claro y oscuro (los define el sitio). */
export const PLANTILLAS = ['cielo', 'bosque', 'ambar', 'grafito', 'ciruela'] as const;
export type PlantillaId = (typeof PLANTILLAS)[number];

export const esPlantilla = (x: unknown): x is PlantillaId => typeof x === 'string' && (PLANTILLAS as readonly string[]).includes(x);
