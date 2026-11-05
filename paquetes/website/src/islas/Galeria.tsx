import { useState } from 'preact/hooks';
import type { Foto, Video } from '../contenido/tipos.js';
import { srcsetDe, TAMANOS_FICHA } from '../lib/medios.js';
import { Icono } from './Icono.js';

interface Props {
  nombre: string;
  fotos: readonly Foto[];
  video: Video | null;
}

/** Galería de la ficha: hasta 5 fotos y 1 video. El video no se descarga hasta que se reproduce (`preload="none"`). */
export default function Galeria({ nombre, fotos, video }: Props) {
  const total = fotos.length + (video === null ? 0 : 1);
  const [i, setI] = useState(0);
  const ir = (n: number): void => setI(total === 0 ? 0 : (n + total) % total);
  const foto = i < fotos.length ? fotos[i] : undefined;

  if (total === 0) {
    return <div class="galeria galeria-vacia" role="img" aria-label={`Sin imagen de ${nombre}`}>IMAGEN DEL PRODUCTO</div>;
  }
  return (
    <div
      class="galeria"
      role="region"
      aria-roledescription="galería"
      aria-label={`Galería de ${nombre}`}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); ir(i + 1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); ir(i - 1); }
      }}
    >
      <div class="galeria-principal">
        {foto !== undefined ? (
          <img src={foto.url} srcset={srcsetDe(foto)} sizes={TAMANOS_FICHA} alt={foto.alt} decoding="async" loading={i === 0 ? 'eager' : 'lazy'} />
        ) : video !== null ? (
          <video controls preload="none" playsInline poster={video.poster} src={video.url} aria-label={video.titulo} />
        ) : null}
        {total > 1 && (
          <>
            <button type="button" class="galeria-flecha galeria-anterior boton-icono" aria-label="Anterior" onClick={() => ir(i - 1)}><Icono nombre="anterior" /></button>
            <button type="button" class="galeria-flecha galeria-siguiente boton-icono" aria-label="Siguiente" onClick={() => ir(i + 1)}><Icono nombre="siguiente" /></button>
          </>
        )}
      </div>
      {total > 1 && (
        <div class="galeria-miniaturas" role="group" aria-label="Elegir imagen">
          {fotos.map((f, n) => (
            <button key={f.url + n} type="button" class="miniatura" aria-label={`Ver foto ${n + 1} de ${fotos.length}: ${f.alt}`} aria-current={n === i ? 'true' : undefined} onClick={() => setI(n)}>
              <img src={f.url} alt="" loading="lazy" decoding="async" />
            </button>
          ))}
          {video !== null && (
            <button type="button" class="miniatura miniatura-video" aria-label={`Ver video: ${video.titulo}`} aria-current={i === fotos.length ? 'true' : undefined} onClick={() => setI(fotos.length)}>
              <img src={video.poster} alt="" loading="lazy" decoding="async" />
              <Icono nombre="play" tamano={18} />
            </button>
          )}
        </div>
      )}
      <p class="solo-lectores" aria-live="polite">{`Imagen ${i + 1} de ${total}`}</p>
    </div>
  );
}
