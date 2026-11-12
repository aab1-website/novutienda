import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { ErrorApi } from '../api/errores.js';
import { LIMITES_PANEL, type Rol } from '../api/tipos.js';
import { Alerta, Boton, BotonConfirmado, Campo, Cargando, ErrorCarga, Selector, Seccion } from '../ui/comun.js';
import { useApp } from '../ui/contexto.js';
import { useAccion, useCarga } from '../ui/hooks.js';
import { Tabla } from '../ui/tabla.js';

const ROL_TEXTO: Record<Rol, string> = { caj: 'Vendedor', sup: 'Supervisor', adm: 'Administrador' };

type Resultado =
  | { readonly tipo: 'verificada'; readonly uid: string; readonly correo: string }
  | { readonly tipo: 'sin-verificar'; readonly correo: string }
  | { readonly tipo: 'sin-contrasena'; readonly correo: string }
  | { readonly tipo: 'ya-miembro'; readonly correo: string }
  | { readonly tipo: 'inexistente'; readonly correo: string };

/** Instrucciones para una cuenta que no existe: el panel NO crea cuentas de Firebase Auth. */
function InstruccionesCuenta({ correo }: { correo: string }): JSX.Element {
  return (
    <div role="region" aria-label="Cómo crear la cuenta">
      <Alerta tipo="info">No existe una cuenta con el correo {correo}. Este panel no crea cuentas; siga estos pasos y vuelva a buscar.</Alerta>
      <ol>
        <li>El propietario de la plataforma crea la cuenta en Firebase Console, sección Authentication, pestaña Users, botón «Add user»: correo {correo} y una contraseña de al menos 6 caracteres que usted entregará a la persona por un medio seguro.</li>
        <li>La persona abre este panel e inicia sesión con ese correo y esa contraseña. Verá «Verifica tu correo» y debe pulsar «Reenviar enlace».</li>
        <li>La persona abre el mensaje que le llega a su correo y pulsa el enlace de verificación.</li>
        <li>Vuelva a esta pantalla y pulse «Buscar cuenta» de nuevo para asignarle el rol.</li>
      </ol>
    </div>
  );
}

