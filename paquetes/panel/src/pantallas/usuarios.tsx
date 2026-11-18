import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { LIMITES_PANEL, type Rol } from '../api/tipos.js';
import { Alerta, Boton, BotonConfirmado, Campo, Cargando, ErrorCarga, Selector, Seccion } from '../ui/comun.js';
import { useApp } from '../ui/contexto.js';
import { useAccion, useCarga } from '../ui/hooks.js';
import { Tabla } from '../ui/tabla.js';

const ROL_TEXTO: Record<Rol, string> = { caj: 'Vendedor', sup: 'Supervisor', adm: 'Administrador' };

const SIN_CORREO = 'Sin correo registrado';
/** El servidor puede devolver una cuenta sin correo: nunca se pinta «null» ni se rompe al comparar. */
const correoDe = (u: { readonly correo?: unknown }): string => (typeof u.correo === 'string' && u.correo.trim() !== '' ? u.correo : SIN_CORREO);

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
  const [yaTiene, setYaTiene] = useState<string | null>(null);
  // Las invitaciones pendientes ocupan un cupo del plan, pero aún no son personas con acceso.
  const miembros = lista.datos?.filter((u) => u.estado !== 'invitado');
  const invitaciones = lista.datos?.filter((u) => u.estado === 'invitado');
  const cantidad = lista.datos?.length ?? 0;
  const lleno = lista.datos !== undefined && cantidad >= tope;
  const conAcceso = miembros?.length ?? 0;
  const pendientesN = invitaciones?.length ?? 0;
  // Sin cifra engañosa: las personas con acceso y las invitaciones pendientes se cuentan por separado, ambas dentro del plan.
  const tituloAcceso = pendientesN === 0 ? `Personas con acceso (${conAcceso} de ${tope})` : `Personas con acceso (${conAcceso}) e invitaciones pendientes (${pendientesN}), de ${tope} del plan`;
  const pendientes = useAccion();
  // Con el plan lleno solo se admite un correo que ya tiene invitación pendiente: cambiar su rol no ocupa otro cupo.
  const correoLimpio = correo.trim().toLowerCase();
  const sinCupo = lleno && invitaciones?.some((u) => correoDe(u).toLowerCase() === correoLimpio) !== true;

  // Un solo camino: siempre se invita. Solo se evita llamar al servidor si la persona ya figura con acceso en la lista que el administrador ya ve.
  const agregar = (): void => {
    const limpio = correo.trim().toLowerCase();
    if (limpio === '') return;
    if (miembros?.some((u) => correoDe(u).toLowerCase() === limpio) === true) {
      setYaTiene(limpio);
      return;
    }
    setYaTiene(null);
    void alta.ejecutar(async () => {
      try {
        await api.llamar('invitarUsuario', { correo: limpio, rol: rolNuevo });
      } finally {
        lista.recargar(); // aunque falle el correo, la invitación ya quedó registrada
      }
      setCorreo('');
    }, { exito: `Listo. Enviamos un correo a ${limpio}. Tendrá el rol de ${ROL_TEXTO[rolNuevo].toLowerCase()} cuando inicie sesión.`, error: 'ambos' });
  };
  const reenviar = (uid: string, correoDeLaInvitacion: string): void => {
    void pendientes.ejecutar(async () => {
      try {
        await api.llamar('reenviarInvitacion', { uid, correo: correoDeLaInvitacion });
      } finally {
        lista.recargar();
      }
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
      <Seccion titulo="Agregar a una persona">
        <p class="texto-suave">A la persona le llega un correo de Firebase para elegir su contraseña o restablecerla, según tenga o no cuenta. El rol se activa cuando inicia sesión. La invitación ocupa un cupo del plan y vence a los 7 días.</p>
        {lleno && <Alerta tipo="info">El plan incluye {tope} usuarios y ya están todos ocupados. Para agregar a otra persona, quite primero el acceso de alguien o anule una invitación.</Alerta>}
        <form class="formulario" onSubmit={(e) => { e.preventDefault(); if (!sinCupo) agregar(); }} noValidate>
          <Campo etiqueta="Correo de la persona" tipo="email" inputMode="email" autocompletar="off" valor={correo} onInput={(v) => { setCorreo(v); setYaTiene(null); }} />
          <Selector etiqueta="Rol de la persona" valor={rolNuevo} onCambio={(v) => setRolNuevo(v as Rol)} opciones={ROLES_INVITABLES.map((r) => ({ valor: r, texto: ROL_TEXTO[r] }))} />
          {rolNuevo === 'adm' && <Alerta tipo="info">Un administrador solo lo puede quitar el propietario de la plataforma.</Alerta>}
          <div class="fila">
            <Boton tipo="submit" ocupado={alta.ocupado} motivo={sinCupo ? 'El plan no tiene cupos libres: anule una invitación o quite un acceso' : correo.trim() === '' ? 'Escriba el correo de la persona' : undefined}>Agregar</Boton>
          </div>
        </form>
        {alta.error && <Alerta>{alta.error}</Alerta>}
        {yaTiene !== null && <Alerta tipo="info">{yaTiene} ya tiene acceso. Cambie su rol en la tabla de abajo.</Alerta>}
        {pendientes.error && <Alerta>{pendientes.error}</Alerta>}
        {invitaciones !== undefined && invitaciones.length > 0 && <p class="texto-suave">Se activa cuando la persona inicia sesión.</p>}
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
      <Seccion titulo={tituloAcceso}>
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
