import { useEffect, useRef } from 'preact/hooks';
import type { Moneda } from '@novutienda/nucleo';
import { formatearMonto } from '../lib/dinero.js';

interface Props {
  min: number;
  max: number;
  paso: number;
  bajo: number;
  alto: number;
  moneda: Moneda;
  onCambio(bajo: number, alto: number): void;
}

export const textoPrecio = (v: number, moneda: Moneda): string => formatearMonto(Math.round(v * 100), moneda);

/** Deslizante de dos puntas: dos controles `range` nativos (teclado, flechas, Inicio y Fin) sobre una misma pista. */
export function Deslizante({ min, max, paso, bajo, alto, moneda, onCambio }: Props) {
  const pct = (v: number): number => ((v - min) / (max - min)) * 100;
  const raiz = useRef<HTMLDivElement>(null);
  // La CSP no admite estilos en línea: las variables se ponen por CSSOM.
  useEffect(() => {
    raiz.current?.style.setProperty('--desde', `${pct(bajo)}%`);
    raiz.current?.style.setProperty('--hasta', `${pct(alto)}%`);
  }, [bajo, alto, min, max]);
  return (
    <div class={bajo >= max - paso ? 'deslizante deslizante-bajo-arriba' : 'deslizante'} ref={raiz}>
      <div class="deslizante-pista" aria-hidden="true"><span /></div>
      <input
        type="range" class="deslizante-bajo" aria-label="Precio mínimo" min={min} max={max} step={paso} value={bajo}
        aria-valuetext={`Desde ${textoPrecio(bajo, moneda)} ${moneda}`}
        onInput={(e) => onCambio(Math.min(Number((e.target as HTMLInputElement).value), alto), alto)}
      />
      <input
        type="range" class="deslizante-alto" aria-label="Precio máximo" min={min} max={max} step={paso} value={alto}
        aria-valuetext={`Hasta ${textoPrecio(alto, moneda)} ${moneda}`}
        onInput={(e) => onCambio(bajo, Math.max(Number((e.target as HTMLInputElement).value), bajo))}
      />
    </div>
  );
}
