import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { AprobacionPos, VentaPos } from '../../api/tipos.js';
import { Alerta, Boton, Campo, Cargando, ErrorCarga, Pestanas, Seccion, Vacio, fechaHora } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { Dialogo } from '../../ui/dialogo.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { formatearMonto } from '../../util/dinero.js';

/** Cada cuántos milisegundos se vuelven a consultar las listas por aprobar. */
export const MS_SONDEO_LISTAS = 10_000;

/** El rechazo admite un motivo OPCIONAL (decisión del dueño): se envía solo si se escribió algo. */
export const RECHAZO_CON_MOTIVO = true;

const resumenDe = (a: AprobacionPos): string => `${a.tipo === 'descuento' ? 'Descuento' : `Crédito para ${a.deudor ?? ''}`} hasta ${formatearMonto(a.monto, a.moneda)}`;

function DialogoResolucion({ a, decision, correo, conMotivo, alCerrar, alResolver, enProceso }: {
  a: AprobacionPos;
  decision: 'aprobar' | 'rechazar';
  correo: string;
  conMotivo: boolean;
  alCerrar: () => void;
  alResolver: () => void;
  /** Avisa a la lista cuándo esta solicitud está procesándose, para que solo su fila lo diga. */
  enProceso: (v: boolean) => void;
}): JSX.Element {
  const { api } = useApp();
  const accion = useAccion();
  const [motivoRechazo, setMotivoRechazo] = useState('');
  const aprueba = decision === 'aprobar';
  const confirmar = (): void => {
    enProceso(true);
    void accion
      .ejecutar(async () => {
        const motivo = motivoRechazo.trim();
        await api.llamar('resolverAprobacion', { aprobacionId: a.aprobacionId, decision, ...(!aprueba && conMotivo && motivo !== '' ? { motivo } : {}) });
        return true;
      }, { exito: aprueba ? 'Solicitud aprobada.' : 'Solicitud rechazada.', error: 'local' })
      .then((ok) => {
        enProceso(false);
        if (ok === true) alResolver();
      });
  };
  return (
    <Dialogo
      variante="centro"
      titulo={aprueba ? '¿Aprobar esta solicitud?' : '¿Rechazar esta solicitud?'}
      descripcion="Revise antes de confirmar."
      foco="seguro"
      onCerrar={alCerrar}
      pie={
        <>
          <button type="button" class="boton boton-secundario" data-seguro onClick={alCerrar}>Volver</button>
          <Boton variante={aprueba ? 'cta' : 'peligro'} onClick={confirmar} ocupado={accion.ocupado}>{aprueba ? 'Sí, aprobar' : 'Sí, rechazar'}</Boton>
        </>
      }
    >
      <ul class="lista-simple" data-prueba="resumen-aprobacion">
        <li>{resumenDe(a)}</li>
        <li>Motivo: {a.motivo}</li>
        <li>Lo pide: {correo}</li>
        <li>Solicitado: {fechaHora(a.solicitadoEnMs)}</li>
      </ul>
      {!aprueba && conMotivo && <Campo etiqueta="Motivo del rechazo (opcional)" valor={motivoRechazo} onInput={setMotivoRechazo} tope={200} />}
      {accion.error && <Alerta>{accion.error}</Alerta>}
    </Dialogo>
  );
}

function Solicitudes(): JSX.Element {
  const { api, usuario } = useApp();
  const lista = useCarga(() => api.llamar('listarAprobaciones', { estado: 'pendiente' }), [], MS_SONDEO_LISTAS);
  const usuarios = useCarga(() => api.llamar('listarUsuarios', {}), []);
  const [abierta, setAbierta] = useState<{ a: AprobacionPos; decision: 'aprobar' | 'rechazar' } | null>(null);
  // Solo la fila cuya resolución está en curso dice «Procesando…».
  const [enCurso, setEnCurso] = useState<{ id: string; decision: 'aprobar' | 'rechazar' } | null>(null);
  const correoDe = (uid: string): string => usuarios.datos?.find((u) => u.uid === uid)?.correo || 'usuario no identificado';
  const cerrar = (): void => setAbierta(null);
  return (
    <Seccion titulo="Descuentos y créditos por aprobar" acciones={<Boton chico variante="secundario" onClick={lista.recargar}>Actualizar</Boton>}>
      <p class="texto-suave">La lista se actualiza sola cada 10 segundos.</p>
      {lista.cargando && <Cargando />}
      {lista.error && <ErrorCarga error={lista.error} reintentar={lista.recargar} />}
      {lista.datos && lista.datos.length === 0 && <Vacio titulo="No hay solicitudes pendientes" />}
      <ul class="lista-simple">
        {(lista.datos ?? []).map((a) => (
          <li key={a.aprobacionId} class="tarjeta-interna">
            <div class="fila fila-entre">
              <strong>{resumenDe(a)}</strong>
              <span class="texto-suave">{fechaHora(a.solicitadoEnMs)}</span>
            </div>
            <p>Motivo: {a.motivo}</p>
            <p class="texto-suave">Lo pide: {correoDe(a.solicitadoPor)}</p>
            {a.solicitadoPor === usuario.uid ? (
              <p class="texto-suave">Es su propia solicitud: la debe aprobar otra persona.</p>
            ) : (
              <div class="fila">
                <Boton chico onClick={() => setAbierta({ a, decision: 'aprobar' })} ocupado={enCurso?.id === a.aprobacionId && enCurso.decision === 'aprobar'} etiqueta={`Aprobar solicitud de ${a.tipo}`}>Aprobar</Boton>
                <Boton chico variante="secundario" onClick={() => setAbierta({ a, decision: 'rechazar' })} ocupado={enCurso?.id === a.aprobacionId && enCurso.decision === 'rechazar'} etiqueta={`Rechazar solicitud de ${a.tipo}`}>Rechazar</Boton>
              </div>
            )}
          </li>
        ))}
      </ul>
      {abierta && <DialogoResolucion a={abierta.a} decision={abierta.decision} correo={correoDe(abierta.a.solicitadoPor)} conMotivo={RECHAZO_CON_MOTIVO} alCerrar={cerrar} alResolver={() => { cerrar(); lista.recargar(); }} enProceso={(v) => setEnCurso(v ? { id: abierta.a.aprobacionId, decision: abierta.decision } : null)} />}
    </Seccion>
  );
}

