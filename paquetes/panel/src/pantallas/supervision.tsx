import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { MONEDAS, type Moneda, type MontosPorMoneda, type TurnoPos } from '../api/tipos.js';
import { Alerta, BotonConfirmado, Boton, Campo, Cargando, ErrorCarga, Pestanas, Seccion, Vacio, fechaHora } from '../ui/comun.js';
import { useApp } from '../ui/contexto.js';
import { useAccion, useCarga } from '../ui/hooks.js';
import { monedasDelTurno, proyectarTurno } from '../util/arqueo.js';
import { aCsv, descargarTexto } from '../util/csv.js';
import { formatearMonto, textoACentavos } from '../util/dinero.js';


function TurnoVivo({ t, alCambiar }: { t: TurnoPos; alCambiar: () => void }): JSX.Element {
  const { api, usuario } = useApp();
  const accion = useAccion();
  const [motivo, setMotivo] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [textos, setTextos] = useState<Record<Moneda, string>>({ BOB: '', USD: '', ARS: '' });
  const proy = proyectarTurno(t);
  const monedas = monedasDelTurno(t);
  const contado: Partial<Record<Moneda, number>> = {};
  let falta = false;
  for (const m of monedas) {
    const c = textoACentavos(textos[m]);
    if (c === null) falta = true;
    else contado[m] = c;
  }
  return (
    <li class="tarjeta-interna">
      <div class="fila fila-entre">
        <strong>Turno de {t.cajeroUid}</strong>
        <span class="texto-suave">Abierto {fechaHora(t.abiertoEnMs)}</span>
      </div>
      <table class="tabla">
        <caption class="solo-lectores">Totales en vivo del turno</caption>
        <thead>
          <tr><th scope="col">Moneda</th><th scope="col" class="num">Efectivo esperado</th><th scope="col" class="num">QR</th><th scope="col" class="num">Transferencia</th><th scope="col" class="num">Crédito</th><th scope="col" class="num">Ingresos</th><th scope="col" class="num">Egresos</th></tr>
        </thead>
        <tbody>
          {MONEDAS.filter((m) => proy[m] !== undefined).map((m) => {
            const p = proy[m];
            if (p === undefined) return null;
            return (
              <tr key={m}>
                <th scope="row">{m}</th>
                <td class="num">{formatearMonto(p.efectivoEsperado, m)}</td>
                <td class="num">{formatearMonto(p.qr, m)}</td>
                <td class="num">{formatearMonto(p.transferencia, m)}</td>
                <td class="num">{formatearMonto(p.credito, m)}</td>
                <td class="num">{formatearMonto(p.ingresos, m)}</td>
                <td class="num">{formatearMonto(p.egresos, m)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {usuario.rol === 'adm' &&
        (abierto ? (
          <form class="formulario" onSubmit={(e) => e.preventDefault()} noValidate>
            <Campo etiqueta="Motivo del cierre forzado" valor={motivo} onInput={setMotivo} requerido />
            {monedas.map((m) => (
              <Campo key={m} etiqueta={`Efectivo contado en ${m}`} valor={textos[m]} onInput={(v) => setTextos({ ...textos, [m]: v })} inputMode="decimal" requerido />
            ))}
            {accion.error && <Alerta>{accion.error}</Alerta>}
            <div class="fila">
              <BotonConfirmado texto="Cerrar turno a la fuerza" pregunta="¿Cerrar este turno en nombre de su cajero?" peligro chico deshabilitado={falta || motivo.trim() === ''} onConfirmar={() => void accion.ejecutar(async () => { await api.llamar('cerrarTurnoForzado', { turnoId: t.turnoId, contado: contado as MontosPorMoneda, motivo: motivo.trim() }); alCambiar(); })} />
              <Boton chico variante="secundario" onClick={() => setAbierto(false)}>Cancelar</Boton>
            </div>
          </form>
        ) : (
          <Boton chico variante="secundario" onClick={() => setAbierto(true)}>Cierre forzado…</Boton>
        ))}
    </li>
  );
}

function EnVivo(): JSX.Element {
  const { api } = useApp();
  const turnos = useCarga(() => api.llamar('listarTurnos', { estado: 'abierto' }), [], 10_000);
  return (
    <Seccion titulo="Cajas abiertas (se actualiza cada 10 segundos)" acciones={<Boton chico variante="secundario" onClick={turnos.recargar}>Actualizar</Boton>}>
      {turnos.cargando && <Cargando />}
      {turnos.error && <ErrorCarga error={turnos.error} reintentar={turnos.recargar} />}
      {turnos.datos && turnos.datos.length === 0 && <Vacio titulo="No hay turnos abiertos" />}
      <ul class="lista-simple">{(turnos.datos ?? []).map((t) => <TurnoVivo key={t.turnoId} t={t} alCambiar={turnos.recargar} />)}</ul>
    </Seccion>
  );
}

function Auditoria(): JSX.Element {
  const { api } = useApp();
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [accion, setAccion] = useState('');
  const [filtro, setFiltro] = useState({});
  const lista = useCarga(() => api.llamar('listarAuditoria', filtro), [filtro]);
  const ventas = useAccion();
  const exportar = (): void => {
    const filas = (lista.datos ?? []).map((a) => [a.fecha, a.uid, a.rol, a.accion, a.ruta, a.motivo]);
    descargarTexto('auditoria.csv', aCsv(['fecha', 'usuario', 'rol', 'accion', 'ruta', 'motivo'], filas));
  };
  const exportarVentas = (): void => {
    void ventas.ejecutar(async () => {
      const v = await api.llamar('listarVentas', {});
      descargarTexto('ventas.csv', aCsv(['recibo', 'ventaId', 'turnoId', 'cajero', 'estado', 'moneda', 'subtotal', 'descuento', 'total', 'cliente', 'fechaMs'], v.map((x) => [`${x.serie}-${String(x.receiptNo).padStart(6, '0')}`, x.ventaId, x.turnoId, x.cajeroUid, x.estado, x.moneda, x.subtotal / 100, (x.descuento?.monto ?? 0) / 100, x.total / 100, x.cliente?.nombre, x.creadoEnMs])));
    });
  };
  return (
    <Seccion titulo="Auditoría del POS">
      <form class="formulario" onSubmit={(e) => { e.preventDefault(); setFiltro({ ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}), ...(accion.trim() ? { accion: accion.trim() } : {}) }); }} role="search" noValidate>
        <div class="cuadricula">
          <Campo etiqueta="Desde" tipo="date" valor={desde} onInput={setDesde} />
          <Campo etiqueta="Hasta" tipo="date" valor={hasta} onInput={setHasta} />
          <Campo etiqueta="Acción contiene" valor={accion} onInput={setAccion} ayuda="Ejemplo: pos.venta" />
        </div>
        <div class="fila">
          <Boton tipo="submit">Filtrar</Boton>
          <Boton variante="secundario" onClick={exportar} deshabilitado={!lista.datos?.length}>Exportar auditoría (CSV)</Boton>
          <Boton variante="secundario" onClick={exportarVentas} ocupado={ventas.ocupado}>Exportar ventas (CSV)</Boton>
        </div>
      </form>
      {ventas.error && <Alerta>{ventas.error}</Alerta>}
      {lista.cargando && <Cargando />}
      {lista.error && <ErrorCarga error={lista.error} reintentar={lista.recargar} />}
      {lista.datos && lista.datos.length === 0 && <Vacio titulo="No hay registros con esos filtros" />}
      {lista.datos && lista.datos.length > 0 && (
        <table class="tabla">
          <caption class="solo-lectores">Registro de auditoría</caption>
          <thead><tr><th scope="col">Fecha</th><th scope="col">Usuario</th><th scope="col">Acción</th><th scope="col">Motivo</th></tr></thead>
          <tbody>
            {lista.datos.map((a) => (
              <tr key={a.id}><td>{fechaHora(a.fecha)}</td><td>{a.uid} ({a.rol})</td><td>{a.accion}</td><td>{a.motivo ?? ''}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </Seccion>
  );
}

export function PantallaSupervision({ sub }: { sub: string }): JSX.Element {
  const actual = sub === 'auditoria' ? 'auditoria' : 'vivo';
  return (
    <div>
      <h1>Supervisión</h1>
      <Pestanas etiqueta="Supervisión" base="supervision" actual={actual} items={[{ id: 'vivo', titulo: 'En vivo' }, { id: 'auditoria', titulo: 'Auditoría y CSV' }]} />
      {actual === 'vivo' ? <EnVivo /> : <Auditoria />}
    </div>
  );
}
