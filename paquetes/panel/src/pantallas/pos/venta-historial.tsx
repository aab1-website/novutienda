import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { VentaPos } from '../../api/tipos.js';
import { Alerta, Boton, Campo, Cargando, ErrorCarga, Seccion, Vacio, fechaHora } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { formatearMonto } from '../../util/dinero.js';

function Fila({ v, alCambiar }: { v: VentaPos; alCambiar: () => void }): JSX.Element {
  const { api, usuario } = useApp();
  const accion = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const numero = `${v.serie}-${String(v.receiptNo).padStart(6, '0')}`;
  const solicitar = (): void => {
    void accion.ejecutar(async () => {
      await api.llamar('solicitarAnulacion', { ventaId: v.ventaId, motivo: motivo.trim() });
      setAbierto(false);
      alCambiar();
    });
  };
  return (
    <tr>
      <th scope="row">{numero}</th>
      <td>{fechaHora(v.creadoEnMs)}</td>
      <td class="num">{formatearMonto(v.total, v.moneda)}</td>
      <td>
        {v.estado === 'anulada' ? 'Anulada' : v.solicitudAnulacion ? 'Anulación solicitada' : 'Confirmada'}
      </td>
      <td>
        {v.estado === 'confirmada' && !v.solicitudAnulacion && !abierto && (
          <Boton chico variante="secundario" onClick={() => setAbierto(true)} etiqueta={`Solicitar anulación de ${numero}`}>
            Solicitar anulación
          </Boton>
        )}
        {abierto && (
          <form class="formulario" onSubmit={(e) => { e.preventDefault(); solicitar(); }} noValidate>
            <Campo etiqueta="Motivo de la anulación" valor={motivo} onInput={setMotivo} requerido />
            {accion.error && <Alerta>{accion.error}</Alerta>}
            <div class="fila">
              <Boton tipo="submit" chico ocupado={accion.ocupado} deshabilitado={motivo.trim() === ''}>Enviar solicitud</Boton>
              <Boton chico variante="secundario" onClick={() => setAbierto(false)}>Cancelar</Boton>
            </div>
            <p class="texto-suave">{usuario.rol === 'caj' ? 'La aprobará un supervisor o administrador.' : 'La aprobará otra persona (supervisor o administrador).'}</p>
          </form>
        )}
        {v.solicitudAnulacion && v.estado === 'confirmada' && <span class="texto-suave">Motivo: {v.solicitudAnulacion.motivo}</span>}
      </td>
    </tr>
  );
}

export function VentaHistorial(): JSX.Element {
  const { api, usuario } = useApp();
  const ventas = useCarga(() => api.llamar('listarVentas', {}), []);
  return (
    <Seccion titulo={usuario.rol === 'caj' ? 'Mis ventas' : 'Ventas'}>
      {ventas.cargando && <Cargando />}
      {ventas.error && <ErrorCarga error={ventas.error} reintentar={ventas.recargar} />}
      {ventas.datos && ventas.datos.length === 0 && <Vacio titulo="Todavía no hay ventas" />}
      {ventas.datos && ventas.datos.length > 0 && (
        <table class="tabla">
          <caption class="solo-lectores">Ventas registradas</caption>
          <thead>
            <tr><th scope="col">Recibo</th><th scope="col">Fecha</th><th scope="col" class="num">Total</th><th scope="col">Estado</th><th scope="col">Anulación</th></tr>
          </thead>
          <tbody>
            {ventas.datos.map((v) => <Fila key={v.ventaId} v={v} alCambiar={ventas.recargar} />)}
          </tbody>
        </table>
      )}
    </Seccion>
  );
}
