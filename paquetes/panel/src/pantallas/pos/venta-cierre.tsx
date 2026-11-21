import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ErrorApi } from '../../api/errores.js';
import { type MontosPorMoneda, type ResultadoCierre, type TurnoPos } from '../../api/tipos.js';
import { Alerta, Boton, BotonConfirmado, Cargando, Campo, Dato, ErrorCarga, Seccion } from '../../ui/comun.js';
import { useConfiguracionComercial } from '../../ui/comercial.js';
import { useAvisos } from '../../ui/avisos.js';
import { Tabla } from '../../ui/tabla.js';
import { useApp } from '../../ui/contexto.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { TOTALES_VACIOS, desgloseEfectivo, diferenciaPorMoneda, monedasDelTurno, ordenarMonedas, proyectarTurno } from './arqueo.js';
import { formatearMonto, textoACentavos } from '../../util/dinero.js';
import { lineasGuardadas, textoProductos } from './carritos.js';
import { CancelarConMotivo } from './venta-carritos.js';

export function ResumenArqueo({ cierre, orden }: { cierre: ResultadoCierre; orden: readonly string[] }): JSX.Element {
  return (
    <>
    <h3>Arqueo del turno cerrado</h3>
    <Tabla
      titulo="Arqueo del turno cerrado"
      vistaCelular="tarjetas"
      filas={ordenarMonedas(Object.keys(cierre.arqueo), orden).filter((m) => cierre.arqueo[m] !== undefined)}
      clave={(m) => m}
      columnas={[
        { id: 'moneda', titulo: 'Moneda', valor: (m) => m, encabezadoFila: true },
        { id: 'esperado', titulo: 'Esperado', valor: (m) => cierre.arqueo[m]?.esperado ?? 0, celda: (m) => formatearMonto(cierre.arqueo[m]?.esperado ?? 0, m), numerica: true },
        { id: 'contado', titulo: 'Contado', valor: (m) => cierre.arqueo[m]?.contado ?? 0, celda: (m) => formatearMonto(cierre.arqueo[m]?.contado ?? 0, m), numerica: true },
        { id: 'diferencia', titulo: 'Diferencia', valor: (m) => cierre.arqueo[m]?.diferencia ?? 0, celda: (m) => { const d = cierre.arqueo[m]?.diferencia ?? 0; return <span class={d < 0 ? 'texto-error' : ''}>{formatearMonto(d, m)}</span>; }, numerica: true },
      ]}
    />
    </>
  );
}

/** Lo que mueve el efectivo esperado: apertura y totales por moneda. */
export function mismoEfectivo(a: TurnoPos, b: TurnoPos): boolean {
  const huella = (t: TurnoPos): string => JSON.stringify([Object.entries(t.apertura).sort(([x], [y]) => x.localeCompare(y)), Object.entries(t.totales).sort(([x], [y]) => x.localeCompare(y)).map(([m, v]) => [m, v && Object.entries(v).sort(([x], [y]) => x.localeCompare(y))])]);
  return huella(a) === huella(b);
}

/** El orden de las monedas sale de lo que declaró el comercio (`monedasCaja`), igual que en la supervisión. */
export function VentaCierre({ turno, alCerrar, alRetomar }: { turno: TurnoPos; alCerrar: () => void; alRetomar?: ((carritoId: string) => void) | undefined }): JSX.Element {
  const comercial = useConfiguracionComercial();
  if (comercial.estado === 'cargando') return <Cargando />;
  if (comercial.estado === 'error') return <Alerta>{comercial.mensaje}</Alerta>;
  return <CierreListo turno={turno} orden={comercial.comercial.monedasCaja} alCerrar={alCerrar} alRetomar={alRetomar} />;
}

