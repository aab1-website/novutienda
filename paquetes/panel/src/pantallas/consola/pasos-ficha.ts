import type { FichaWeb } from '../../api/tipos.js';

/**
 * Pasos para que un producto tenga su página lista en el sitio, calculados solo con lo que el panel ya sabe de la
 * ficha (página, descripción, fotos y estado). El panel no sabe si el sitio ya se publicó con ese producto: por eso
 * nada de aquí afirma que «ya salió en el sitio».
 */

export type IdPaso = 'pagina' | 'descripcion' | 'fotos' | 'visible';
/** Qué parte del panel de la ficha abre el paso: los textos o la zona de fotos y video. */
export type ModoPaso = 'datos' | 'medios';

export interface PasoFicha {
  readonly id: IdPaso;
  /** Lo que falta, en una palabra: «página», «descripción»… */
  readonly falta: string;
  readonly hecho: boolean;
  /** Texto del botón del siguiente paso. */
  readonly accion: string;
  readonly modo: ModoPaso;
}

export function pasosDeFicha(ficha: FichaWeb | undefined): readonly PasoFicha[] {
  return [
    { id: 'pagina', falta: 'página', hecho: ficha !== undefined, accion: 'Preparar para el sitio', modo: 'datos' },
    { id: 'descripcion', falta: 'descripción', hecho: ficha !== undefined && ficha.descripcion.trim() !== '', accion: 'Escribir la descripción', modo: 'datos' },
    { id: 'fotos', falta: 'foto', hecho: ficha !== undefined && ficha.medios.length > 0, accion: 'Subir fotos', modo: 'medios' },
    { id: 'visible', falta: 'elegir «Visible en el sitio»', hecho: ficha?.estado === 'publicado', accion: 'Mostrar en el sitio', modo: 'datos' },
  ];
}

export function pasosPendientes(ficha: FichaWeb | undefined): readonly PasoFicha[] {
  return pasosDeFicha(ficha).filter((p) => !p.hecho);
}

/** El primer paso que falta, o `null` si la página está completa. */
export function siguientePaso(ficha: FichaWeb | undefined): PasoFicha | null {
  return pasosPendientes(ficha)[0] ?? null;
}

/** «Qué falta» como texto: «Aún no está en el sitio» (sin página), «Falta: descripción, foto» o «Completa». */
export function textoQueFalta(ficha: FichaWeb | undefined): string {
  if (ficha === undefined) return 'Aún no está en el sitio';
  const p = pasosPendientes(ficha);
  return p.length === 0 ? 'Completa' : `Falta: ${p.map((x) => x.falta).join(', ')}`;
}

export type FiltroFicha = 'sin-pagina' | 'borrador' | 'sin-fotos';

export function cumpleFiltro(ficha: FichaWeb | undefined, filtro: string): boolean {
  switch (filtro as FiltroFicha) {
    case 'sin-pagina': return ficha === undefined;
    case 'borrador': return ficha?.estado === 'borrador';
    case 'sin-fotos': return ficha === undefined || ficha.medios.length === 0;
    default: return true;
  }
}

export function textoCambiosSinPublicar(n: number): string {
  return n === 1 ? '1 cambio sin publicar' : `${String(n)} cambios sin publicar`;
}
