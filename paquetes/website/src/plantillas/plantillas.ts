/**
 * Plantillas de color: lista CERRADA de 5 identificadores, cada una con tokens para el
 * tema claro y el oscuro. Todo color es hexadecimal de 6 dígitos para poder medir el
 * contraste (`verificarPlantilla`): ningún par de texto puede bajar de AA (4,5:1).
 * La plantilla activa es una elección del sitio (`ConfigSitio.plantilla`), nunca texto libre.
 */
import { IDS_PLANTILLA, type IdPlantilla } from '../contenido/tipos.js';
import { contraste, MINIMO_AA } from './contraste.js';

export interface TokensTema {
  readonly fondo: string;
  readonly seccion: string;
  readonly superficie: string;
  readonly superficie2: string;
  readonly texto: string;
  readonly textoSuave: string;
  /** Acento usado también como color de texto (enlaces, etiquetas). */
  readonly acento: string;
  readonly cta: string;
  readonly ctaTexto: string;
  readonly ctaHover: string;
  readonly borde: string;
  /** Borde de controles de formulario: contraste mínimo 3:1 (WCAG 1.4.11). */
  readonly bordeControl: string;
  readonly peligro: string;
}

export interface Plantilla {
  readonly id: IdPlantilla;
  readonly nombre: string;
  readonly claro: TokensTema;
  readonly oscuro: TokensTema;
}

const BORDE_CONTROL = { claro: '#6b7280', oscuro: '#8a93a3' } as const;

export const PLANTILLAS: Readonly<Record<IdPlantilla, Plantilla>> = {
  // Plantilla 1: la del diseño aprobado (acento #0077b3 en claro, cian en oscuro).
  cielo: {
    id: 'cielo', nombre: 'Cielo',
    claro: { fondo: '#f4f6f9', seccion: '#f7f9fc', superficie: '#ffffff', superficie2: '#f8fafc', texto: '#0f172a', textoSuave: '#4b5563', acento: '#0077b3', cta: '#0077b3', ctaTexto: '#ffffff', ctaHover: '#006a9f', borde: '#d5dce6', bordeControl: BORDE_CONTROL.claro, peligro: '#b91c1c' },
    oscuro: { fondo: '#000000', seccion: '#06121a', superficie: '#0a0a0a', superficie2: '#111318', texto: '#ffffff', textoSuave: '#a1a9b5', acento: '#00d9ff', cta: '#00d9ff', ctaTexto: '#000000', ctaHover: '#00b8d4', borde: '#2a2f38', bordeControl: BORDE_CONTROL.oscuro, peligro: '#f87171' },
  },
  bosque: {
    id: 'bosque', nombre: 'Bosque',
    claro: { fondo: '#f3f7f4', seccion: '#f6faf7', superficie: '#ffffff', superficie2: '#f7faf8', texto: '#10231a', textoSuave: '#40524a', acento: '#1b7a49', cta: '#1b7a49', ctaTexto: '#ffffff', ctaHover: '#16663c', borde: '#d3e0d8', bordeControl: BORDE_CONTROL.claro, peligro: '#b91c1c' },
    oscuro: { fondo: '#050a07', seccion: '#08140d', superficie: '#0b1510', superficie2: '#101c15', texto: '#f3faf5', textoSuave: '#a3b5aa', acento: '#4ade80', cta: '#4ade80', ctaTexto: '#04210f', ctaHover: '#22c55e', borde: '#223a2c', bordeControl: BORDE_CONTROL.oscuro, peligro: '#f87171' },
  },
  ambar: {
    id: 'ambar', nombre: 'Ámbar',
    claro: { fondo: '#faf6f0', seccion: '#fcf9f4', superficie: '#ffffff', superficie2: '#fbf8f3', texto: '#261a0c', textoSuave: '#5a4a38', acento: '#a84f00', cta: '#a84f00', ctaTexto: '#ffffff', ctaHover: '#8f4200', borde: '#e6dccd', bordeControl: BORDE_CONTROL.claro, peligro: '#b91c1c' },
    oscuro: { fondo: '#0a0703', seccion: '#150e05', superficie: '#120c05', superficie2: '#1b1308', texto: '#fff8ee', textoSuave: '#bfae98', acento: '#ffb347', cta: '#ffb347', ctaTexto: '#1f1200', ctaHover: '#f59e0b', borde: '#3a2a14', bordeControl: BORDE_CONTROL.oscuro, peligro: '#f87171' },
  },
  grafito: {
    id: 'grafito', nombre: 'Grafito',
    claro: { fondo: '#f3f4f6', seccion: '#f7f8f9', superficie: '#ffffff', superficie2: '#f8f9fa', texto: '#111827', textoSuave: '#4b5563', acento: '#374151', cta: '#1f2937', ctaTexto: '#ffffff', ctaHover: '#111827', borde: '#d7dbe0', bordeControl: BORDE_CONTROL.claro, peligro: '#b91c1c' },
    oscuro: { fondo: '#0b0c0e', seccion: '#111317', superficie: '#14161a', superficie2: '#1a1d22', texto: '#f9fafb', textoSuave: '#a7adb7', acento: '#d1d5db', cta: '#e5e7eb', ctaTexto: '#111827', ctaHover: '#d1d5db', borde: '#2d3138', bordeControl: BORDE_CONTROL.oscuro, peligro: '#f87171' },
  },
  ciruela: {
    id: 'ciruela', nombre: 'Ciruela',
    claro: { fondo: '#f8f4f9', seccion: '#faf7fb', superficie: '#ffffff', superficie2: '#faf6fb', texto: '#2a1230', textoSuave: '#5b4562', acento: '#8f2a8a', cta: '#8f2a8a', ctaTexto: '#ffffff', ctaHover: '#771f72', borde: '#e3d8e6', bordeControl: BORDE_CONTROL.claro, peligro: '#b91c1c' },
    oscuro: { fondo: '#09040b', seccion: '#12081a', superficie: '#10061a', superficie2: '#190b25', texto: '#fbf3fd', textoSuave: '#b9a6c1', acento: '#e879f9', cta: '#e879f9', ctaTexto: '#2a0630', ctaHover: '#d946ef', borde: '#3a2145', bordeControl: BORDE_CONTROL.oscuro, peligro: '#f87171' },
  },
};

