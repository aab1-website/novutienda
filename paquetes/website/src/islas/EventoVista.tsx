import { useEffect } from 'preact/hooks';
import { medicionGlobal } from './navegador.js';

/** Registra la vista del producto (solo se envía si hay consentimiento; si no, no ocurre nada). */
export default function EventoVista({ id, nombre }: { id: string; nombre: string }) {
  useEffect(() => {
    medicionGlobal().evento('vista_producto', { id, nombre });
  }, [id, nombre]);
  return null;
}