export function PantallaUsuarios(): JSX.Element {
  const { api, usuario } = useApp();
  const lista = useCarga(() => api.llamar('listarUsuarios', {}), []);
  const accion = useAccion();
  const [cambios, setCambios] = useState<Record<string, Rol>>({});
  const [ok, setOk] = useState<string | null>(null);
  const [correo, setCorreo] = useState('');
  const [rolNuevo, setRolNuevo] = useState<Rol>('caj');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const cantidad = lista.datos?.length ?? 0;
  const lleno = lista.datos !== undefined && cantidad >= LIMITES_PANEL.usuarios;

  const buscar = (): void => {
    const buscado = correo.trim().toLowerCase();
    if (buscado === '') return;
    setOk(null);
    setResultado(null);
    void accion.ejecutar(async () => {
      const miembro = lista.datos?.find((u) => u.correo.toLowerCase() === buscado);
      if (miembro !== undefined) {
        setResultado({ tipo: 'ya-miembro', correo: buscado });
        return;
      }
      try {
        const r = await api.llamar('buscarUsuarioPorCorreo', { correo: buscado });
        if (!r.conContrasena) setResultado({ tipo: 'sin-contrasena', correo: buscado });
        else if (!r.correoVerificado) setResultado({ tipo: 'sin-verificar', correo: buscado });
        else setResultado({ tipo: 'verificada', uid: r.uid, correo: buscado });
      } catch (e) {
        if (e instanceof ErrorApi && e.codigoHttps === 'not-found') setResultado({ tipo: 'inexistente', correo: buscado });
        else throw e;
      }
    });
  };
  const darAlta = (r: Extract<Resultado, { tipo: 'verificada' }>): void => {
    void accion.ejecutar(async () => {
      await api.llamar('asignarRol', { uid: r.uid, rol: rolNuevo });
      setOk(`Listo: ${r.correo} ahora es ${ROL_TEXTO[rolNuevo].toLowerCase()}. La persona lo verá al volver a iniciar sesión.`);
      setResultado(null);
      setCorreo('');
      lista.recargar();
    });
  };

  const asignar = (uid: string): void => {
    const rol = cambios[uid];
    if (rol === undefined) return;
    void accion.ejecutar(async () => {
      await api.llamar('asignarRol', { uid, rol });
      setOk('Rol actualizado. La persona lo verá al volver a iniciar sesión.');
      lista.recargar();
    });
  };
  const quitar = (uid: string): void => {
    void accion.ejecutar(async () => {
      await api.llamar('quitarRol', { uid });
      setOk('Acceso retirado.');
      lista.recargar();
    });
  };

  return (
    <div>
      <h1>Usuarios</h1>
      <Seccion titulo="Agregar una persona">
        {lleno ? (
          <Alerta tipo="info">El plan incluye {LIMITES_PANEL.usuarios} usuarios y ya están todos ocupados. Para agregar a otra persona, quite primero el acceso de alguien.</Alerta>
        ) : (
          <form class="formulario" onSubmit={(e) => { e.preventDefault(); buscar(); }} noValidate>
            <Campo etiqueta="Correo de la persona" tipo="email" inputMode="email" autocompletar="off" valor={correo} onInput={(v) => { setCorreo(v); setResultado(null); }} ayuda="La cuenta debe existir con correo y contraseña, y el correo debe estar verificado." />
            <Selector etiqueta="Rol que tendrá" valor={rolNuevo} onCambio={(v) => setRolNuevo(v as Rol)} opciones={(['caj', 'sup'] as const).map((r) => ({ valor: r, texto: ROL_TEXTO[r] }))} />
            <div class="fila"><Boton tipo="submit" ocupado={accion.ocupado} deshabilitado={correo.trim() === ''}>Buscar cuenta</Boton></div>
          </form>
        )}
        {!lleno && resultado?.tipo === 'ya-miembro' && <Alerta tipo="info">{resultado.correo} ya tiene acceso. Cambie su rol en la tabla de abajo.</Alerta>}
        {!lleno && resultado?.tipo === 'sin-verificar' && <Alerta tipo="info">La cuenta de {resultado.correo} existe, pero su correo todavía no está verificado. Pida a la persona que inicie sesión en este panel, pulse «Reenviar enlace» y abra el enlace que le llegue; luego busque de nuevo.</Alerta>}
        {!lleno && resultado?.tipo === 'sin-contrasena' && <Alerta tipo="info">La cuenta de {resultado.correo} no tiene contraseña. El personal debe ingresar con correo y contraseña: pida al propietario de la plataforma que le asigne una.</Alerta>}
        {!lleno && resultado?.tipo === 'inexistente' && <InstruccionesCuenta correo={resultado.correo} />}
        {!lleno && resultado?.tipo === 'verificada' && (
          <div class="fila">
            <Alerta tipo="ok">Cuenta encontrada y con el correo verificado: {resultado.correo}.</Alerta>
            <Boton onClick={() => darAlta(resultado)} ocupado={accion.ocupado}>{`Asignar rol de ${ROL_TEXTO[rolNuevo].toLowerCase()}`}</Boton>
          </div>
        )}
      </Seccion>
      <Seccion titulo={`Personas con acceso (${cantidad} de ${LIMITES_PANEL.usuarios})`}>
        <p class="texto-suave">El plan incluye tres usuarios. Solo el propietario de la plataforma puede cambiar o quitar a un administrador.</p>
        {lista.cargando && <Cargando />}
        {lista.error && <ErrorCarga error={lista.error} reintentar={lista.recargar} />}
        {accion.error && <Alerta>{accion.error}</Alerta>}
        {ok && <Alerta tipo="ok">{ok}</Alerta>}
        {lista.datos && (
          <Tabla
            titulo="Usuarios del negocio"
            filas={lista.datos}
            clave={(u) => u.uid}
            buscar={{ etiqueta: 'Buscar por correo', en: (u) => [u.correo] }}
            vacio={{ titulo: 'No hay usuarios' }}
            columnas={[
              { id: 'correo', titulo: 'Correo', valor: (u) => u.correo, encabezadoFila: true, ordenable: true, celda: (u) => `${u.correo}${u.uid === usuario.uid ? ' (usted)' : ''}` },
              {
                id: 'rol',
                titulo: 'Rol',
                valor: (u) => ROL_TEXTO[u.rol],
                celda: (u) =>
                  u.rol === 'adm' ? (
                    ROL_TEXTO.adm
                  ) : (
                    <Selector etiqueta={`Rol de ${u.correo}`} valor={cambios[u.uid] ?? u.rol} onCambio={(v) => setCambios({ ...cambios, [u.uid]: v as Rol })} opciones={(['caj', 'sup'] as const).map((r) => ({ valor: r, texto: ROL_TEXTO[r] }))} />
                  ),
              },
            ]}
            acciones={(u) =>
              u.rol !== 'adm' && (
                <div class="fila">
                  <Boton variante="secundario" chico deshabilitado={accion.ocupado} motivo={cambios[u.uid] === undefined || cambios[u.uid] === u.rol ? 'Cambie el rol para guardar' : undefined} onClick={() => asignar(u.uid)}>
                    Guardar rol
                  </Boton>
                  <BotonConfirmado texto="Quitar acceso" pregunta={`¿Quitar el acceso de ${u.correo}?`} textoConfirmar="Sí, quitar" peligro chico onConfirmar={() => quitar(u.uid)} />
                </div>
              )
            }
          />
        )}
      </Seccion>
    </div>
  );
}
