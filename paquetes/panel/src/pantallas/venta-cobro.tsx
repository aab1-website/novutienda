import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { nuevoId } from '../api/cliente.js';
import type { AprobacionPos, Carrito, ConfigPos, Mercado, MedioPago, Moneda } from '../api/tipos.js';
import { Alerta, Boton, Campo, Cargando, Selector, Seccion } from '../ui/comun.js';
import { useApp } from '../ui/contexto.js';
import { useAccion, useCarga } from '../ui/hooks.js';
import { formatearMonto, textoACentavos } from '../util/dinero.js';
import { calcularPagos, NOMBRE_MEDIO, type FilaPago } from '../util/pagos.js';

export interface DatosCobro {
  mercado: Mercado;
  moneda: Moneda;
  config: ConfigPos;
  total: number;
  carrito: Carrito;
  aprobacionId: string | undefined;
}

export function VentaCobro({ datos, volver, alVender }: { datos: DatosCobro; volver: () => void; alVender: (ventaId: string) => void }): JSX.Element {
  const { api, usuario } = useApp();
  const { moneda, total, config, carrito } = datos;
  const [filas, setFilas] = useState<FilaPago[]>([{ id: nuevoId(), medio: 'efectivo', monto: '', recibido: '', referencia: '' }]);
  const requestId = useRef(nuevoId());
  const accion = useAccion();
  const solicitud = useAccion();
  const [aprobCredito, setAprobCredito] = useState('');
  const [solicitadaId, setSolicitadaId] = useState<string | null>(null);
  const aprobs = useCarga(() => api.llamar('listarAprobaciones', {}), [solicitadaId]);

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

  const actualizar = (id: string, cambio: Partial<FilaPago>): void => setFilas(filas.map((f) => (f.id === id ? { ...f, ...cambio } : f)));
  const agregar = (): void => setFilas([...filas, { id: nuevoId(), medio: config.mediosHabilitados.find((m) => !filas.some((f) => f.medio === m)) ?? 'efectivo', monto: restante > 0 ? String(restante / 100).replace('.', ',') : '', recibido: '', referencia: '' }]);

  const cobrar = (): void => {
    void accion.ejecutar(async () => {
      const r = await api.llamar('confirmarVenta', {
        requestId: requestId.current, carrito, pagos,
        ...(datos.aprobacionId !== undefined ? { aprobacionId: datos.aprobacionId } : {}),
        ...(necesitaAprobCredito ? { aprobacionCreditoId: aprobCredito } : {}),
      });
      alVender(r.venta.ventaId);
    });
  };

  const pedirCredito = (): void => {
    void solicitud.ejecutar(async () => {
      const id = nuevoId();
      await api.llamar('solicitarAprobacion', { aprobacionId: id, solicitud: { tipo: 'credito', moneda, monto: montoCredito, motivo: `Crédito para ${deudor}`, deudor } });
      setSolicitadaId(id);
    });
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
                <Alerta tipo="info">Solicitud enviada. Espere la aprobación del supervisor.</Alerta>
                <Boton chico variante="secundario" onClick={aprobs.recargar}>Actualizar aprobaciones</Boton>
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
      {restante < 0 && <Alerta>Los pagos superan el total. Ajuste los montos.</Alerta>}
      {[...errores, ...erroresExtra].map((e) => (
        <p key={e} class="texto-error">{e}</p>
      ))}
      {accion.error && <Alerta>{accion.error}</Alerta>}
      <Boton onClick={cobrar} ocupado={accion.ocupado} deshabilitado={!listo}>
        Confirmar cobro
      </Boton>
    </Seccion>
  );
}
