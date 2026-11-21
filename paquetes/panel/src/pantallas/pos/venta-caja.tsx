import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { nuevoId } from '../../api/cliente.js';
import type { TurnoPos } from '../../api/tipos.js';
import { Alerta, Boton, Campo, Cargando, ErrorCarga, Selector, Seccion, Vacio, fechaHora } from '../../ui/comun.js';
import { useConfiguracionComercial } from '../../ui/comercial.js';
import { Tabla } from '../../ui/tabla.js';
import { useApp } from '../../ui/contexto.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { efectivoEsperado, TOTALES_VACIOS } from './arqueo.js';
import { formatearMonto, textoACentavos } from '../../util/dinero.js';

export function VentaCaja({ turno, alCambiar }: { turno: TurnoPos; alCambiar: () => void }): JSX.Element {
  const comercial = useConfiguracionComercial();
  if (comercial.estado === 'cargando') return <Cargando />;
  if (comercial.estado === 'error') return <Alerta>{comercial.mensaje}</Alerta>;
  const monedas = comercial.comercial.monedasCaja;
  if (monedas.length === 0) return <Alerta>El comercio no tiene monedas de caja declaradas.</Alerta>;
  return <VentaCajaLista turno={turno} alCambiar={alCambiar} monedas={monedas} />;
}

function VentaCajaLista({ turno, alCambiar, monedas }: { turno: TurnoPos; alCambiar: () => void; monedas: readonly string[] }): JSX.Element {
  const { api } = useApp();
  const accion = useAccion();
  const [tipo, setTipo] = useState<'ingreso' | 'egreso'>('egreso');
  const [moneda, setMoneda] = useState<string>(monedas[0] ?? '');
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [comprobante, setComprobante] = useState('');
  const [ok, setOk] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(nuevoId);
  const movs = useCarga(() => api.llamar('listarMovimientosCaja', { turnoId: turno.turnoId }), [turno.turnoId]);
  const c = textoACentavos(monto);
  const errorMonto = monto.trim() === '' ? undefined : c === null ? `El monto «${monto.trim()}» no es válido: escriba solo el número, por ejemplo 20 o 20,50.` : c <= 0 ? 'El monto debe ser mayor a cero.' : undefined;
  const motivoNoRegistrar = monto.trim() === '' ? 'Escriba el monto.' : errorMonto ?? (motivo.trim() === '' ? 'Escriba el motivo.' : undefined);
  const disponible = efectivoEsperado(turno.apertura[moneda] ?? 0, turno.totales[moneda] ?? TOTALES_VACIOS);

  const enviar = (e: Event): void => {
    e.preventDefault();
    if (c === null || c <= 0 || motivoNoRegistrar !== undefined) return;
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
      <Seccion titulo="Ingresos y egresos excepcionales">
        <p class="texto-suave">Dinero que entra o sale de la caja sin ser una venta (por ejemplo, cambio que se trae o un gasto menor). Las ventas se ven en «Ventas y anulaciones» y en «Cierre de turno».</p>
        <form class="formulario" onSubmit={enviar} noValidate>
          <div class="cuadricula">
            <Selector etiqueta="Tipo" valor={tipo} onCambio={(v) => setTipo(v as 'ingreso' | 'egreso')} opciones={[{ valor: 'egreso', texto: 'Egreso (sale dinero)' }, { valor: 'ingreso', texto: 'Ingreso (entra dinero)' }]} />
            <Selector etiqueta="Moneda" valor={moneda} onCambio={(v) => setMoneda(v)} opciones={monedas.map((m) => ({ valor: m, texto: m }))} />
            <Campo etiqueta="Monto" valor={monto} onInput={setMonto} inputMode="decimal" requerido error={errorMonto} />
            <Campo etiqueta="Motivo" valor={motivo} onInput={setMotivo} requerido />
            <Campo etiqueta="Comprobante (opcional)" valor={comprobante} onInput={setComprobante} />
          </div>
          <p class="texto-suave">Efectivo disponible en {moneda}: {formatearMonto(disponible, moneda)}</p>
          {tipo === 'egreso' && c !== null && c > disponible && <Alerta>El egreso es mayor que el efectivo disponible en esa moneda.</Alerta>}
          {accion.error && <Alerta>{accion.error}</Alerta>}
          {ok && <Alerta tipo="ok">{ok}</Alerta>}
          <Boton tipo="submit" ocupado={accion.ocupado} motivo={motivoNoRegistrar}>
            Registrar
          </Boton>
        </form>
      </Seccion>
      <Seccion titulo="Movimientos del turno">
        {movs.cargando && <Cargando />}
        {movs.error && <ErrorCarga error={movs.error} reintentar={movs.recargar} />}
        {movs.datos && movs.datos.length === 0 && <Vacio titulo="Todavía no hay ingresos ni egresos excepcionales en este turno" />}
        {movs.datos && movs.datos.length > 0 && (
          <Tabla
            titulo="Ingresos y egresos excepcionales del turno"
            vistaCelular="tarjetas"
            filas={movs.datos}
            clave={(m) => m.requestId}
            columnas={[
              { id: 'hora', titulo: 'Hora', valor: (m) => m.creadoEnMs, celda: (m) => fechaHora(m.creadoEnMs) },
              { id: 'tipo', titulo: 'Tipo', valor: (m) => (m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso') },
              { id: 'motivo', titulo: 'Motivo', valor: (m) => m.motivo },
              { id: 'monto', titulo: 'Monto', valor: (m) => m.monto, celda: (m) => formatearMonto(m.monto, m.moneda), numerica: true },
            ]}
          />
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
