import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { AprobacionPos, VentaPos } from '../api/tipos.js';
import { Alerta, Boton, BotonConfirmado, Cargando, ErrorCarga, Pestanas, Seccion, Vacio, fechaHora } from '../ui/comun.js';
import { useApp } from '../ui/contexto.js';
import { useAccion, useCarga } from '../ui/hooks.js';
import { formatearMonto } from '../util/dinero.js';

function Solicitudes(): JSX.Element {
  const { api, usuario } = useApp();
  const lista = useCarga(() => api.llamar('listarAprobaciones', { estado: 'pendiente' }), []);
  const accion = useAccion();
  const resolver = (a: AprobacionPos, decision: 'aprobar' | 'rechazar'): void => {
    void accion.ejecutar(async () => {
      await api.llamar('resolverAprobacion', { aprobacionId: a.aprobacionId, decision });
      lista.recargar();
    });
  };
  return (
    <Seccion titulo="Descuentos y créditos por aprobar">
      {lista.cargando && <Cargando />}
      {lista.error && <ErrorCarga error={lista.error} reintentar={lista.recargar} />}
      {accion.error && <Alerta>{accion.error}</Alerta>}
      {lista.datos && lista.datos.length === 0 && <Vacio titulo="No hay solicitudes pendientes" />}
      <ul class="lista-simple">
        {(lista.datos ?? []).map((a) => (
          <li key={a.aprobacionId} class="tarjeta-interna">
            <div class="fila fila-entre">
              <strong>{a.tipo === 'descuento' ? 'Descuento' : `Crédito para ${a.deudor ?? ''}`} hasta {formatearMonto(a.monto, a.moneda)}</strong>
              <span class="texto-suave">{fechaHora(a.solicitadoEnMs)}</span>
            </div>
            <p>Motivo: {a.motivo}</p>
            {a.solicitadoPor === usuario.uid ? (
              <p class="texto-suave">Es su propia solicitud: la debe aprobar otra persona.</p>
            ) : (
              <div class="fila">
                <Boton chico onClick={() => resolver(a, 'aprobar')} ocupado={accion.ocupado} etiqueta={`Aprobar solicitud de ${a.tipo}`}>Aprobar</Boton>
                <Boton chico variante="secundario" onClick={() => resolver(a, 'rechazar')} ocupado={accion.ocupado} etiqueta={`Rechazar solicitud de ${a.tipo}`}>Rechazar</Boton>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Seccion>
  );
}

function Anulaciones(): JSX.Element {
  const { api, usuario } = useApp();
  const lista = useCarga(() => api.llamar('listarVentas', { conSolicitudAnulacion: true }), []);
  const turno = useCarga(() => api.llamar('turnoActual', {}), []);
  const accion = useAccion();
  const [resultado, setResultado] = useState<string | null>(null);
  const aprobar = (v: VentaPos): void => {
    void accion.ejecutar(async () => {
      const r = await api.llamar('aprobarAnulacion', { ventaId: v.ventaId });
      setResultado(
        r.reembolsos.length === 0
          ? 'Anulación aprobada. No hubo cobros que reembolsar.'
          : `Anulación aprobada. Reembolsos: ${r.reembolsos.map((x) => `${x.medio} ${formatearMonto(x.monto, x.moneda)}`).join(', ')}.`,
      );
      lista.recargar();
    });
  };
  return (
    <Seccion titulo="Anulaciones solicitadas">
      <p class="texto-suave">El reembolso se devuelve por los medios con que se cobró y entra en su turno abierto. El efectivo sale de la caja de esa moneda.</p>
      {turno.datos === null && <Alerta tipo="info">No tiene un turno abierto: ábralo en «Venta» para poder aprobar anulaciones con reembolso.</Alerta>}
      {resultado && <Alerta tipo="ok">{resultado}</Alerta>}
      {accion.error && <Alerta>{accion.error}</Alerta>}
      {lista.cargando && <Cargando />}
      {lista.error && <ErrorCarga error={lista.error} reintentar={lista.recargar} />}
      {lista.datos && lista.datos.length === 0 && <Vacio titulo="No hay anulaciones pendientes" />}
      <ul class="lista-simple">
        {(lista.datos ?? []).map((v) => (
          <li key={v.ventaId} class="tarjeta-interna">
            <div class="fila fila-entre">
              <strong>Recibo {v.serie}-{String(v.receiptNo).padStart(6, '0')} · {formatearMonto(v.total, v.moneda)}</strong>
              <span class="texto-suave">{v.solicitudAnulacion ? fechaHora(v.solicitudAnulacion.enMs) : ''}</span>
            </div>
            <p>Motivo: {v.solicitudAnulacion?.motivo}</p>
            {v.solicitudAnulacion?.por === usuario.uid ? (
              <p class="texto-suave">La solicitó usted: la debe aprobar otra persona.</p>
            ) : (
              <BotonConfirmado texto="Aprobar anulación" pregunta="¿Aprobar la anulación? Se revierte el stock y se reembolsa lo cobrado." textoConfirmar="Sí, anular la venta" peligro chico onConfirmar={() => aprobar(v)} deshabilitado={accion.ocupado} />
            )}
          </li>
        ))}
      </ul>
    </Seccion>
  );
}

export function PantallaAprobaciones({ sub }: { sub: string }): JSX.Element {
  const actual = sub === 'anulaciones' ? 'anulaciones' : 'descuentos';
  return (
    <div>
      <h1>Aprobaciones</h1>
      <Pestanas etiqueta="Tipos de aprobación" base="aprobaciones" actual={actual} items={[{ id: 'descuentos', titulo: 'Descuentos y créditos' }, { id: 'anulaciones', titulo: 'Anulaciones' }]} />
      {actual === 'descuentos' ? <Solicitudes /> : <Anulaciones />}
    </div>
  );
}
