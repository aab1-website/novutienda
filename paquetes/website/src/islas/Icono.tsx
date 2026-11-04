import { trazosDe } from '../lib/iconos.js';

interface Props {
  nombre: string;
  tamano?: number;
  grosor?: number;
}

/** Ícono decorativo (oculto para lectores de pantalla): el texto o `aria-label` del control lo nombra. */
export function Icono({ nombre, tamano = 20, grosor = 2 }: Props) {
  return (
    <svg class="icono" width={tamano} height={tamano} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={grosor} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      {trazosDe(nombre).map(([forma, attrs], i) => {
        if (forma === 'path') return <path key={i} {...attrs} />;
        if (forma === 'circle') return <circle key={i} {...attrs} />;
        return <rect key={i} {...attrs} />;
      })}
    </svg>
  );
}
