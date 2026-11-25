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
import { CancelarConMotivo } from './venta-carritos.js';
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
      <Tabla
        titulo="Totales en vivo del turno"
        filas={monedas.filter((m) => proy[m] !== undefined)}
        clave={(m) => m}
        columnas={[
          { id: 'moneda', titulo: 'Moneda', valor: (m) => m, encabezadoFila: true },
          ...([['efectivo', 'Efectivo esperado', 'efectivoEsperado'], ['qr', 'QR', 'qr'], ['transferencia', 'Transferencia', 'transferencia'], ['credito', 'Crédito', 'credito'], ['ingresos', 'Ingresos', 'ingresos'], ['egresos', 'Egresos', 'egresos']] as const).map(([id, titulo, campo]) => ({
            id,
            titulo,
            valor: (m: string) => proy[m]?.[campo] ?? 0,
            celda: (m: string) => formatearMonto(proy[m]?.[campo] ?? 0, m),
            numerica: true,
          })),
        ]}
      />
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

/** «5 min», «2 h 10 min», «1 d 3 h»: cuánto lleva abierto un carrito. */
export function textoAntiguedad(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${min % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/**
 * La supervisión de carritos trae solo el uid del cajero (sin nombre ni correo) y esta pantalla no lo inventa: cada carrito
 * es de la caja abierta cuyo turno se ve arriba, en «Cajas abiertas».
 */
export const TEXTO_CAJERO_CARRITO = 'Cajero de la caja abierta';

/** Carritos abiertos de los turnos en curso: sin cliente ni series. Supervisor y administrador pueden cancelarlos con motivo. */
function CarritosAbiertos(): JSX.Element | null {
  const { usuario } = useApp();
  return usuario.rol === 'sup' || usuario.rol === 'adm' ? <CarritosAbiertosLista /> : null;
}

function CarritosAbiertosLista(): JSX.Element {
  const { api } = useApp();
  const lista = useCarga(() => api.llamar('carritosSupervision', {}), [], 10_000);
  const carritos = lista.datos ?? [];
  return (
    <Seccion titulo="Carritos abiertos" acciones={<Boton chico variante="secundario" onClick={lista.recargar}>Actualizar</Boton>}>
      {lista.cargando && !lista.datos && <Cargando />}
      {lista.error && <ErrorCarga error={lista.error} reintentar={lista.recargar} />}
      {lista.datos && carritos.length === 0 && <p>No hay carritos abiertos.</p>}
      {carritos.length > 0 && (
        <Tabla
          titulo="Carritos abiertos"
          filas={carritos}
          clave={(k) => k.carritoId}
          columnas={[
            { id: 'etiqueta', titulo: 'Carrito', valor: (k) => k.etiqueta },
            { id: 'cajero', titulo: 'Cajero', valor: () => TEXTO_CAJERO_CARRITO },
            { id: 'productos', titulo: 'Productos', valor: (k) => k.lineas },
            { id: 'unidades', titulo: 'Unidades', valor: (k) => k.unidades },
            { id: 'antiguedad', titulo: 'Antigüedad', valor: (k) => k.antiguedadMs, celda: (k) => textoAntiguedad(k.antiguedadMs), ordenable: true },
          ]}
          acciones={(k) => <CancelarConMotivo nombre={k.etiqueta} textoBoton="Cancelar con motivo" alCancelar={async (motivo) => { await api.llamar('cancelarCarrito', { carritoId: k.carritoId, motivo }); lista.recargar(); }} />}
        />
      )}
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
      {'accion' in filtro && <Alerta tipo="info">Con una acción elegida el filtro revisa solo los registros más recientes (el servidor mira los últimos 1000): puede faltar alguno antiguo. Acote las fechas para ver menos y más reciente.</Alerta>}
      {lista.datos && (
        <Tabla
          titulo="Registro de auditoría"
          vistaCelular="tarjetas"
          filas={registros}
          clave={(a) => a.id}
          vacio={{ titulo: 'No hay registros con esos filtros' }}
          cortada={registros.length >= TOPE_AUDITORIA ? { mostradas: registros.length, mensaje: `Se muestran los ${registros.length} registros más recientes y puede haber más. Acote las fechas o elija una acción.` } : undefined}
          columnas={[
            { id: 'fecha', titulo: 'Fecha', valor: (a) => a.fecha, celda: (a) => fechaHora(a.fecha), ordenable: true },
            { id: 'usuario', titulo: 'Usuario', valor: (a) => correoDe(a.uid), celda: (a) => (a.rol === 'propietario' ? 'Operador de NovuTienda' : `${correoDe(a.uid)} (${ROL_TEXTO[a.rol] ?? a.rol})`) },
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
      {actual === 'vivo' ? <><EnVivo /><CarritosAbiertos /></> : <><ExportarVentas /><Auditoria /></>}
    </div>
  );
}
