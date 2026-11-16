import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { type MontosPorMoneda, type TurnoPos } from '../../api/tipos.js';
import { Alerta, BotonConfirmado, Boton, Campo, Cargando, ErrorCarga, Pestanas, Selector, Seccion, Vacio, fechaHora } from '../../ui/comun.js';
import { useConfiguracionComercial } from '../../ui/comercial.js';
import { useApp } from '../../ui/contexto.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { Tabla } from '../../ui/tabla.js';
import { monedasDelTurno, proyectarTurno } from './arqueo.js';
import { nombreDeAccion, ACCIONES_AUDITORIA } from './nombres-auditoria.js';
import { aCsv, descargarTexto } from '../../util/csv.js';
import { formatearMonto, textoACentavos } from '../../util/dinero.js';
import { rangoUltimoMes, validarRango } from '../../util/rango.js';


function TurnoVivo({ t, orden, alCambiar }: { t: TurnoPos; orden: readonly string[]; alCambiar: () => void }): JSX.Element {
  const { api, usuario } = useApp();
  const accion = useAccion();
  const [motivo, setMotivo] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [textos, setTextos] = useState<Record<string, string>>({});
  const proy = proyectarTurno(t, orden);
  const monedas = monedasDelTurno(t, orden);
  const contado: Partial<Record<string, number>> = {};
  let falta = false;
  for (const m of monedas) {
    const c = textoACentavos(textos[m] ?? '');
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
          {monedas.filter((m) => proy[m] !== undefined).map((m) => {
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
              <Campo key={m} etiqueta={`Efectivo contado en ${m}`} valor={textos[m] ?? ''} onInput={(v) => setTextos({ ...textos, [m]: v })} inputMode="decimal" requerido />
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
  const comercial = useConfiguracionComercial();
  if (comercial.estado === 'cargando') return <Cargando />;
  if (comercial.estado === 'error') return <Alerta>{comercial.mensaje}</Alerta>;
  const orden = comercial.comercial.monedasCaja;
  return (
    <Seccion titulo="Cajas abiertas (se actualiza cada 10 segundos)" acciones={<Boton chico variante="secundario" onClick={turnos.recargar}>Actualizar</Boton>}>
      {turnos.cargando && <Cargando />}
      {turnos.error && <ErrorCarga error={turnos.error} reintentar={turnos.recargar} />}
      {turnos.datos && turnos.datos.length === 0 && <Vacio titulo="No hay turnos abiertos" />}
      <ul class="lista-simple">{(turnos.datos ?? []).map((t) => <TurnoVivo key={t.turnoId} t={t} orden={orden} alCambiar={turnos.recargar} />)}</ul>
    </Seccion>
  );
}

/** Ventas del rango en CSV, generado por el servidor (celdas neutralizadas). Último mes por defecto; hasta 366 días. */
function ExportarVentas(): JSX.Element {
  const { api } = useApp();
  const inicial = rangoUltimoMes(Date.now());
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const accion = useAccion();
  const [aviso, setAviso] = useState<string | null>(null);
  const problema = validarRango(desde, hasta);
  const exportar = (): void => {
    if (problema !== null) return;
    setAviso(null);
    void accion.ejecutar(async () => {
      const { csv, truncado } = await api.llamar('exportarVentasCsv', { desde, hasta });
      descargarTexto(`ventas_${desde}_${hasta}.csv`, csv);
      if (truncado) setAviso('El archivo está incompleto: el rango tiene más ventas que el máximo de una exportación (5000). Exporte por tramos más cortos.');
    });
  };
  return (
    <Seccion titulo="Exportar ventas">
      <form class="formulario" onSubmit={(e) => { e.preventDefault(); exportar(); }} noValidate>
        <div class="cuadricula">
          <Campo etiqueta="Ventas desde" tipo="date" valor={desde} onInput={setDesde} requerido />
          <Campo etiqueta="Ventas hasta" tipo="date" valor={hasta} onInput={setHasta} requerido ayuda="Por defecto, el último mes. Máximo 366 días." />
        </div>
        {problema !== null && <Alerta>{problema}</Alerta>}
        {accion.error && <Alerta>{accion.error}</Alerta>}
        {aviso !== null && <Alerta tipo="info">{aviso}</Alerta>}
        <div class="fila"><Boton tipo="submit" variante="secundario" ocupado={accion.ocupado} deshabilitado={problema !== null}>Exportar ventas (CSV)</Boton></div>
      </form>
    </Seccion>
  );
}

/** Tope de registros que se piden por consulta: se manda explícito para que el panel y el servidor cuenten lo mismo. */
export const TOPE_AUDITORIA = 100;
const ROL_TEXTO: Readonly<Record<string, string>> = { caj: 'Vendedor', sup: 'Supervisor', adm: 'Administrador' };

function Auditoria(): JSX.Element {
  const { api } = useApp();
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [accion, setAccion] = useState('');
  const [filtro, setFiltro] = useState({});
  const lista = useCarga(() => api.llamar('listarAuditoria', { ...filtro, limite: TOPE_AUDITORIA }), [filtro]);
  const usuarios = useCarga(() => api.llamar('listarUsuarios', {}), []);
  const correoDe = (uid: string): string => usuarios.datos?.find((u) => u.uid === uid)?.correo || 'usuario no identificado';
  const exportar = (): void => {
    const filas = (lista.datos ?? []).map((a) => [a.fecha, a.uid, a.rol, a.accion, a.ruta, a.motivo]);
    descargarTexto('auditoria.csv', aCsv(['fecha', 'usuario', 'rol', 'accion', 'ruta', 'motivo'], filas));
  };
  const registros = lista.datos ?? [];
  return (
    <Seccion titulo="Auditoría del POS">
      <form class="formulario" onSubmit={(e) => { e.preventDefault(); setFiltro({ ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}), ...(accion ? { accion } : {}) }); }} role="search" noValidate>
        <div class="cuadricula">
          <Campo etiqueta="Desde" tipo="date" valor={desde} onInput={setDesde} />
          <Campo etiqueta="Hasta" tipo="date" valor={hasta} onInput={setHasta} />
          <Selector etiqueta="Acción" valor={accion} onCambio={setAccion} opciones={[{ valor: '', texto: 'Todas las acciones' }, ...ACCIONES_AUDITORIA.map((a) => ({ valor: a.codigo, texto: a.nombre }))]} ayuda="Elija una acción para ver solo esas." />
        </div>
        <div class="fila">
          <Boton tipo="submit">Filtrar</Boton>
          <Boton variante="secundario" onClick={exportar} deshabilitado={!lista.datos?.length}>Exportar auditoría (CSV)</Boton>
        </div>
      </form>
      {lista.cargando && <Cargando />}
      {lista.error && <ErrorCarga error={lista.error} reintentar={lista.recargar} />}
      {lista.datos && (
        <Tabla
          titulo="Registro de auditoría"
          filas={registros}
          clave={(a) => a.id}
          vacio={{ titulo: 'No hay registros con esos filtros' }}
          cortada={registros.length >= TOPE_AUDITORIA ? { mostradas: registros.length, mensaje: `Se muestran los ${registros.length} registros más recientes y puede haber más. Acote las fechas o elija una acción.` } : undefined}
          columnas={[
            { id: 'fecha', titulo: 'Fecha', valor: (a) => a.fecha, celda: (a) => fechaHora(a.fecha), ordenable: true },
            { id: 'usuario', titulo: 'Usuario', valor: (a) => correoDe(a.uid), celda: (a) => `${correoDe(a.uid)} (${ROL_TEXTO[a.rol] ?? a.rol})` },
            { id: 'accion', titulo: 'Acción', valor: (a) => nombreDeAccion(a.accion) },
            { id: 'motivo', titulo: 'Motivo', valor: (a) => a.motivo ?? '' },
          ]}
        />
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
      {actual === 'vivo' ? <EnVivo /> : <><ExportarVentas /><Auditoria /></>}
    </div>
  );
}