function FilaAnulacion({ v, ocupado, aprobar }: { v: VentaPos; ocupado: boolean; aprobar: (v: VentaPos, motivo: string) => void }): JSX.Element {
  const { usuario } = useApp();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const propia = v.solicitudAnulacion?.por === usuario.uid || v.cajeroUid === usuario.uid;
  return (
    <li class="tarjeta-interna">
      <div class="fila fila-entre">
        <strong>Recibo {v.serie}-{String(v.receiptNo).padStart(6, '0')} · {formatearMonto(v.total, v.moneda)}</strong>
        <span class="texto-suave">{v.solicitudAnulacion ? fechaHora(v.solicitudAnulacion.enMs) : ''}</span>
      </div>
      <p>Motivo: {v.solicitudAnulacion?.motivo}</p>
      {propia ? (
        <p class="texto-suave">La vendió o la solicitó usted: la debe aprobar otra persona.</p>
      ) : !abierto ? (
        <Boton chico variante="peligro" onClick={() => setAbierto(true)} etiqueta="Aprobar anulación">Aprobar anulación</Boton>
      ) : (
        <form class="formulario" onSubmit={(e) => { e.preventDefault(); if (motivo.trim() !== '') aprobar(v, motivo.trim()); }} noValidate>
          <p>Se revierte el stock y se reembolsa lo cobrado. Indique el motivo de su aprobación.</p>
          <Campo etiqueta="Motivo de la aprobación" valor={motivo} onInput={setMotivo} requerido />
          <div class="fila">
            <Boton tipo="submit" chico variante="peligro" ocupado={ocupado} deshabilitado={motivo.trim() === ''}>Sí, anular la venta</Boton>
            <Boton chico variante="secundario" onClick={() => setAbierto(false)}>Cancelar</Boton>
          </div>
        </form>
      )}
    </li>
  );
}

function Anulaciones(): JSX.Element {
  const { api } = useApp();
  const lista = useCarga(() => api.llamar('listarVentas', { conSolicitudAnulacion: true }), [], MS_SONDEO_LISTAS);
  const turno = useCarga(() => api.llamar('turnoActual', {}), []);
  const accion = useAccion();
  const [resultado, setResultado] = useState<string | null>(null);
  const aprobar = (v: VentaPos, motivo: string): void => {
    void accion.ejecutar(async () => {
      const r = await api.llamar('aprobarAnulacion', { ventaId: v.ventaId, motivo });
      setResultado(
        r.reembolsos.length === 0
          ? 'Anulación aprobada. No hubo cobros que reembolsar.'
          : `Anulación aprobada. Reembolsos: ${r.reembolsos.map((x) => `${x.medio} ${formatearMonto(x.monto, x.moneda)}`).join(', ')}.`,
      );
      lista.recargar();
    });
  };
  return (
    <Seccion titulo="Anulaciones solicitadas" acciones={<Boton chico variante="secundario" onClick={lista.recargar}>Actualizar</Boton>}>
      <p class="texto-suave">La lista se actualiza sola cada 10 segundos. El reembolso se devuelve por los medios con que se cobró y entra en su turno abierto. El efectivo sale de la caja de esa moneda.</p>
      {turno.datos === null && <Alerta tipo="info">No tiene un turno abierto: ábralo en «Venta» para poder aprobar anulaciones con reembolso.</Alerta>}
      {resultado && <Alerta tipo="ok">{resultado}</Alerta>}
      {accion.error && <Alerta>{accion.error}</Alerta>}
      {lista.cargando && <Cargando />}
      {lista.error && <ErrorCarga error={lista.error} reintentar={lista.recargar} />}
      {lista.datos && lista.datos.length === 0 && <Vacio titulo="No hay anulaciones pendientes" />}
      <ul class="lista-simple">
        {(lista.datos ?? []).map((v) => (
          <FilaAnulacion key={v.ventaId} v={v} ocupado={accion.ocupado} aprobar={aprobar} />
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
