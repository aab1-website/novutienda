/** Texto comparable para buscar: sin tildes, sin mayúsculas y con los espacios de los bordes recortados. Función pura. */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}
