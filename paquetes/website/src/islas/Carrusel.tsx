import { useEffect, useState } from 'preact/hooks';
import type { Foto } from '../contenido/tipos.js';
import { srcsetDe } from '../lib/medios.js';
import { Icono } from './Icono.js';

const esExterno = (url: string): boolean => /^https?:\/\//i.test(url);

interface Props {
  fotos: readonly Foto[];
  etiqueta: string;
  /** Milisegundos entre imágenes. */
  intervalo?: number;
  /** Las fotos del héroe son decorativas cuando el texto de la portada ya describe la oferta. */
  decorativo?: boolean;
}

/**
 * Carrusel de fotos. Se mueve solo, pero se puede pausar (WCAG 2.2.2), no se mueve si la persona
 * pidió menos animación y se maneja con teclado (anterior, siguiente y puntos).
 */
export default function Carrusel({ fotos, etiqueta, intervalo = 6000, decorativo = false }: Props) {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(fotos.length > 1);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setAuto(false);
  }, []);
  useEffect(() => {
    if (!auto || fotos.length < 2) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % fotos.length), intervalo);
    return () => window.clearInterval(t);
  }, [auto, fotos.length, intervalo]);

  const ir = (n: number): void => setI((n + fotos.length) % fotos.length);
  return (
    <div class="carrusel" role="region" aria-roledescription="carrusel" aria-label={etiqueta} onKeyDown={(e) => {
      if (e.key === 'ArrowRight') ir(i + 1);
      if (e.key === 'ArrowLeft') ir(i - 1);
    }}>
      <div class="carrusel-pista" aria-live={auto ? 'off' : 'polite'}>
        {fotos.map((f, n) => {
          const activa = n === i;
          const img = (
            <img
              key={f.enlace === undefined ? f.url + n : undefined}
              class={activa ? 'carrusel-imagen activa' : 'carrusel-imagen'}
              src={f.url}
              srcset={srcsetDe(f)}
              alt={decorativo ? '' : f.alt}
              aria-hidden={activa || f.enlace !== undefined ? undefined : 'true'}
              loading={n === 0 ? 'eager' : 'lazy'}
              decoding="async"
            />
          );
          // Con enlace, la foto activa es un enlace (foco por teclado, nombre accesible); las demás quedan fuera del orden de tabulación.
          return f.enlace === undefined ? img : (
            <a
              key={f.url + n}
              class={activa ? 'carrusel-enlace activa' : 'carrusel-enlace'}
              href={f.enlace}
              rel={esExterno(f.enlace) ? 'noopener' : undefined}
              aria-label={f.alt}
              aria-hidden={activa ? undefined : 'true'}
              tabIndex={activa ? undefined : -1}
            >{img}</a>
          );
        })}
      </div>
      {fotos.length > 1 && (
        <div class="carrusel-controles">
          <button type="button" class="boton-icono controles-carrusel" aria-label="Imagen anterior" onClick={() => ir(i - 1)}><Icono nombre="anterior" tamano={18} /></button>
          <button type="button" class="boton-icono controles-carrusel" aria-label={auto ? 'Pausar el carrusel' : 'Reanudar el carrusel'} aria-pressed={!auto} onClick={() => setAuto(!auto)}><Icono nombre={auto ? 'pausa' : 'play'} tamano={18} /></button>
          <button type="button" class="boton-icono controles-carrusel" aria-label="Imagen siguiente" onClick={() => ir(i + 1)}><Icono nombre="siguiente" tamano={18} /></button>
          <span class="carrusel-puntos">
            {fotos.map((f, n) => (
              <button key={f.url + n} type="button" class="punto" aria-label={`Ir a la imagen ${n + 1} de ${fotos.length}`} aria-current={n === i ? 'true' : undefined} onClick={() => setI(n)} />
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
