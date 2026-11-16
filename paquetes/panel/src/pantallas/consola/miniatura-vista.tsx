import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { Medio } from '../../api/tipos.js';
import { baseMedios, urlMiniatura } from './miniatura.js';

/** Medidas legibles (ancho × alto) para el respaldo. */
const medidasDe = (m: Medio): string => `${String(m.ancho)} × ${String(m.alto)}`;

/**
 * Vista previa de un medio con tamaño fijo. Sin URL o si la imagen falla al cargar muestra el texto de respaldo, el
 * número de orden y las medidas (si hay); nunca un hueco roto.
 */
export function Miniatura({ medio, alt, respaldo, orden, base }: { medio?: Medio | undefined; alt: string; respaldo: string; orden?: number | undefined; base?: string | undefined }): JSX.Element {
  const url = medio === undefined ? null : urlMiniatura(base ?? baseMedios(), medio);
  // Se recuerda la URL que falló, no un booleano: si cambia la URL se vuelve a intentar sin efectos.
  const [rota, setRota] = useState<string | null>(null);
  if (url !== null && rota !== url) {
    return <img class="miniatura" src={url} alt={alt} width={64} height={64} loading="lazy" decoding="async" referrerpolicy="no-referrer" onError={() => setRota(url)} />;
  }
  const partes = [respaldo, orden !== undefined ? `n.º ${String(orden)}` : undefined, medio !== undefined && medio.ancho > 0 && medio.alto > 0 ? medidasDe(medio) : undefined].filter((x): x is string => x !== undefined);
  return <span class="miniatura miniatura-respaldo" data-respaldo="">{partes.join(' · ')}</span>;
}
