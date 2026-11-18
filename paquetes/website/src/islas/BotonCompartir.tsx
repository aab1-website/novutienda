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
 * y avisa «Enlace copiado». La isla es `client:only`: sin JavaScript el botón no existe, en vez de verse sin hacer nada.
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
        return;
      } catch (e) {
        // Cerrar el menú de compartir (AbortError) no es un error; cualquier otro falla a copiar el enlace.
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
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
