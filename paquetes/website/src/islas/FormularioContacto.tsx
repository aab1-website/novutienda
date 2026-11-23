import { useRef, useState } from 'preact/hooks';
import { enlaceWhatsApp, mensajeContacto } from '../lib/whatsapp.js';
import { Icono } from './Icono.js';
import { medicionGlobal } from './navegador.js';

interface Props {
  /** Número de la tienda; sin número no hay formulario (la página muestra solo los datos de contacto). */
  whatsapp: string | null;
}

type Campo = 'nombre' | 'mensaje';
const ETIQUETAS: Readonly<Record<Campo, string>> = { nombre: 'Escribe tu nombre', mensaje: 'Escribe tu mensaje' };
const MENSAJE_GENERAL = 'Hola, tengo una consulta.';

/**
 * Contacto por WhatsApp: el nombre y el mensaje arman el texto de un enlace a wa.me. Nada se envía a ningún servidor.
 * Sin JavaScript (o sin nombre y mensaje) el enlace lleva el mensaje general; con JavaScript valida y abre WhatsApp.
 */
export default function FormularioContacto({ whatsapp }: Props) {
  const [nombre, setNombre] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [errores, setErrores] = useState<readonly Campo[]>([]);
  const refNombre = useRef<HTMLInputElement>(null);
  const refMensaje = useRef<HTMLTextAreaElement>(null);
  const completo = nombre.trim() !== '' && mensaje.trim() !== '';
  const enlace = enlaceWhatsApp(whatsapp, completo ? mensajeContacto(nombre, mensaje) : MENSAJE_GENERAL);
  if (enlace === null) return null;

  const enviar = (): void => {
    const faltan: Campo[] = [];
    if (nombre.trim() === '') faltan.push('nombre');
    if (mensaje.trim() === '') faltan.push('mensaje');
    setErrores(faltan);
    if (faltan.length > 0) {
      (faltan[0] === 'nombre' ? refNombre : refMensaje).current?.focus();
      return;
    }
    medicionGlobal().evento('envio_formulario');
    window.open(enlace, '_blank', 'noopener');
  };
  const invalido = (k: Campo): boolean => errores.includes(k);
  return (
    <form class="formulario" noValidate aria-label="Formulario de contacto" onSubmit={(e) => { e.preventDefault(); enviar(); }}>
      <div class="resumen-formulario" role="alert">
        {errores.length > 0 && <p>Revisa los campos marcados.</p>}
      </div>
      <div class="campo">
        <label for="contacto-nombre">Nombre</label>
        <input id="contacto-nombre" ref={refNombre} name="nombre" autocomplete="name" maxLength={80} value={nombre} aria-required="true" aria-invalid={invalido('nombre')} aria-describedby={invalido('nombre') ? 'error-nombre' : undefined} onInput={(e) => setNombre((e.currentTarget as HTMLInputElement).value)} />
        {invalido('nombre') && <span id="error-nombre" class="error-campo">{ETIQUETAS.nombre}</span>}
      </div>
      <div class="campo">
        <label for="contacto-mensaje">Mensaje</label>
        <textarea id="contacto-mensaje" ref={refMensaje} name="mensaje" rows={5} maxLength={1000} value={mensaje} aria-required="true" aria-invalid={invalido('mensaje')} aria-describedby={invalido('mensaje') ? 'error-mensaje' : undefined} onInput={(e) => setMensaje((e.currentTarget as HTMLTextAreaElement).value)} />
        {invalido('mensaje') && <span id="error-mensaje" class="error-campo">{ETIQUETAS.mensaje}</span>}
      </div>
      <div class="acciones-formulario">
        <a class="boton boton-cta" href={enlace} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.preventDefault(); enviar(); }}>
          <Icono nombre="chat" tamano={16} /> ENVIAR POR WHATSAPP<span class="solo-lectores"> (se abre en una pestaña nueva)</span>
        </a>
      </div>
      <p class="aviso-estado">Se abrirá WhatsApp con tu mensaje listo para enviar a la tienda. Este sitio no guarda lo que escribes aquí.</p>
    </form>
  );
}
