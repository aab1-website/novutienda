import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { nuevoId } from '../../api/cliente.js';
import { ErrorApi } from '../../api/errores.js';
import type { AprobacionPos, Carrito, ConfigPos, MedioPago, Moneda } from '../../api/tipos.js';
import { Alerta, Boton, Campo, Cargando, Selector, Seccion } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { centavosATexto, formatearMonto, textoACentavos } from '../../util/dinero.js';
import { calcularPagos, NOMBRE_MEDIO, type FilaPago } from './pagos.js';

/** Cada cuántos milisegundos se consulta una aprobación solicitada mientras sigue pendiente. */
export const MS_SONDEO_APROBACION = 4000;
/** Tope de la espera automática: 150 consultas de 4 s son 10 minutos; luego hay que pedir «Volver a consultar». */
export const CONSULTAS_MAXIMAS_APROBACION = 150;

/**
 * Espera una solicitud que ESTA pantalla acaba de pedir (`solicitadaId`): cada 4 s mira solo la lista de pendientes para
 * saber si sigue ahí. Se detiene al resolverse, al desmontar, al quedar sin id (carrito descartado) o a los 10 minutos.
 * Una solicitud vieja o ajena nunca la activa.
 */
export function useEsperaAprobacion(solicitadaId: string | null, alResolverse: () => void): { consultando: boolean; agotada: boolean; reanudar: () => void } {
  const { api, sesionVencida, renovarSesion } = useApp();
  const [estado, setEstado] = useState<'consultando' | 'resuelta' | 'agotada'>('consultando');
  const [ronda, setRonda] = useState(0);
  const alRef = useRef(alResolverse);
  alRef.current = alResolverse;
  useEffect(() => {
    if (solicitadaId === null) return undefined;
    setEstado('consultando');
    let vivo = true;
    let consultas = 0;
    const t = setInterval(() => {
      consultas += 1;
      if (consultas > CONSULTAS_MAXIMAS_APROBACION) {
        clearInterval(t);
        setEstado('agotada');
        return;
      }
      api.llamar('listarAprobaciones', { estado: 'pendiente' }).then(
        (p) => {
          if (!vivo || p.some((a) => a.aprobacionId === solicitadaId)) return;
          clearInterval(t);
          setEstado('resuelta');
          alRef.current();
        },
        (e: unknown) => {
          // Una sesión vencida no se calla ni se reintenta 10 minutos: se detiene y actúa el manejo de sesión del panel.
          if (e instanceof ErrorApi && e.codigoHttps === 'unauthenticated') {
            void renovarSesion().then((ok) => {
              if (ok || !vivo) return;
              clearInterval(t);
              setEstado('agotada');
              sesionVencida();
            });
          }
        },
      );
    }, MS_SONDEO_APROBACION);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [solicitadaId, ronda]);
  return { consultando: solicitadaId !== null && estado === 'consultando', agotada: solicitadaId !== null && estado === 'agotada', reanudar: () => setRonda((n) => n + 1) };
}

export interface DatosCobro {
  mercado: string;
  moneda: string;
  config: ConfigPos;
  total: number;
  carrito: Carrito;
  aprobacionId: string | undefined;
  /** Identificador del cobro: vive en el borrador del carrito; el mismo reintento no puede duplicar la venta. */
  requestId: string;
  /** Nombres de lo ya cargado en el terminal, para completar un faltante de stock que el servidor trae sin nombre. */
  nombreProducto?: ((productoId: string) => string | undefined) | undefined;
  nombreAlmacen?: ((almacenId: string) => string | undefined) | undefined;
}

/** Si el servidor devolvió faltantes sin nombre de producto o de almacén, los completa con lo que el panel ya tiene. */
export function conNombresDeFaltantes(e: unknown, datos: Pick<DatosCobro, 'nombreProducto' | 'nombreAlmacen'>): unknown {
  if (!(e instanceof ErrorApi) || e.detalle.faltantes === undefined) return e;
  const faltantes = e.detalle.faltantes.map((f) => ({
    ...f,
    ...(f.productoNombre === undefined && datos.nombreProducto?.(f.productoId) !== undefined ? { productoNombre: datos.nombreProducto(f.productoId) as string } : {}),
    ...(f.almacenNombre === undefined && datos.nombreAlmacen?.(f.almacenId) !== undefined ? { almacenNombre: datos.nombreAlmacen(f.almacenId) as string } : {}),
  }));
  return new ErrorApi(e.codigoHttps, e.message, { ...e.detalle, faltantes });
}

export function VentaCobro({ datos, volver, alVender }: { datos: DatosCobro; volver: () => void; alVender: (ventaId: string, repetida: boolean) => void }): JSX.Element {
  const { api, usuario } = useApp();
  const { moneda, total, config, carrito } = datos;
  const [filas, setFilas] = useState<FilaPago[]>([{ id: nuevoId(), medio: 'efectivo', monto: total > 0 ? centavosATexto(total) : '', recibido: '', referencia: '' }]);
  // Filas cuyo monto escribió la persona: el total no las pisa.
  const [editadas, setEditadas] = useState<ReadonlySet<string>>(new Set());
  const accion = useAccion();
  const solicitud = useAccion();
  const [aprobCredito, setAprobCredito] = useState('');
  const [solicitadaId, setSolicitadaId] = useState<string | null>(null);
  const aprobs = useCarga(() => api.llamar('listarAprobaciones', {}), [solicitadaId]);
  const espera = useEsperaAprobacion(solicitadaId, aprobs.recargar);

  // El monto de la primera fila sigue al total mientras la persona no lo haya escrito.
  useEffect(() => {
    setFilas((fs) => (fs.length === 1 && fs[0] !== undefined && !editadas.has(fs[0].id) ? [{ ...fs[0], monto: total > 0 ? centavosATexto(total) : '' }] : fs));
  }, [total, editadas]);

  const { pagos, restante, cambioTotal, errores } = calcularPagos(filas, total, moneda);
  const credito = filas.find((f) => f.medio === 'credito');
  const montoCredito = credito === undefined ? 0 : (textoACentavos(credito.monto) ?? 0);
  const deudor = carrito.cliente?.nombre ?? '';
  const necesitaAprobCredito = credito !== undefined && usuario.rol === 'caj';
  const aprobadasCredito: AprobacionPos[] = (aprobs.datos ?? []).filter((a) => a.tipo === 'credito' && a.estado === 'aprobada' && a.moneda === moneda && a.monto >= montoCredito && a.deudor === deudor);
  const pendienteCredito = (aprobs.datos ?? []).find((a) => a.tipo === 'credito' && a.estado === 'pendiente' && a.moneda === moneda && a.deudor === deudor);
  const erroresExtra = [
    ...(credito !== undefined && deudor === '' ? ['El crédito exige el nombre del deudor: vuelva al carrito y escríbalo en «Cliente».'] : []),
    ...(necesitaAprobCredito && aprobCredito === '' ? ['El crédito necesita la aprobación de un supervisor.'] : []),
  ];
  const listo = restante === 0 && errores.length === 0 && erroresExtra.length === 0 && filas.length > 0;

  // Un motivo por cada falta, el primero que aplique; los errores de cada fila ya dicen cuál es.
  const motivoNoCobrar = ((): string | undefined => {
    if (listo) return undefined;
    if (errores[0] !== undefined) return errores[0];
    if (erroresExtra[0] !== undefined) return erroresExtra[0];
    if (restante > 0) return `Falta cobrar ${formatearMonto(restante, moneda)}.`;
    if (restante < 0) return 'Los pagos superan el total: ajuste los montos.';
    return 'Agregue un pago.';
  })();

  const actualizar = (id: string, cambio: Partial<FilaPago>): void => {
    if (cambio.monto !== undefined) setEditadas((s) => new Set(s).add(id));
    setFilas(filas.map((f) => (f.id === id ? { ...f, ...cambio } : f)));
  };
  const agregar = (): void => setFilas([...filas, { id: nuevoId(), medio: config.mediosHabilitados.find((m) => !filas.some((f) => f.medio === m)) ?? 'efectivo', monto: restante > 0 ? String(restante / 100).replace('.', ',') : '', recibido: '', referencia: '' }]);

  const cobrar = (): void => {
    void accion.ejecutar(async () => {
      try {
        const r = await api.llamar('confirmarVenta', {
          requestId: datos.requestId, carrito, pagos,
          ...(datos.aprobacionId !== undefined ? { aprobacionId: datos.aprobacionId } : {}),
          ...(necesitaAprobCredito ? { aprobacionCreditoId: aprobCredito } : {}),
        });
        alVender(r.venta.ventaId, r.repetida === true);
      } catch (e) {
        throw conNombresDeFaltantes(e, datos);
      }
    }, { error: 'ambos' });
  };

  const pedirCredito = (): void => {
    void solicitud.ejecutar(async () => {
      const id = nuevoId();
      await api.llamar('solicitarAprobacion', { aprobacionId: id, solicitud: { tipo: 'credito', moneda: moneda as Moneda, monto: montoCredito, motivo: `Crédito para ${deudor}`, deudor } });
      setSolicitadaId(id);
    }, { exito: 'Solicitud de crédito enviada al supervisor.', error: 'ambos' });
  };

  return (
    <Seccion titulo="Cobro" acciones={<Boton variante="secundario" chico onClick={volver}>Volver al carrito</Boton>}>
      <p class="total-grande">
        Total a cobrar: <strong data-prueba="total-cobro">{formatearMonto(total, moneda)}</strong>
      </p>
      <p class="texto-suave">Todos los pagos de una venta son en la misma moneda ({moneda}). Puede combinar medios.</p>
      {filas.map((f, i) => (
        <fieldset key={f.id} class="fila-pago">
          <legend>Pago {i + 1}</legend>
          <div class="cuadricula">
            <Selector etiqueta="Medio" valor={f.medio} onCambio={(v) => actualizar(f.id, { medio: v as MedioPago })} opciones={config.mediosHabilitados.map((m) => ({ valor: m, texto: NOMBRE_MEDIO[m] }))} />
            <Campo etiqueta={`Monto a aplicar (${moneda})`} valor={f.monto} onInput={(v) => actualizar(f.id, { monto: v })} inputMode="decimal" />
            {f.medio === 'efectivo' && <Campo etiqueta="Efectivo recibido (para calcular el cambio)" valor={f.recibido} onInput={(v) => actualizar(f.id, { recibido: v })} inputMode="decimal" />}
            {(f.medio === 'qr' || f.medio === 'transferencia') && (
              <Campo etiqueta={f.medio === 'qr' ? 'Referencia del QR' : 'Referencia de la transferencia (opcional)'} valor={f.referencia} onInput={(v) => actualizar(f.id, { referencia: v })} />
            )}
          </div>
          {f.medio === 'qr' && (
            <p class="texto-suave">Se guardará como «QR registrado por {usuario.correo}». El sistema no verifica el pago con el banco.</p>
          )}
          {filas.length > 1 && (
            <Boton chico variante="secundario" onClick={() => setFilas(filas.filter((x) => x.id !== f.id))}>
              Quitar este pago
            </Boton>
          )}
        </fieldset>
      ))}
      {filas.length < 4 && (
        <Boton chico variante="secundario" onClick={agregar}>
          Agregar otro medio
        </Boton>
      )}

      {credito !== undefined && (
        <div class="caja-aviso">
          <p>Crédito para: {deudor === '' ? '(falta el nombre del deudor)' : deudor}</p>
          {necesitaAprobCredito &&
            (aprobs.cargando ? (
              <Cargando />
            ) : aprobadasCredito.length > 0 ? (
              <Selector etiqueta="Aprobación del crédito" valor={aprobCredito} onCambio={setAprobCredito} opciones={[{ valor: '', texto: 'Elija una aprobación' }, ...aprobadasCredito.map((a) => ({ valor: a.aprobacionId, texto: `Hasta ${formatearMonto(a.monto, a.moneda)}` }))]} />
            ) : pendienteCredito ? (
              <>
                {espera.consultando && pendienteCredito.aprobacionId === solicitadaId ? (
                  <Alerta tipo="info">Esperando la aprobación del supervisor: se consulta sola cada pocos segundos.</Alerta>
                ) : (
                  <>
                    <Alerta tipo="info">Hay una solicitud pendiente y ya no se consulta sola.</Alerta>
                    <Boton chico variante="secundario" onClick={() => { aprobs.recargar(); espera.reanudar(); }}>Volver a consultar</Boton>
                  </>
                )}
              </>
            ) : (
              <Boton chico variante="secundario" onClick={pedirCredito} ocupado={solicitud.ocupado} deshabilitado={deudor === '' || montoCredito <= 0}>
                Solicitar aprobación del crédito
              </Boton>
            ))}
          {solicitud.error && <Alerta>{solicitud.error}</Alerta>}
        </div>
      )}

      <dl class="totales" aria-live="polite">
        <div><dt>Restante por cobrar</dt><dd data-prueba="restante">{formatearMonto(restante, moneda)}</dd></div>
        {cambioTotal > 0 && <div><dt>Cambio a entregar</dt><dd data-prueba="cambio">{formatearMonto(cambioTotal, moneda)}</dd></div>}
      </dl>
      {accion.error && <Alerta>{accion.error}</Alerta>}
      <Boton onClick={cobrar} ocupado={accion.ocupado} motivo={motivoNoCobrar}>
        Confirmar cobro
      </Boton>
    </Seccion>
  );
}
