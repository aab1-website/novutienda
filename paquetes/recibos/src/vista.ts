import { esUrlHttps } from './plantilla.js';
import type { Recibo } from './tipos.js';

const ENTIDADES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

/** Escapa todo texto que se inserta en HTML. */
export const escaparHtml = (v: string): string => v.replace(/[&<>"'`]/g, (c) => ENTIDADES[c] ?? c);

/** Importe en centavos como texto con dos decimales (sin coma de miles). */
export function formatearMonto(centavos: number, moneda: string): string {
  const signo = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  return `${signo}${String(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, '0')} ${moneda}`;
}

const MEDIOS: Readonly<Record<string, string>> = { efectivo: 'Efectivo', qr: 'QR', transferencia: 'Transferencia', credito: 'Crédito' };

/** Líneas de texto plano del comprobante; base común de la vista HTML y del PDF. */
export function lineasDeTexto(r: Recibo): string[] {
  const t: string[] = [];
  if (r.plantilla.negocio.nombre !== '') t.push(r.plantilla.negocio.nombre);
  const n = r.plantilla.negocio;
  if (n.direccion !== undefined) t.push(n.direccion);
  if (n.telefono !== undefined) t.push(`Tel. ${n.telefono}`);
  if (n.nit !== undefined) t.push(`NIT ${n.nit}`);
  t.push('', `RECIBO NO FISCAL ${r.numero}`);
  if (r.estado === 'ANULADO') t.push('*** ANULADO ***');
  t.push(`Fecha: ${r.fecha}`);
  if (r.cliente !== undefined) t.push(`Cliente: ${r.cliente.nombre}`);
  if (r.facturaSuma !== undefined) t.push(`Factura SUMA (referencia): ${r.facturaSuma}`);
  t.push('');
  for (const l of r.lineas) {
    t.push(`${String(l.cantidad)} x ${l.productoId}  ${formatearMonto(l.precioUnitario, r.moneda)}  =  ${formatearMonto(l.subtotal, r.moneda)}`);
    if (l.series.length > 0) t.push(`  Serie: ${l.series.join(', ')}`);
    if (l.garantiaHasta !== undefined) t.push(`  Garantía hasta: ${l.garantiaHasta}`);
  }
  if (r.descuento !== undefined) t.push(`Descuento: -${formatearMonto(r.descuento.monto, r.moneda)}`);
  t.push(`TOTAL: ${formatearMonto(r.total, r.moneda)}`);
  for (const p of r.pagos) t.push(`Pago ${MEDIOS[p.medio] ?? p.medio}: ${formatearMonto(p.monto, p.moneda)}`);
  if (r.cotizacion !== null) {
    t.push(`Cotización ${r.cotizacion.par}: ${String(r.cotizacion.valor)} (${r.cotizacion.fuente}, ${r.cotizacion.fecha})`);
  }
  if (r.plantilla.politicaGarantia !== undefined) t.push('', `Garantía: ${r.plantilla.politicaGarantia}`);
  if (r.plantilla.politicaCambios !== undefined) t.push(`Cambios: ${r.plantilla.politicaCambios}`);
  if (r.plantilla.pie !== undefined) t.push('', r.plantilla.pie);
  if (r.estado === 'ANULADO' && r.anulacion !== undefined) t.push('', `Anulado: ${r.anulacion.motivo}`);
  return t;
}

/**
 * Vista HTML imprimible. Todo texto variable pasa por `escaparHtml`; sin scripts,
 * sin estilos dinámicos y el logo solo si es https. Quien la sirva debe añadir
 * una CSP restrictiva (`default-src 'none'; img-src https:; style-src 'unsafe-inline'`).
 */
export function renderizarReciboHtml(r: Recibo): string {
  const e = escaparHtml;
  const logo = r.plantilla.logoUrl !== undefined && esUrlHttps(r.plantilla.logoUrl) ? `<img src="${e(r.plantilla.logoUrl)}" alt="Logo" style="max-height:80px">` : '';
  const filas = r.lineas
    .map(
      (l) =>
        `<tr><td>${e(l.productoId)}${l.series.length > 0 ? `<br><small>Serie: ${e(l.series.join(', '))}</small>` : ''}${l.garantiaHasta !== undefined ? `<br><small>Garantía hasta: ${e(l.garantiaHasta)}</small>` : ''}</td><td>${String(l.cantidad)}</td><td>${e(formatearMonto(l.precioUnitario, r.moneda))}</td><td>${e(formatearMonto(l.subtotal, r.moneda))}</td></tr>`,
    )
    .join('');
  const pagos = r.pagos.map((p) => `<li>${e(MEDIOS[p.medio] ?? p.medio)}: ${e(formatearMonto(p.monto, p.moneda))}</li>`).join('');
  const bloque = (titulo: string, v: string | undefined): string => (v === undefined ? '' : `<p><strong>${e(titulo)}</strong> ${e(v)}</p>`);
  return [
    '<!doctype html><html lang="es"><head><meta charset="utf-8">',
    `<title>${e(`Recibo ${r.numero}`)}</title></head>`,
    '<body style="font-family:sans-serif;max-width:640px;margin:auto">',
    logo,
    `<h1>${e(r.plantilla.negocio.nombre)}</h1>`,
    [r.plantilla.negocio.direccion, r.plantilla.negocio.telefono !== undefined ? `Tel. ${r.plantilla.negocio.telefono}` : undefined, r.plantilla.negocio.nit !== undefined ? `NIT ${r.plantilla.negocio.nit}` : undefined]
      .filter((x): x is string => x !== undefined)
      .map((x) => `<div>${e(x)}</div>`)
      .join(''),
    `<h2>Recibo no fiscal ${e(r.numero)}</h2>`,
    r.estado === 'ANULADO' ? '<h2 style="color:#b00">ANULADO</h2>' : '',
    `<p>Fecha: ${e(r.fecha)}</p>`,
    r.cliente !== undefined ? `<p>Cliente: ${e(r.cliente.nombre)}</p>` : '',
    r.facturaSuma !== undefined ? `<p>Factura SUMA (referencia): ${e(r.facturaSuma)}</p>` : '',
    `<table border="1" cellspacing="0" cellpadding="4" style="width:100%"><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr>${filas}</table>`,
    r.descuento !== undefined ? `<p>Descuento: -${e(formatearMonto(r.descuento.monto, r.moneda))}</p>` : '',
    `<p><strong>Total: ${e(formatearMonto(r.total, r.moneda))}</strong></p>`,
    `<ul>${pagos}</ul>`,
    r.cotizacion !== null ? `<p>Cotización ${e(r.cotizacion.par)}: ${e(String(r.cotizacion.valor))} (${e(r.cotizacion.fuente)}, ${e(r.cotizacion.fecha)})</p>` : '',
    bloque('Garantía:', r.plantilla.politicaGarantia),
    bloque('Cambios:', r.plantilla.politicaCambios),
    r.plantilla.pie !== undefined ? `<footer>${e(r.plantilla.pie)}</footer>` : '',
    r.estado === 'ANULADO' && r.anulacion !== undefined ? `<p>Anulado: ${e(r.anulacion.motivo)}</p>` : '',
    '</body></html>',
  ].join('\n');
}

/** Escapa una cadena PDF y la reduce a Latin-1 visible (lo demás pasa a «?»). */
export function escaparPdf(v: string): string {
  let salida = '';
  for (const c of v.normalize('NFC')) {
    const cod = c.codePointAt(0) ?? 63;
    if (c === '\\' || c === '(' || c === ')') salida += `\\${c}`;
    else if (cod >= 32 && cod <= 126) salida += c;
    else if (cod >= 160 && cod <= 255) salida += `\\${cod.toString(8).padStart(3, '0')}`;
    else salida += '?';
  }
  return salida;
}

const LINEAS_POR_PAGINA = 50;

/**
 * PDF mínimo (Helvetica, texto plano) generado sin dependencias. El texto se escapa
 * como cadena PDF; no hay imágenes ni enlaces. Si luego se necesita un diseño con logo,
 * se sustituye por otra implementación detrás del mismo tipo `GeneradorPdf`.
 */
export type GeneradorPdf = (recibo: Recibo) => Uint8Array;

export const generarPdfRecibo: GeneradorPdf = (r) => {
  const lineas = lineasDeTexto(r).flatMap((l) => (l.length <= 90 ? [l] : (l.match(/.{1,90}/g) ?? [l])));
  const paginas: string[][] = [];
  for (let i = 0; i < lineas.length; i += LINEAS_POR_PAGINA) paginas.push(lineas.slice(i, i + LINEAS_POR_PAGINA));
  if (paginas.length === 0) paginas.push([]);
  // Objetos: 1 catálogo, 2 páginas, 3 fuente, luego (página, contenido) por cada página.
  const objetos: string[] = [];
  const idsPagina = paginas.map((_, i) => 4 + i * 2);
  objetos[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objetos[2] = `<< /Type /Pages /Kids [${idsPagina.map((id) => `${String(id)} 0 R`).join(' ')}] /Count ${String(paginas.length)} >>`;
  objetos[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  paginas.forEach((pag, i) => {
    const id = 4 + i * 2;
    const flujo = `BT /F1 10 Tf 14 TL 50 790 Td ${pag.map((l) => `(${escaparPdf(l)}) Tj T*`).join(' ')} ET`;
    objetos[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(id + 1)} 0 R >>`;
    objetos[id + 1] = `<< /Length ${String(flujo.length)} >>\nstream\n${flujo}\nendstream`;
  });
  let cuerpo = '%PDF-1.4\n';
  const desplazamientos: number[] = [];
  for (let id = 1; id < objetos.length; id++) {
    desplazamientos[id] = cuerpo.length;
    cuerpo += `${String(id)} 0 obj\n${objetos[id] ?? ''}\nendobj\n`;
  }
  const inicioXref = cuerpo.length;
  const total = objetos.length;
  cuerpo += `xref\n0 ${String(total)}\n0000000000 65535 f \n`;
  for (let id = 1; id < total; id++) cuerpo += `${String(desplazamientos[id] ?? 0).padStart(10, '0')} 00000 n \n`;
  cuerpo += `trailer\n<< /Size ${String(total)} /Root 1 0 R >>\nstartxref\n${String(inicioXref)}\n%%EOF\n`;
  return Uint8Array.from(cuerpo, (c) => c.charCodeAt(0) & 0xff);
};