/** Carritos abiertos del turno: bloquean el cierre hasta que se cobren o se cancelen. */
function CarritosAbiertos({ lista, alRetomar, alCambiar }: { lista: readonly { carritoId: string; etiqueta: string; lineas?: number }[]; alRetomar?: ((carritoId: string) => void) | undefined; alCambiar: () => void }): JSX.Element {
  const { api } = useApp();
  return (
    <section aria-label="Carritos abiertos" class="caja-aviso">
      <p>Hay {lista.length} {lista.length === 1 ? 'carrito abierto' : 'carritos abiertos'}: cóbrelos o cancélelos antes de cerrar la caja.</p>
      <ul class="lista-simple">
        {lista.map((k) => (
          <li key={k.carritoId} class="fila fila-alinear">
            <strong>{k.etiqueta}</strong>
            {k.lineas !== undefined && <span class="texto-suave">{textoProductos(k.lineas)}</span>}
            {alRetomar !== undefined && <Boton chico variante="secundario" etiqueta={`Retomar ${k.etiqueta}`} onClick={() => alRetomar(k.carritoId)}>Retomar</Boton>}
            <CancelarConMotivo nombre={k.etiqueta} textoBoton="Cancelar con motivo" alCancelar={async (motivo) => { await api.llamar('cancelarCarrito', { carritoId: k.carritoId, motivo }); alCambiar(); }} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Cómo se llega al efectivo esperado: apertura + cobrado − devuelto + ingresos − egresos. */
function DesgloseDeEfectivo({ moneda, apertura, turno, devuelto }: { moneda: string; apertura: number; turno: TurnoPos; devuelto: number | undefined }): JSX.Element {
  const d = desgloseEfectivo(apertura, turno.totales[moneda] ?? TOTALES_VACIOS, devuelto ?? 0);
  const m = (c: number): string => formatearMonto(c, moneda);
  return (
    <>
      <Dato etiqueta="Apertura">{m(d.apertura)}</Dato>
      <Dato etiqueta={devuelto === undefined ? 'Efectivo neto (sin el detalle de devoluciones)' : 'Efectivo cobrado'}>{m(d.cobrado)}</Dato>
      <Dato etiqueta="Devuelto por anulaciones (se resta)">{devuelto === undefined ? 'No disponible' : m(d.devuelto)}</Dato>
      <Dato etiqueta="Ingresos excepcionales (se suman)">{m(d.ingresos)}</Dato>
      <Dato etiqueta="Egresos excepcionales (se restan)">{m(d.egresos)}</Dato>
    </>
  );
}

function CierreListo({ turno, orden, alCerrar, alRetomar }: { turno: TurnoPos; orden: readonly string[]; alCerrar: () => void; alRetomar?: ((carritoId: string) => void) | undefined }): JSX.Element {
  const { api } = useApp();
  const accion = useAccion();
  const abiertos = useCarga(() => api.llamar('misCarritos', {}), [turno.turnoId]);
  // Si el servidor rechaza el cierre por carritos abiertos, se muestra su lista (puede incluir carritos que esta pantalla no vio).
  const [segunServidor, setSegunServidor] = useState<readonly { carritoId: string; etiqueta: string }[] | null>(null);
  const avisos = useAvisos();
  // El cierre lee el turno por su cuenta: una anulación con reembolso hecha después de abrir esta pantalla cambia el efectivo esperado.
  const [vigente, setVigente] = useState<TurnoPos>(turno);
  const [actualizando, setActualizando] = useState(false);
  const [cambio, setCambio] = useState<string | null>(null);
  const leer = async (): Promise<TurnoPos | null> => {
    setActualizando(true);
    try {
      const t = await api.llamar('turnoActual', {});
      if (t !== null) setVigente(t);
      return t;
    } finally {
      setActualizando(false);
    }
  };
  useEffect(() => {
    leer().catch(() => setCambio('No se pudo actualizar el turno; los montos pueden estar desactualizados. Use «Actualizar».'));
  }, [turno.turnoId]);
  const actualizar = (): void => {
    setCambio(null);
    void accion.ejecutar(async () => {
      if ((await leer()) === null) {
        avisos.info('El turno ya se cerró en otra ventana.');
        alCerrar();
      }
    });
  };
  // Lo devuelto por anulaciones sale del resumen del turno; si falla, se avisa que no está disponible.
  const resumen = useCarga(() => api.llamar('resumenTurno', { turnoId: turno.turnoId }), [turno.turnoId, JSON.stringify(vigente.totales)]);
  const monedas = monedasDelTurno(vigente, orden);
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [cierre, setCierre] = useState<ResultadoCierre | null>(null);

  if (cierre !== null) {
    return (
      <Seccion titulo="Turno cerrado">
        <Alerta tipo="ok">El turno se cerró. La diferencia negativa (faltante) queda registrada tal cual.</Alerta>
        <ResumenArqueo cierre={cierre} orden={orden} />
        <button type="button" class="boton boton-cta" onClick={alCerrar}>Continuar</button>
      </Seccion>
    );
  }

  const proy = proyectarTurno(vigente, orden);
  const contado: Partial<Record<string, number>> = {};
  let falta = false;
  for (const m of monedas) {
    const c = textoACentavos(textos[m] ?? '');
    if (c === null) falta = true;
    else contado[m] = c;
  }
  const dif = diferenciaPorMoneda(vigente, contado as MontosPorMoneda, orden);

  const propios = (abiertos.datos ?? []).filter((k) => k.estado === 'abierto').map((k) => ({ carritoId: k.carritoId, etiqueta: k.etiqueta, lineas: lineasGuardadas(k) }));
  const lista = segunServidor !== null && segunServidor.length > propios.length ? segunServidor : propios;
  const motivoBloqueo = lista.length > 0 ? `Hay ${lista.length} ${lista.length === 1 ? 'carrito abierto' : 'carritos abiertos'}: cóbrelos o cancélelos antes de cerrar la caja.` : undefined;

  return (
    <Seccion titulo="Cierre de turno">
      {abiertos.cargando && <Cargando texto="Revisando carritos abiertos…" />}
      {abiertos.error && <ErrorCarga error={abiertos.error} reintentar={abiertos.recargar} />}
      {lista.length > 0 && <CarritosAbiertos lista={lista} alRetomar={alRetomar} alCambiar={() => { setSegunServidor(null); abiertos.recargar(); }} />}
      <p class="texto-suave">Cuente el efectivo de la caja en cada moneda. QR, transferencias y créditos se informan aparte y no suman al efectivo.</p>
      {monedas.map((m) => {
        const p = proy[m];
        if (p === undefined) return null;
        const d = dif[m];
        return (
          <fieldset key={m} class="fila-pago">
            <legend>{m}</legend>
            <dl class="datos">
              <DesgloseDeEfectivo moneda={m} apertura={p.apertura} turno={vigente} devuelto={resumen.datos?.porMoneda[m]?.reembolsos.efectivo} />
              <Dato etiqueta="Efectivo esperado">{formatearMonto(p.efectivoEsperado, m)}</Dato>
              <Dato etiqueta="QR (informativo)">{formatearMonto(p.qr, m)}</Dato>
              <Dato etiqueta="Transferencias (informativo)">{formatearMonto(p.transferencia, m)}</Dato>
              <Dato etiqueta="Créditos otorgados (informativo)">{formatearMonto(p.credito, m)}</Dato>
            </dl>
            <Campo etiqueta={`Efectivo contado en ${m}`} valor={textos[m] ?? ''} onInput={(v) => setTextos({ ...textos, [m]: v })} inputMode="decimal" requerido />
            {d !== undefined && (
              <p class={d < 0 ? 'texto-error' : ''} aria-live="polite" data-prueba={`diferencia-${m}`}>
                Diferencia: {formatearMonto(d, m)} {d < 0 ? '(faltante)' : d > 0 ? '(sobrante)' : '(cuadra)'}
              </p>
            )}
          </fieldset>
        );
      })}
      {resumen.datos?.truncado === true && <Alerta tipo="info">El turno tiene muchísimas operaciones: lo devuelto por anulaciones puede estar incompleto. El efectivo esperado sí es exacto.</Alerta>}
      {actualizando && <p class="texto-suave" aria-live="polite">Actualizando…</p>}
      {cambio !== null && <Alerta tipo="info">{cambio}</Alerta>}
      {accion.error && <Alerta>{accion.error}</Alerta>}
      <Boton variante="secundario" chico onClick={actualizar} ocupado={actualizando}>Actualizar</Boton>
      <BotonConfirmado
        texto="Cerrar turno"
        pregunta="¿Cerrar el turno con estos conteos? No se puede deshacer."
        textoConfirmar="Sí, cerrar turno"
        deshabilitado={falta || accion.ocupado || actualizando || abiertos.cargando || lista.length > 0}
        onConfirmar={() => void accion.ejecutar(async () => {
          setCambio(null);
          const ahora = await api.llamar('turnoActual', {});
          if (ahora === null) {
            avisos.info('El turno ya se cerró en otra ventana.');
            alCerrar();
            return;
          }
          if (!mismoEfectivo(ahora, vigente)) {
            setVigente(ahora);
            setCambio('El efectivo esperado cambió (por ejemplo, por una anulación). Revíselo y vuelva a confirmar.');
            return;
          }
          try {
            setCierre(await api.llamar('cerrarTurno', { turnoId: turno.turnoId, contado: contado as MontosPorMoneda }));
          } catch (e) {
            if (e instanceof ErrorApi && e.detalle.carritos !== undefined) {
              setSegunServidor(e.detalle.carritos);
              abiertos.recargar();
            }
            throw e;
          }
        })}
      />
      {motivoBloqueo !== undefined && <p class="texto-suave" data-prueba="motivo-cierre">{motivoBloqueo}</p>}
    </Seccion>
  );
}
