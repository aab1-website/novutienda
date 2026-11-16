import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { ResultadoInicio, Sesion } from '../sesion/sesion.js';
import { Alerta, Boton, Campo } from './comun.js';

/** Respuesta única al pedir el restablecimiento: no dice si el correo tiene una cuenta. */
export const MENSAJE_RECUPERACION = 'Si el correo tiene una cuenta, le llegará un enlace para elegir una contraseña nueva. Revise también la carpeta de correo no deseado.';

/** Segundos que el cliente espera antes de dejar pedir otro enlace de restablecimiento. */
export const ESPERA_RECUPERACION_S = 60;

export function Login({ sesion, nombre, motivo }: { sesion: Sesion; nombre: string; motivo?: 'vencida' | undefined }): JSX.Element {
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<ResultadoInicio | null>(null);
  const [reenviado, setReenviado] = useState(false);
  const [recuperando, setRecuperando] = useState(false);
  const [recuperacion, setRecuperacion] = useState<'enviada' | 'sin-correo' | null>(null);
  const [espera, setEspera] = useState(0);
  // Cuenta regresiva en el cliente: frena el reenvío repetido (el servicio real también limita por su cuenta).
  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  const enviar = (e: Event): void => {
    e.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setReenviado(false);
    setRecuperacion(null);
    setVerClave(false);
    sesion
      .iniciar(correo, clave)
      .then((r) => setResultado(r))
      .catch(() => setResultado({ tipo: 'error', mensaje: 'No se pudo iniciar sesión. Intente de nuevo.' }))
      .then(() => setVerClave(false))
      .finally(() => setOcupado(false));
  };

  const recuperar = (): void => {
    if (recuperando || espera > 0) return;
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
        setEspera(ESPERA_RECUPERACION_S);
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
          <button type="button" class="boton boton-secundario boton-chico" onClick={() => setVerClave(!verClave)}>
            {verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          </button>
          <Boton variante="secundario" chico ocupado={recuperando} onClick={recuperar} motivo={espera > 0 ? `Podrá pedir otro enlace en ${espera} s` : undefined}>
            Olvidé mi contraseña
          </Boton>
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
        {resultado?.tipo === 'sin-acceso' && (
          <Alerta>
            <span>Su cuenta no tiene acceso a ningún negocio. Pida al administrador que le asigne un rol o le envíe una invitación.</span>
            <button type="button" class="boton boton-secundario boton-chico" disabled={ocupado} onClick={() => enviar(new Event('submit'))}>
              Volver a comprobar
            </button>
          </Alerta>
        )}
        {resultado?.tipo === 'error' && (
          <Alerta>
            <span>{resultado.mensaje}</span>
            <button type="button" class="boton boton-secundario boton-chico" disabled={ocupado || correo.trim() === '' || clave === ''} onClick={() => enviar(new Event('submit'))}>
              Reintentar
            </button>
          </Alerta>
        )}
        <Boton tipo="submit" ocupado={ocupado} deshabilitado={correo.trim() === '' || clave === ''}>
          Entrar
        </Boton>
      </form>
    </main>
  );
}
