import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { Recibo } from '../api/tipos.js';
import type { Moneda } from '../api/tipos.js';
import { formatearMonto } from '../util/dinero.js';
import { Alerta, Boton, Campo, fechaHora } from './comun.js';
import { useApp } from './contexto.js';
import { useAccion } from './hooks.js';

const MEDIO_TEXTO: Record<string, string> = { efectivo: 'Efectivo', qr: 'QR', transferencia: 'Transferencia', credito: 'Crédito' };

/** Comprobante imprimible. Todo texto se pinta como texto (Preact escapa); no se inserta HTML. */
export function ReciboVista({ recibo, registradoPor }: { recibo: Recibo; registradoPor?: Readonly<Record<string, string>> }): JSX.Element {
  const m = recibo.moneda as Moneda;
  return (
    <article class="recibo" aria-label={`Recibo ${recibo.numero}`}>
      {recibo.estado === 'ANULADO' && <p class="recibo-anulado">ANULADO</p>}
      <header>
        {recibo.plantilla.logoUrl && <img src={recibo.plantilla.logoUrl} alt="" class="recibo-logo" width={64} height={64} />}
        <h3>{recibo.plantilla.negocio.nombre}</h3>
        {recibo.plantilla.negocio.nit && <p>NIT {recibo.plantilla.negocio.nit}</p>}
        {recibo.plantilla.negocio.direccion && <p>{recibo.plantilla.negocio.direccion}</p>}
        {recibo.plantilla.negocio.telefono && <p>Tel. {recibo.plantilla.negocio.telefono}</p>}
      </header>
      <p class="recibo-numero">
        Recibo N.º <strong>{recibo.numero}</strong> · {fechaHora(recibo.emitidoEn)}
      </p>
      <p class="texto-suave">Comprobante no fiscal.{recibo.facturaSuma ? ` Factura SUMA N.º ${recibo.facturaSuma}.` : ''}</p>
      {recibo.cliente && <p>Cliente: {recibo.cliente.nombre}</p>}
      <table class="tabla">
        <caption class="solo-lectores">Detalle del recibo</caption>
        <thead>
          <tr>
            <th scope="col">Producto</th>
            <th scope="col" class="num">Cant.</th>
            <th scope="col" class="num">Precio</th>
            <th scope="col" class="num">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {recibo.lineas.map((l) => (
            <tr key={l.productoId}>
              <td>
                {l.nombre}
                {l.series.length > 0 && <div class="texto-suave">Serie: {l.series.join(', ')}</div>}
                {l.garantiaHasta && <div class="texto-suave">Garantía hasta {l.garantiaHasta}</div>}
              </td>
              <td class="num">{l.cantidad}</td>
              <td class="num">{formatearMonto(l.precioUnitario, m)}</td>
              <td class="num">{formatearMonto(l.subtotal, m)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {recibo.descuento && <p>Descuento: {formatearMonto(recibo.descuento.monto, m)} ({recibo.descuento.motivo})</p>}
      <p class="recibo-total">Total: {formatearMonto(recibo.total, m)}</p>
      <ul class="lista-simple">
        {recibo.pagos.map((p, i) => (
          <li key={i}>
            {p.medio === 'qr' ? `QR registrado por ${registradoPor?.['qr'] ?? 'el vendedor'}` : (MEDIO_TEXTO[p.medio] ?? p.medio)}: {formatearMonto(p.monto, p.moneda as Moneda)}
          </li>
        ))}
      </ul>
      {recibo.cotizacion && (
        <p class="texto-suave">
          Cotización usada: {recibo.cotizacion.par} {recibo.cotizacion.valor} ({recibo.cotizacion.fuente}, {recibo.cotizacion.fecha})
        </p>
      )}
      {recibo.plantilla.politicaGarantia && <p class="texto-suave">{recibo.plantilla.politicaGarantia}</p>}
      {recibo.plantilla.politicaCambios && <p class="texto-suave">{recibo.plantilla.politicaCambios}</p>}
      {recibo.plantilla.pie && <p class="texto-suave">{recibo.plantilla.pie}</p>}
      {recibo.anulacion && <p>Anulado: {recibo.anulacion.motivo}</p>}
    </article>
  );
}

/** Acciones del comprobante: imprimir, enlace de WhatsApp (`wa.me`, lo envía la persona) y referencia de la factura SUMA. */
export function AccionesRecibo({ recibo, alCambiar }: { recibo: Recibo; alCambiar: () => void }): JSX.Element {
  const { api, usuario } = useApp();
  const wa = useAccion();
  const suma = useAccion();
  const [enlace, setEnlace] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [factura, setFactura] = useState(recibo.facturaSuma ?? '');
  const [guardada, setGuardada] = useState(false);

  const enviar = (): void => {
    void wa.ejecutar(async () => {
      // El servidor genera y guarda el PDF y devuelve el enlace `wa.me` que la persona abre y envía.
      const r = await api.llamar('enviarRecibo', { reciboId: recibo.reciboId });
      setEnlace(r.enlace ?? null);
      setAviso(
        r.estado === 'sin_telefono'
          ? 'La venta no tiene teléfono del cliente.'
          : r.estado === 'fallido'
            ? 'No se pudo preparar el enlace.'
            : null,
      );
      alCambiar();
    });
  };

  const guardarFactura = (): void => {
    void suma.ejecutar(async () => {
      await api.llamar('referenciarFacturaSuma', { reciboId: recibo.reciboId, facturaSuma: factura.trim() });
      setGuardada(true);
      alCambiar();
    });
  };

  return (
    <div class="acciones-recibo no-imprimir">
      <div class="fila">
        <Boton variante="secundario" onClick={() => window.print()} chico>
          Imprimir
        </Boton>
        <Boton variante="secundario" onClick={enviar} ocupado={wa.ocupado} deshabilitado={recibo.estado === 'ANULADO'} chico>
          Preparar WhatsApp
        </Boton>
        {enlace && (
          <a class="boton boton-cta boton-chico" href={enlace} target="_blank" rel="noopener noreferrer">
            Abrir WhatsApp (se envía desde su teléfono)
          </a>
        )}
      </div>
      {wa.error && <Alerta>{wa.error}</Alerta>}
      {aviso && <Alerta tipo="info">{aviso}</Alerta>}
      {usuario.rol !== 'caj' && recibo.estado !== 'ANULADO' && (
        <div class="fila fila-alinear">
          <Campo etiqueta="N.º de factura SUMA" valor={factura} onInput={(v) => { setFactura(v); setGuardada(false); }} maxLength={40} ayuda="Solo referencia: el sistema no factura." />
          <Boton variante="secundario" chico onClick={guardarFactura} ocupado={suma.ocupado} deshabilitado={factura.trim() === ''}>
            Guardar referencia
          </Boton>
        </div>
      )}
      {suma.error && <Alerta>{suma.error}</Alerta>}
      {guardada && <Alerta tipo="ok">Referencia de factura guardada.</Alerta>}
    </div>
  );
}
