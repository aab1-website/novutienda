import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { ErrorApi } from '../api/errores.js';
import { LIMITES_PANEL, type Rol } from '../api/tipos.js';
import { Alerta, Boton, BotonConfirmado, Campo, Cargando, ErrorCarga, Selector, Seccion } from '../ui/comun.js';
import { useApp } from '../ui/contexto.js';
import { useAccion, useCarga } from '../ui/hooks.js';
import { Tabla } from '../ui/tabla.js';

const ROL_TEXTO: Record<Rol, string> = { caj: 'Vendedor', sup: 'Supervisor', adm: 'Administrador' };

const SIN_CORREO = 'Sin correo registrado';
/** El servidor puede devolver una cuenta sin correo: nunca se pinta «null» ni se rompe al comparar. */
const correoDe = (u: { readonly correo?: unknown }): string => (typeof u.correo === 'string' && u.correo.trim() !== '' ? u.correo : SIN_CORREO);

type Resultado =
  | { readonly tipo: 'verificada'; readonly uid: string; readonly correo: string }
  | { readonly tipo: 'sin-verificar'; readonly correo: string }
  | { readonly tipo: 'sin-contrasena'; readonly correo: string }
  | { readonly tipo: 'ya-miembro'; readonly correo: string }
  | { readonly tipo: 'inexistente'; readonly correo: string };

const ROLES_INVITABLES: readonly Rol[] = ['caj', 'sup', 'adm'];
const DIA_MS = 24 * 60 * 60 * 1000;
const fechaDe = (ms: number): string => new Date(ms).toLocaleDateString('es-BO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/La_Paz' });

