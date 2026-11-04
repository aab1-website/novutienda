import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { Rol } from '../api/tipos.js';
import { Alerta, BotonConfirmado, Cargando, ErrorCarga, Selector, Seccion, Vacio } from '../ui/comun.js';
import { useApp } from '../ui/contexto.js';
import { useAccion, useCarga } from '../ui/hooks.js';

const ROL_TEXTO: Record<Rol, string> = { caj: 'Vendedor', sup: 'Supervisor', adm: 'Administrador' };

export function PantallaUsuarios(): JSX.Element {
  const { api, usuario } = useApp();
  const lista = useCarga(() => api.llamar('listarUsuarios', {}), []);
  const accion = useAccion();
  const [cambios, setCambios] = useState<Record<string, Rol>>({});
  const [ok, setOk] = useState<string | null>(null);

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
      <Seccion titulo={`Personas con acceso (${lista.datos?.length ?? 0} de 3)`}>
        <p class="texto-suave">El plan incluye tres usuarios. Solo el propietario de la plataforma puede cambiar o quitar a un administrador.</p>
        {lista.cargando && <Cargando />}
        {lista.error && <ErrorCarga error={lista.error} reintentar={lista.recargar} />}
        {accion.error && <Alerta>{accion.error}</Alerta>}
        {ok && <Alerta tipo="ok">{ok}</Alerta>}
        {lista.datos && lista.datos.length === 0 && <Vacio titulo="No hay usuarios" />}
        {lista.datos && lista.datos.length > 0 && (
          <table class="tabla">
            <caption class="solo-lectores">Usuarios del negocio</caption>
            <thead><tr><th scope="col">Correo</th><th scope="col">Rol</th><th scope="col"><span class="solo-lectores">Acciones</span></th></tr></thead>
            <tbody>
              {lista.datos.map((u) => (
                <tr key={u.uid}>
                  <th scope="row">{u.correo}{u.uid === usuario.uid ? ' (usted)' : ''}</th>
                  <td>
                    {u.rol === 'adm' ? (
                      ROL_TEXTO.adm
                    ) : (
                      <Selector etiqueta={`Rol de ${u.correo}`} valor={cambios[u.uid] ?? u.rol} onCambio={(v) => setCambios({ ...cambios, [u.uid]: v as Rol })} opciones={(['caj', 'sup'] as const).map((r) => ({ valor: r, texto: ROL_TEXTO[r] }))} />
                    )}
                  </td>
                  <td>
                    {u.rol !== 'adm' && (
                      <div class="fila">
                        <button type="button" class="boton boton-secundario boton-chico" disabled={cambios[u.uid] === undefined || cambios[u.uid] === u.rol || accion.ocupado} onClick={() => asignar(u.uid)}>
                          Guardar rol
                        </button>
                        <BotonConfirmado texto="Quitar acceso" pregunta={`¿Quitar el acceso de ${u.correo}?`} textoConfirmar="Sí, quitar" peligro chico onConfirmar={() => quitar(u.uid)} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Seccion>
    </div>
  );
}
