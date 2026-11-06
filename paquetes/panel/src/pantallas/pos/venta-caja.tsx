import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { nuevoId } from '../../api/cliente.js';
import { MONEDAS, type Moneda, type TurnoPos } from '../../api/tipos.js';
import { Alerta, Boton, Campo, Cargando, ErrorCarga, Selector, Seccion, Vacio, fechaHora } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { efectivoEsperado, TOTALES_VACIOS } from './arqueo.js';
import { formatearMonto, textoACentavos } from '../../util/dinero.js';

export function VentaCaja({ turno, alCambiar }: { turno: TurnoPos; alCambiar: () => void }): JSX.Element {
  const { api } = useApp();
  const accion = useAccion();
  const [tipo, setTipo] = useState<'ingreso' | 'egreso'>('egreso');
  const [moneda, setMoneda] = useState<Moneda>('BOB');
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [comprobante, setComprobante] = useState('');
  const [ok, setOk] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(nuevoId);
  const movs = useCarga(() => api.llamar('listarMovimientosCaja', { turnoId: turno.turnoId }), [turno.turnoId]);
  const c = textoACentavos(monto);
  const disponible = efectivoEsperado(turno.apertura[moneda] ?? 0, turno.totales[moneda] ?? TOTALES_VACIOS);

  const enviar = (e: Event): void => {
    e.preventDefault();
    if (c === null || c <= 0) return;
    void accion.ejecutar(async () => {
      await api.llamar('registrarMovimientoCaja', { requestId, movimiento: { tipo, moneda, monto: c, motivo: motivo.trim(), ...(comprobante.trim() !== '' ? { comprobante: comprobante.trim() } : {}) } });
      setOk(`${tipo === 'ingreso' ? 'Ingreso' : 'Egreso'} registrado.`);
      setMonto('');
      setMotivo('');
      setComprobante('');
      setRequestId(nuevoId());
      movs.recargar();
      alCambiar();
    });
  };

  return (
    <div>
      <Seccion titulo="Ingresos y egresos de caja">
        <form class="formulario" onSubmit={enviar} noValidate>
          <div class="cuadricula">
            <Selector etiqueta="Tipo" valor={tipo} onCambio={(v) => setTipo(v as 'ingreso' | 'egreso')} opciones={[{ valor: 'egreso', texto: 'Egreso (sale dinero)' }, { valor: 'ingreso', texto: 'Ingreso (entra dinero)' }]} />
            <Selector etiqueta="Moneda" valor={moneda} onCambio={(v) => setMoneda(v as Moneda)} opciones={MONEDAS.map((m) => ({ valor: m, texto: m }))} />
            <Campo etiqueta="Monto" valor={monto} onInput={setMonto} inputMode="decimal" requerido />
            <Campo etiqueta="Motivo" valor={motivo} onInput={setMotivo} requerido />
            <Campo etiqueta="Comprobante (opcional)" valor={comprobante} onInput={setComprobante} />
          </div>
          <p class="texto-suave">Efectivo disponible en {moneda}: {formatearMonto(disponible, moneda)}</p>
          {tipo === 'egreso' && c !== null && c > disponible && <Alerta>El egreso es mayor que el efectivo disponible en esa moneda.</Alerta>}
          {accion.error && <Alerta>{accion.error}</Alerta>}
          {ok && <Alerta tipo="ok">{ok}</Alerta>}
          <Boton tipo="submit" ocupado={accion.ocupado} deshabilitado={c === null || c <= 0 || motivo.trim() === ''}>
            Registrar
          </Boton>
        </form>
      </Seccion>
      <Seccion titulo="Movimientos del turno">
        {movs.cargando && <Cargando />}
        {movs.error && <ErrorCarga error={movs.error} reintentar={movs.recargar} />}
        {movs.datos && movs.datos.length === 0 && <Vacio titulo="Todavía no hay ingresos ni egresos en este turno" />}
        {movs.datos && movs.datos.length > 0 && (
          <table class="tabla">
            <caption class="solo-lectores">Ingresos y egresos del turno</caption>
            <thead>
              <tr><th scope="col">Hora</th><th scope="col">Tipo</th><th scope="col">Motivo</th><th scope="col" class="num">Monto</th></tr>
            </thead>
            <tbody>
              {movs.datos.map((m) => (
                <tr key={m.requestId}>
                  <td>{fechaHora(m.creadoEnMs)}</td>
                  <td>{m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}</td>
                  <td>{m.motivo}</td>
                  <td class="num">{formatearMonto(m.monto, m.moneda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Seccion>
    </div>
  );
}

export function VentaCreditos({ alCambiar }: { alCambiar: () => void }): JSX.Element {
  const { api } = useApp();
  const creditos = useCarga(() => api.llamar('listarCreditos', {}), []);
  const accion = useAccion();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [medio, setMedio] = useState<'efectivo' | 'qr' | 'transferencia'>('efectivo');
  const [monto, setMonto] = useState('');
  const [referencia, setReferencia] = useState('');
  const [requestId, setRequestId] = useState(nuevoId);
  const [ok, setOk] = useState<string | null>(null);

  const cobrar = (ventaId: string): void => {
    const c = textoACentavos(monto);
    if (c === null || c <= 0) return;
    void accion.ejecutar(async () => {
      await api.llamar('cobrarCredito', { requestId, ventaId, cobro: { medio, monto: c, ...(referencia.trim() !== '' ? { referencia: referencia.trim() } : {}) } });
      setOk('Cobro registrado en su turno abierto.');
      setAbierto(null);
      setMonto('');
      setReferencia('');
      setRequestId(nuevoId());
      creditos.recargar();
      alCambiar();
    });
  };

  return (
    <Seccion titulo="Cobro de créditos">
      <p class="texto-suave">El cobro entra al turno abierto en que se recibe. Si no tiene un turno abierto, ábralo primero en «Terminal».</p>
      {ok && <Alerta tipo="ok">{ok}</Alerta>}
      {creditos.cargando && <Cargando />}
      {creditos.error && <ErrorCarga error={creditos.error} reintentar={creditos.recargar} />}
      {creditos.datos && creditos.datos.filter((c) => c.estado === 'pendiente').length === 0 && <Vacio titulo="No hay créditos pendientes" />}
      <ul class="lista-simple">
        {(creditos.datos ?? []).filter((c) => c.estado === 'pendiente').map((c) => (
          <li key={c.ventaId} class="tarjeta-interna">
            <div class="fila fila-entre">
              <strong>{c.deudor}</strong>
              <span>Saldo {formatearMonto(c.saldo, c.moneda)} de {formatearMonto(c.monto, c.moneda)}</span>
            </div>
            {abierto === c.ventaId ? (
              <form class="formulario" onSubmit={(e) => { e.preventDefault(); cobrar(c.ventaId); }} noValidate>
                <div class="cuadricula">
                  <Selector etiqueta="Medio" valor={medio} onCambio={(v) => setMedio(v as typeof medio)} opciones={[{ valor: 'efectivo', texto: 'Efectivo' }, { valor: 'qr', texto: 'QR (registro manual)' }, { valor: 'transferencia', texto: 'Transferencia' }]} />
                  <Campo etiqueta="Monto" valor={monto} onInput={setMonto} inputMode="decimal" requerido />
                  {medio === 'qr' && <Campo etiqueta="Referencia del QR" valor={referencia} onInput={setReferencia} requerido />}
                </div>
                {accion.error && <Alerta>{accion.error}</Alerta>}
                <div class="fila">
                  <Boton tipo="submit" chico ocupado={accion.ocupado}>Registrar cobro</Boton>
                  <Boton chico variante="secundario" onClick={() => setAbierto(null)}>Cancelar</Boton>
                </div>
              </form>
            ) : (
              <Boton chico variante="secundario" onClick={() => { setAbierto(c.ventaId); setMonto(String(c.saldo / 100).replace('.', ',')); accion.limpiar(); }}>
                Cobrar
              </Boton>
            )}
          </li>
        ))}
      </ul>
    </Seccion>
  );
}