export function PantallaUsuarios(): JSX.Element {
  const { api, usuario } = useApp();
  const lista = useCarga(() => api.llamar('listarUsuarios', {}), []);
  // El tope del plan lo dice el servidor; la constante es solo respaldo mientras llega o si la consulta falla.
  const tablero = useCarga(() => api.llamar('obtenerTablero', {}), []);
  const tope = tablero.datos?.uso.usuarios.tope ?? LIMITES_PANEL.usuarios;
  // Dos acciones: cada aviso de error aparece junto a la sección donde se actuó (y también como aviso fijo).
  const alta = useAccion();
  const tabla = useAccion();
  const [cambios, setCambios] = useState<Record<string, Rol>>({});
  const [correo, setCorreo] = useState('');
  const [rolNuevo, setRolNuevo] = useState<Rol>('caj');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  // Las invitaciones pendientes ocupan un cupo del plan, pero aún no son personas con acceso.
  const miembros = lista.datos?.filter((u) => u.estado !== 'invitado');
  const invitaciones = lista.datos?.filter((u) => u.estado === 'invitado');
  const cantidad = lista.datos?.length ?? 0;
  const lleno = lista.datos !== undefined && cantidad >= tope;
  const invitar = useAccion();
  const pendientes = useAccion();
  const [correoInvitado, setCorreoInvitado] = useState('');
  const [rolInvitado, setRolInvitado] = useState<Rol>('caj');

  const buscar = (): void => {
    const buscado = correo.trim().toLowerCase();
    if (buscado === '') return;
    setResultado(null);
    void alta.ejecutar(async () => {
      const miembro = miembros?.find((u) => correoDe(u).toLowerCase() === buscado);
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
    }, { error: 'ambos' });
  };
  const darAlta = (r: Extract<Resultado, { tipo: 'verificada' }>): void => {
    void alta.ejecutar(async () => {
      await api.llamar('asignarRol', { uid: r.uid, rol: rolNuevo });
      setResultado(null);
      setCorreo('');
      lista.recargar();
    }, { exito: `Listo: ${r.correo} ahora es ${ROL_TEXTO[rolNuevo].toLowerCase()}. La persona lo verá al volver a iniciar sesión.`, error: 'ambos' });
  };

  const enviarInvitacion = (): void => {
    const correoLimpio = correoInvitado.trim().toLowerCase();
    if (correoLimpio === '') return;
    void invitar.ejecutar(async () => {
      await api.llamar('invitarUsuario', { correo: correoLimpio, rol: rolInvitado });
      setCorreoInvitado('');
      lista.recargar();
    }, { exito: 'Invitación enviada', error: 'ambos' });
  };
  const reenviar = (uid: string, correoDeLaInvitacion: string): void => {
    void pendientes.ejecutar(async () => {
      await api.llamar('reenviarInvitacion', { uid, correo: correoDeLaInvitacion });
      lista.recargar();
    }, { exito: 'Invitación enviada', error: 'ambos' });
  };
  const anular = (uid: string): void => {
    void pendientes.ejecutar(async () => {
      await api.llamar('anularInvitacion', { uid });
      lista.recargar();
    }, { exito: 'Invitación anulada.', error: 'ambos' });
  };

  const asignar = (uid: string): void => {
    const rol = cambios[uid];
    if (rol === undefined) return;
    void tabla.ejecutar(async () => {
      await api.llamar('asignarRol', { uid, rol });
      lista.recargar();
    }, { exito: 'Rol actualizado. La persona lo verá al volver a iniciar sesión.', error: 'ambos' });
  };
  const quitar = (uid: string): void => {
    void tabla.ejecutar(async () => {
      await api.llamar('quitarRol', { uid });
      lista.recargar();
    }, { exito: 'Acceso retirado.', error: 'ambos' });
  };

  return (
    <div>
      <h1>Usuarios</h1>
      <Seccion titulo="Agregar una persona">
        {lleno ? (
          <Alerta tipo="info">El plan incluye {tope} usuarios y ya están todos ocupados. Para agregar a otra persona, quite primero el acceso de alguien.</Alerta>
        ) : (
          <form class="formulario" onSubmit={(e) => { e.preventDefault(); buscar(); }} noValidate>
            <Campo etiqueta="Correo de la persona" tipo="email" inputMode="email" autocompletar="off" valor={correo} onInput={(v) => { setCorreo(v); setResultado(null); }} ayuda="La cuenta debe existir con correo y contraseña, y el correo debe estar verificado." />
            <div class="fila"><Boton tipo="submit" ocupado={alta.ocupado} motivo={correo.trim() === '' ? 'Escriba el correo de la persona' : undefined}>Buscar cuenta</Boton></div>
          </form>
        )}
        {alta.error && <Alerta>{alta.error}</Alerta>}
        {!lleno && resultado?.tipo === 'ya-miembro' && <Alerta tipo="info">{resultado.correo} ya tiene acceso. Cambie su rol en la tabla de abajo.</Alerta>}
        {!lleno && resultado?.tipo === 'sin-verificar' && <Alerta tipo="info">La cuenta de {resultado.correo} existe, pero su correo todavía no está verificado. Pida a la persona que inicie sesión en este panel, pulse «Reenviar enlace» y abra el enlace que le llegue; luego busque de nuevo.</Alerta>}
        {!lleno && resultado?.tipo === 'sin-contrasena' && <Alerta tipo="info">La cuenta de {resultado.correo} no tiene contraseña. El personal debe ingresar con correo y contraseña: pida al propietario de la plataforma que le asigne una.</Alerta>}
        {!lleno && resultado?.tipo === 'inexistente' && <Alerta tipo="info">No existe una cuenta con el correo {resultado.correo}. Invítela en «Invitar a una persona»: recibirá un enlace para elegir su contraseña.</Alerta>}
        {!lleno && resultado?.tipo === 'verificada' && (
          <div class="formulario">
            <Alerta tipo="ok">Cuenta encontrada y con el correo verificado: {resultado.correo}.</Alerta>
            <Selector etiqueta="Rol que tendrá" valor={rolNuevo} onCambio={(v) => setRolNuevo(v as Rol)} opciones={(['caj', 'sup'] as const).map((r) => ({ valor: r, texto: ROL_TEXTO[r] }))} />
            <Boton onClick={() => darAlta(resultado)} ocupado={alta.ocupado}>{`Asignar rol de ${ROL_TEXTO[rolNuevo].toLowerCase()}`}</Boton>
          </div>
        )}
      </Seccion>
      <Seccion titulo="Invitar a una persona">
        <p class="texto-suave">La persona recibe un enlace por correo para elegir su contraseña y, al entrar, ya tiene el rol que usted elija. La invitación ocupa un cupo del plan y caduca a los 7 días.</p>
        <form class="formulario" onSubmit={(e) => { e.preventDefault(); if (!lleno) enviarInvitacion(); }} noValidate>
          <Campo etiqueta="Correo para invitar" tipo="email" inputMode="email" autocompletar="off" valor={correoInvitado} onInput={setCorreoInvitado} />
          <Selector etiqueta="Rol de la invitación" valor={rolInvitado} onCambio={(v) => setRolInvitado(v as Rol)} opciones={ROLES_INVITABLES.map((r) => ({ valor: r, texto: ROL_TEXTO[r] }))} />
          <div class="fila">
            <Boton tipo="submit" ocupado={invitar.ocupado} motivo={lleno ? 'El plan no tiene cupos libres: anule una invitación o quite un acceso' : correoInvitado.trim() === '' ? 'Escriba el correo para invitar' : undefined}>Invitar</Boton>
          </div>
        </form>
        {invitar.error && <Alerta>{invitar.error}</Alerta>}
        {pendientes.error && <Alerta>{pendientes.error}</Alerta>}
        {invitaciones !== undefined && invitaciones.length > 0 && (
          <Tabla
            titulo="Invitaciones pendientes"
            filas={invitaciones}
            clave={(u) => u.uid}
            vacio={{ titulo: 'No hay invitaciones pendientes' }}
            columnas={[
              { id: 'correo', titulo: 'Correo', valor: (u) => correoDe(u), encabezadoFila: true, ordenable: true, celda: (u) => correoDe(u) },
              { id: 'rol', titulo: 'Rol reservado', valor: (u) => ROL_TEXTO[u.rol], celda: (u) => ROL_TEXTO[u.rol] },
              { id: 'vence', titulo: 'Vence', valor: (u) => String(u.venceEnMs ?? 0), celda: (u) => `Vence el ${fechaDe(u.venceEnMs ?? 0)}${(u.venceEnMs ?? 0) - Date.now() < DIA_MS ? ' (queda menos de un día)' : ''}` },
            ]}
            acciones={(u) => (
              <div class="fila">
                <Boton variante="secundario" chico ocupado={pendientes.ocupado} onClick={() => reenviar(u.uid, correoDe(u))}>Reenviar</Boton>
                <BotonConfirmado texto="Anular" pregunta={`¿Anular la invitación de ${correoDe(u)}?`} textoConfirmar="Sí, anular" peligro chico onConfirmar={() => anular(u.uid)} />
              </div>
            )}
          />
        )}
      </Seccion>
      <Seccion titulo={`Personas con acceso (${cantidad} de ${tope})`}>
        <p class="texto-suave">El plan incluye {tope} usuarios. Solo el propietario de la plataforma puede cambiar o quitar a un administrador.</p>
        {lista.cargando && <Cargando />}
        {lista.error && <ErrorCarga error={lista.error} reintentar={lista.recargar} />}
        {tabla.error && <Alerta>{tabla.error}</Alerta>}
        {lista.datos && (
          <Tabla
            titulo="Usuarios del negocio"
            filas={miembros ?? []}
            clave={(u) => u.uid}
            buscar={{ etiqueta: 'Buscar por correo', en: (u) => [correoDe(u)] }}
            vacio={{ titulo: 'No hay usuarios' }}
            columnas={[
              { id: 'correo', titulo: 'Correo', valor: (u) => correoDe(u), encabezadoFila: true, ordenable: true, celda: (u) => `${correoDe(u)}${u.uid === usuario.uid ? ' (usted)' : ''}` },
              {
                id: 'rol',
                titulo: 'Rol',
                valor: (u) => ROL_TEXTO[u.rol],
                celda: (u) =>
                  u.rol === 'adm' ? (
                    ROL_TEXTO.adm
                  ) : (
                    <Selector etiqueta={`Rol de ${correoDe(u)}`} valor={cambios[u.uid] ?? u.rol} onCambio={(v) => setCambios({ ...cambios, [u.uid]: v as Rol })} opciones={(['caj', 'sup'] as const).map((r) => ({ valor: r, texto: ROL_TEXTO[r] }))} />
                  ),
              },
            ]}
            acciones={(u) =>
              u.rol !== 'adm' && (
                <div class="fila">
                  <Boton variante="secundario" chico deshabilitado={tabla.ocupado} motivoVisible={false} motivo={cambios[u.uid] === undefined || cambios[u.uid] === u.rol ? 'Cambie el rol para guardar' : undefined} onClick={() => asignar(u.uid)}>
                    Guardar rol
                  </Boton>
                  <BotonConfirmado texto="Quitar acceso" pregunta={`¿Quitar el acceso de ${correoDe(u)}?`} textoConfirmar="Sí, quitar" peligro chico onConfirmar={() => quitar(u.uid)} />
                </div>
              )
            }
          />
        )}
      </Seccion>
    </div>
  );
}
