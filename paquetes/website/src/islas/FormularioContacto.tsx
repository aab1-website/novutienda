import { useRef, useState } from 'preact/hooks';
import { ACCION_RECAPTCHA, CABECERA_APP_CHECK, validarContacto } from '../api/contacto.js';
import { enlaceWhatsApp } from '../lib/whatsapp.js';
import { Icono } from './Icono.js';
import { medicionGlobal } from './navegador.js';
import { cargarRecaptcha, obtenerTokenRecaptcha, proveedorAppCheck } from './recaptcha.js';

interface Props {
  recaptcha: string | null;
  whatsapp: string | null;
  productoId?: string | null;
  apiBase?: string;
}

type Estado = 'inactivo' | 'enviando' | 'enviado' | 'error';
const ETIQUETAS: Readonly<Record<string, string>> = {
  nombre: 'Nombre (2 a 80 caracteres)', correo: 'Correo electrónico válido', telefono: 'Teléfono válido', contacto: 'Indica un correo o un teléfono',
  mensaje: 'Mensaje (5 a 2000 caracteres)', aceptaPrivacidad: 'Debes aceptar el tratamiento de tus datos', pais: 'País',
};
const nuevoId = (): string => (crypto.randomUUID?.() ?? `${Date.now()}${Math.random().toString(36).slice(2)}0000`).replace(/-/g, '');

/** Formulario de contacto con reCAPTCHA. Reintentar el mismo envío no duplica el mensaje (clave de idempotencia). */
export default function FormularioContacto({ recaptcha, whatsapp, productoId = null, apiBase = '' }: Props) {
  const [estado, setEstado] = useState<Estado>('inactivo');
  const [errores, setErrores] = useState<readonly string[]>([]);
  const [mensajeError, setMensajeError] = useState('');
  const envioId = useRef(nuevoId());
  const resumen = useRef<HTMLDivElement>(null);
  const formulario = useRef<HTMLFormElement>(null);

  const precargar = (): void => {
    if (recaptcha !== null) void cargarRecaptcha(recaptcha).catch(() => undefined);
  };
  const falla = (campos: readonly string[], texto: string): void => {
    setErrores(campos);
    setMensajeError(texto);
    setEstado('error');
    window.setTimeout(() => resumen.current?.focus(), 0);
  };

  async function enviar(e: Event): Promise<void> {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    const texto = (k: string): string => String(f.get(k) ?? '');
    const cuerpo = {
      envioId: envioId.current, nombre: texto('nombre'), correo: texto('correo'), telefono: texto('telefono'), mensaje: texto('mensaje'),
      pais: texto('pais'), productoId, aceptaPrivacidad: f.get('aceptaPrivacidad') === 'on', sitioWeb: texto('sitioWeb'),
    };
    const previo = validarContacto({ ...cuerpo, recaptchaToken: 'x'.repeat(20) });
    if (!previo.ok) return falla(previo.campos, 'Revisa los campos marcados.');
    if (recaptcha === null) return falla([], 'El formulario no está disponible por ahora. Escríbenos por WhatsApp.');

    setEstado('enviando');
    setErrores([]);
    try {
      const recaptchaToken = await obtenerTokenRecaptcha(recaptcha, ACCION_RECAPTCHA);
      const cabeceras: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
      const tokenAppCheck = await proveedorAppCheck()?.();
      if (tokenAppCheck) cabeceras[CABECERA_APP_CHECK] = tokenAppCheck;
      const r = await fetch(`${apiBase}/api/contacto`, { method: 'POST', headers: cabeceras, body: JSON.stringify({ ...cuerpo, recaptchaToken }) });
      if (r.ok) {
        medicionGlobal().evento('envio_formulario');
        envioId.current = nuevoId();
        formulario.current?.reset();
        setEstado('enviado');
        window.setTimeout(() => resumen.current?.focus(), 0);
        return;
      }
      if (r.status === 400) return falla(((await r.json()) as { campos?: string[] }).campos ?? [], 'Revisa los campos marcados.');
      if (r.status === 429) return falla([], 'Hiciste varios envíos seguidos. Espera unos minutos e inténtalo de nuevo.');
      if (r.status === 401 || r.status === 403) return falla([], 'No pudimos verificar que eres una persona. Recarga la página e inténtalo de nuevo.');
      return falla([], 'No pudimos enviar tu mensaje. Inténtalo de nuevo o escríbenos por WhatsApp.');
    } catch {
      return falla([], 'No pudimos enviar tu mensaje. Revisa tu conexión o escríbenos por WhatsApp.');
    }
  }

  const enlaceWa = enlaceWhatsApp(whatsapp, 'Hola, tengo una consulta.');
  const invalido = (k: string): boolean => errores.includes(k);
  return (
    <form ref={formulario} class="formulario" noValidate onSubmit={(e) => void enviar(e)} onFocusCapture={precargar} aria-label="Formulario de contacto">
      <div ref={resumen} tabIndex={-1} class="resumen-formulario" role={estado === 'error' ? 'alert' : 'status'}>
        {estado === 'enviado' && '¡Gracias! Recibimos tu mensaje y te responderemos pronto.'}
        {estado === 'error' && (
          <>
            {mensajeError}
            {errores.length > 0 && <ul>{errores.map((k) => <li key={k}>{ETIQUETAS[k] ?? k}</li>)}</ul>}
          </>
        )}
      </div>
      <label>Nombre
        <input name="nombre" autocomplete="name" required aria-invalid={invalido('nombre')} />
      </label>
      <label>Correo electrónico
        <input name="correo" type="email" autocomplete="email" aria-invalid={invalido('correo') || invalido('contacto')} />
      </label>
      <label>Teléfono o WhatsApp (opcional si indicas un correo)
        <input name="telefono" type="tel" autocomplete="tel" aria-invalid={invalido('telefono') || invalido('contacto')} />
      </label>
      <label>País
        <select name="pais" aria-invalid={invalido('pais')}>
          <option value="">Prefiero no indicarlo</option>
          <option value="BO">Bolivia</option>
          <option value="AR">Argentina</option>
        </select>
      </label>
      <label>Mensaje
        <textarea name="mensaje" rows={5} required aria-invalid={invalido('mensaje')} />
      </label>
      <div class="trampa" aria-hidden="true">
        <label>No completar este campo <input name="sitioWeb" tabIndex={-1} autocomplete="off" /></label>
      </div>
      <label class="casilla">
        <input name="aceptaPrivacidad" type="checkbox" aria-invalid={invalido('aceptaPrivacidad')} />
        Acepto que usen mis datos para responder mi consulta. <a href="/privacidad">Política de privacidad</a>
      </label>
      <div class="acciones-formulario">
        <button type="submit" class="boton boton-cta" disabled={estado === 'enviando'}>
          <Icono nombre="enviar" tamano={16} /> {estado === 'enviando' ? 'ENVIANDO…' : 'ENVIAR MENSAJE'}
        </button>
        {enlaceWa !== null && <a class="boton boton-secundario" href={enlaceWa} target="_blank" rel="noopener noreferrer"><Icono nombre="chat" tamano={16} /> ESCRIBIR POR WHATSAPP</a>}
      </div>
      <p class="aviso-estado">Este sitio usa reCAPTCHA de Google para evitar abusos; se carga solo cuando empiezas a escribir.</p>
    </form>
  );
}
