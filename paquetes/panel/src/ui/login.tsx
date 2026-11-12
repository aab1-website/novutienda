import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { ResultadoInicio, Sesion } from '../sesion/sesion.js';
import { Alerta, Boton, Campo } from './comun.js';

export function Login({ sesion, nombre, motivo }: { sesion: Sesion; nombre: string; motivo?: 'vencida' | undefined }): JSX.Element {
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<ResultadoInicio | null>(null);
  const [reenviado, setReenviado] = useState(false);

  const enviar = (e: Event): void => {
    e.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setReenviado(false);
    sesion
      .iniciar(correo, clave)
      .then((r) => setResultado(r))
      .catch(() => setResultado({ tipo: 'error', mensaje: 'No se pudo iniciar sesión. Intente de nuevo.' }))
      .finally(() => setOcupado(false));
  };

  return (
    <main class="login" id="contenido" tabIndex={-1}>
      <form class="tarjeta login-caja" onSubmit={enviar} noValidate>
        <h1>{nombre}</h1>
        <p class="texto-suave">Inicie sesión con su correo verificado y su contraseña.</p>
        {motivo === 'vencida' && <Alerta tipo="info">Su sesión venció. Ingrese de nuevo para seguir donde estaba.</Alerta>}
        <Campo etiqueta="Correo" tipo="email" valor={correo} onInput={setCorreo} requerido autocompletar="username" inputMode="email" nombre="correo" />
        <Campo etiqueta="Contraseña" tipo="password" valor={clave} onInput={setClave} requerido autocompletar="current-password" nombre="clave" />
        {resultado?.tipo === 'correo-no-verificado' && (
          <Alerta tipo="info">
            <span>Verifica tu correo para entrar: te enviamos un enlace de verificación.</span>
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
