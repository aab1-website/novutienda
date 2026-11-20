import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ErrorApi } from '../../api/errores.js';
import { type MontosPorMoneda, type ResultadoCierre, type TurnoPos } from '../../api/tipos.js';
import { Alerta, Boton, BotonConfirmado, Cargando, Campo, Dato, ErrorCarga, Seccion } from '../../ui/comun.js';
import { useConfiguracionComercial } from '../../ui/comercial.js';
import { useAvisos } from '../../ui/avisos.js';
import { useApp } from '../../ui/contexto.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { diferenciaPorMoneda, monedasDelTurno, ordenarMonedas, proyectarTurno } from './arqueo.js';
import { formatearMonto, textoACentavos } from '../../util/dinero.js';
import { lineasGuardadas, textoProductos } from './carritos.js';
import { CancelarConMotivo } from './venta-carritos.js';

export function ResumenArqueo({ cierre, orden }: { cierre: ResultadoCierre; orden: readonly string[] }): JSX.Element {
  return (
    <table class="tabla">
      <caption>Arqueo del turno cerrado</caption>
      <thead>
        <tr><th scope="col">Moneda</th><th scope="col" class="num">Esperado</th><th scope="col" class="num">Contado</th><th scope="col" class="num">Diferencia</th></tr>
      </thead>
      <tbody>
        {ordenarMonedas(Object.keys(cierre.arqueo), orden).filter((m) => cierre.arqueo[m] !== undefined).map((m) => {
          const a = cierre.arqueo[m];
          if (a === undefined) return null;
          return (
            <tr key={m}>
              <th scope="row">{m}</th>
              <td class="num">{formatearMonto(a.esperado, m)}</td>
              <td class="num">{formatearMonto(a.contado, m)}</td>
              <td class={`num ${a.diferencia < 0 ? 'texto-error' : ''}`}>{formatearMonto(a.diferencia, m)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
              <Dato etiqueta="Apertura">{formatearMonto(p.apertura, m)}</Dato>
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
