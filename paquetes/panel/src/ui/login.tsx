import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { ResultadoInicio, Sesion } from '../sesion/sesion.js';
import { Alerta, Boton, Campo } from './comun.js';

/** Respuesta única al pedir el restablecimiento: no dice si el correo tiene una cuenta. */
export const MENSAJE_RECUPERACION = 'Si el correo tiene una cuenta, le llegará un enlace para elegir una contraseña nueva. Revise también la carpeta de correo no deseado.';

export function Login({ sesion, nombre, motivo }: { sesion: Sesion; nombre: string; motivo?: 'vencida' | undefined }): JSX.Element {
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<ResultadoInicio | null>(null);
  const [reenviado, setReenviado] = useState(false);
  const [recuperando, setRecuperando] = useState(false);
  const [recuperacion, setRecuperacion] = useState<'enviada' | 'sin-correo' | null>(null);

  const enviar = (e: Event): void => {
    e.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setReenviado(false);
    setRecuperacion(null);
    sesion
      .iniciar(correo, clave)
      .then((r) => setResultado(r))
      .catch(() => setResultado({ tipo: 'error', mensaje: 'No se pudo iniciar sesión. Intente de nuevo.' }))
      .finally(() => setOcupado(false));
  };

  const recuperar = (): void => {
    if (recuperando) return;
    setResultado(null);
    if (correo.trim() === '') {
      setRecuperacion('sin-correo');
      return;
    }
    setRecuperando(true);
    // Sea cual sea el desenlace, la respuesta es la misma: no se revela si el correo existe.
    sesion
      .recuperarContrasena(correo)
      .catch(() => undefined)
      .finally(() => {
        setRecuperacion('enviada');
        setRecuperando(false);
      });
  };

  return (
    <main class="login" id="contenido" tabIndex={-1}>
      <form class="tarjeta login-caja" onSubmit={enviar} noValidate>
        <h1>{nombre}</h1>
        <p class="texto-suave">Inicie sesión con su correo verificado y su contraseña.</p>
        {motivo === 'vencida' && <Alerta tipo="info">Su sesión venció. Ingrese de nuevo para seguir donde estaba.</Alerta>}
        <Campo etiqueta="Correo" tipo="email" valor={correo} onInput={setCorreo} requerido autocompletar="username" inputMode="email" nombre="correo" />
        <Campo etiqueta="Contraseña" tipo={verClave ? 'text' : 'password'} valor={clave} onInput={setClave} requerido autocompletar="current-password" nombre="clave" />
        <div class="fila">
          <button type="button" class="boton boton-secundario boton-chico" aria-pressed={verClave} onClick={() => setVerClave(!verClave)}>
            {verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          </button>
          <button type="button" class="boton boton-secundario boton-chico" disabled={recuperando} onClick={recuperar}>
            Olvidé mi contraseña
          </button>
        </div>
        {recuperacion === 'enviada' && <Alerta tipo="info">{MENSAJE_RECUPERACION}</Alerta>}
        {recuperacion === 'sin-correo' && <Alerta>Escriba su correo en el campo de arriba y pulse de nuevo «Olvidé mi contraseña».</Alerta>}
        {resultado?.tipo === 'correo-no-verificado' && (
          <Alerta tipo="info">
            <span>Verifique su correo para entrar: le enviamos un enlace de verificación.</span>
            <button
              type="button"
              class="boton boton-secundario boton-chico"
              onClick={() => void sesion.reenviarVerificacion().then(() => setReenviado(true))}
            >
              Reenviar enlace
            </button>
            {reenviado && <span> Enlace reenviado.</span>}
          </Alerta>
        )}
        {resultado?.tipo === 'credenciales-invalidas' && <Alerta>El correo o la contraseña no son correctos.</Alerta>}
        {resultado?.tipo === 'sin-acceso' && <Alerta>Su cuenta no tiene acceso a ningún negocio. Pida al administrador que le asigne un rol.</Alerta>}
        {resultado?.tipo === 'error' && <Alerta>{resultado.mensaje}</Alerta>}
        <Boton tipo="submit" ocupado={ocupado} deshabilitado={correo.trim() === '' || clave === ''}>
          Entrar
        </Boton>
      </form>
    </main>
  );
}
