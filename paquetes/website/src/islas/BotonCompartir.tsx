import { useEffect, useRef, useState } from 'preact/hooks';
import { Icono } from './Icono.js';

interface Props {
  /** Nombre del producto: es el título que recibe la app que se elija al compartir. */
  titulo: string;
}

/** Enlace de la página sin el fragmento. */
const enlaceActual = (): string => window.location.href.split('#')[0] ?? window.location.href;

/**
 * Comparte la ficha. Con `navigator.share` (celulares) abre el menú del sistema; si no existe, copia el enlace
 * y avisa «Enlace copiado». Sin JavaScript el botón no se muestra (no hay nada que compartir sin la isla).
 */
export default function BotonCompartir({ titulo }: Props) {
  const [aviso, setAviso] = useState('');
  const reloj = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(reloj.current), []);

  const avisar = (texto: string): void => {
    setAviso(texto);
    window.clearTimeout(reloj.current);
    reloj.current = window.setTimeout(() => setAviso(''), 2500);
  };
  const compartir = async (): Promise<void> => {
    const url = enlaceActual();
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: titulo, url });
      } catch {
        // La persona cerró el menú de compartir: no es un error.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      avisar('Enlace copiado');
    } catch {
      avisar('No se pudo copiar el enlace. Cópialo desde la barra de direcciones.');
    }
  };
  return (
    <div class="compartir">
      <button type="button" class="boton boton-secundario" onClick={() => { void compartir(); }}>
        <Icono nombre="enviar" tamano={15} /> COMPARTIR
      </button>
      <p class="aviso-estado" role="status">{aviso}</p>
    </div>
  );
}
