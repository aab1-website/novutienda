import { useState } from 'preact/hooks';
import { enlaceWhatsApp, mensajeContacto } from '../lib/whatsapp.js';
import { Icono } from './Icono.js';
import { medicionGlobal } from './navegador.js';

interface Props {
  /** Número de la tienda; sin número no hay formulario (la página muestra solo los datos de contacto). */
  whatsapp: string | null;
}

const ETIQUETAS: Readonly<Record<string, string>> = { nombre: 'Escribe tu nombre', mensaje: 'Escribe tu mensaje' };

/** Contacto por WhatsApp: el nombre y el mensaje arman el texto de un enlace a wa.me. Nada se envía a ningún servidor. */
export default function FormularioContacto({ whatsapp }: Props) {
  const [nombre, setNombre] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [errores, setErrores] = useState<readonly string[]>([]);
  const enlace = enlaceWhatsApp(whatsapp, mensajeContacto(nombre, mensaje));
  if (enlace === null) return null;

  const alEnviar = (e: Event): void => {
    const faltan = [nombre.trim() === '' ? 'nombre' : '', mensaje.trim() === '' ? 'mensaje' : ''].filter((k) => k !== '');
    if (faltan.length > 0) {
      e.preventDefault();
      setErrores(faltan);
      return;
    }
    setErrores([]);
    medicionGlobal().evento('envio_formulario');
  };
  const invalido = (k: string): boolean => errores.includes(k);
  return (
    <form class="formulario" noValidate aria-label="Formulario de contacto" onSubmit={(e) => e.preventDefault()}>
      <div class="resumen-formulario" role="alert">
        {errores.length > 0 && <ul>{errores.map((k) => <li key={k}>{ETIQUETAS[k] ?? k}</li>)}</ul>}
      </div>
      <label>Nombre
        <input name="nombre" autocomplete="name" maxLength={80} value={nombre} aria-invalid={invalido('nombre')} onInput={(e) => setNombre((e.currentTarget as HTMLInputElement).value)} />
      </label>
      <label>Mensaje
        <textarea name="mensaje" rows={5} maxLength={1000} value={mensaje} aria-invalid={invalido('mensaje')} onInput={(e) => setMensaje((e.currentTarget as HTMLTextAreaElement).value)} />
      </label>
      <div class="acciones-formulario">
        <a class="boton boton-cta" href={enlace} target="_blank" rel="noopener noreferrer" onClick={alEnviar}>
          <Icono nombre="chat" tamano={16} /> ENVIAR POR WHATSAPP
        </a>
      </div>
      <p class="aviso-estado">Se abrirá WhatsApp con tu mensaje listo para enviar a la tienda. Este sitio no guarda lo que escribes aquí.</p>
    </form>
  );
}