export const esIdPlantilla = (x: unknown): x is IdPlantilla => IDS_PLANTILLA.includes(x as IdPlantilla);

export interface FalloContraste {
  readonly plantilla: IdPlantilla;
  readonly tema: 'claro' | 'oscuro';
  readonly par: string;
  readonly relacion: number;
  readonly minimo: number;
}

const FONDOS = ['fondo', 'seccion', 'superficie', 'superficie2'] as const;
/** Color fijo del héroe (imagen oscura con degradado negro): el acento del tema oscuro va encima. */
export const FONDO_HEROE = '#000000';

/** Devuelve los pares que no cumplen AA (texto) o 3:1 (controles). Vacío = la plantilla cumple. */
export function verificarPlantilla(p: Plantilla): readonly FalloContraste[] {
  const fallos: FalloContraste[] = [];
  const medir = (tema: 'claro' | 'oscuro', par: string, a: string, b: string, minimo: number): void => {
    const relacion = contraste(a, b);
    if (relacion < minimo) fallos.push({ plantilla: p.id, tema, par, relacion, minimo });
  };
  for (const tema of ['claro', 'oscuro'] as const) {
    const t = p[tema];
    for (const f of FONDOS) {
      medir(tema, `texto/${f}`, t.texto, t[f], MINIMO_AA);
      medir(tema, `textoSuave/${f}`, t.textoSuave, t[f], MINIMO_AA);
      medir(tema, `acento/${f}`, t.acento, t[f], MINIMO_AA);
    }
    medir(tema, 'ctaTexto/cta', t.ctaTexto, t.cta, MINIMO_AA);
    medir(tema, 'ctaTexto/ctaHover', t.ctaTexto, t.ctaHover, MINIMO_AA);
    medir(tema, 'peligro/fondo', t.peligro, t.fondo, MINIMO_AA);
    medir(tema, 'peligro/superficie', t.peligro, t.superficie, MINIMO_AA);
    medir(tema, 'bordeControl/fondo', t.bordeControl, t.fondo, 3);
    medir(tema, 'bordeControl/superficie', t.bordeControl, t.superficie, 3);
  }
  medir('oscuro', 'acento/heroe', p.oscuro.acento, FONDO_HEROE, MINIMO_AA);
  return fallos;
}
