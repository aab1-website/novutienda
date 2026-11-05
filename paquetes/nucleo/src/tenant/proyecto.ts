/**
 * Proyecto Firebase activo. Sale siempre de la configuración del entorno
 * (variable `FIREBASE_PROJECT_ID`), nunca del código ni del repositorio.
 */
export function proyectoFirebase(env: Readonly<Record<string, string | undefined>>): string {
  const id = env['FIREBASE_PROJECT_ID'];
  if (id === undefined || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(id)) {
    throw new Error('Falta FIREBASE_PROJECT_ID o no es un identificador de proyecto válido');
  }
  return id;
}
