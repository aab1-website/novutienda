/** Lista cerrada de plantillas de color. Cada una trae tokens claro y oscuro (los define el sitio). */
export const PLANTILLAS = ['cielo', 'bosque', 'ambar', 'grafito', 'ciruela'] as const;
export type PlantillaId = (typeof PLANTILLAS)[number];

/** Nombre visible de cada plantilla (el que ve la persona en el panel). */
export const NOMBRE_PLANTILLA: Readonly<Record<PlantillaId, string>> = { cielo: 'Cielo', bosque: 'Bosque', ambar: 'Ámbar', grafito: 'Grafito', ciruela: 'Ciruela' };

export const esPlantilla = (x: unknown): x is PlantillaId => typeof x === 'string' && (PLANTILLAS as readonly string[]).includes(x);
