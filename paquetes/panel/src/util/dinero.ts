import type { Moneda } from '@novutienda/nucleo';

const PREFIJO: Readonly<Record<Moneda, string>> = { BOB: 'Bs', USD: 'USD', ARS: 'ARS' };

/** Centavos enteros a texto: «Bs 1.234,50» (miles con punto, decimales con coma). */
export function formatearMonto(centavos: number, moneda: Moneda): string {
  const signo = centavos < 0 ? '-' : '';
  const a = Math.abs(Math.round(centavos));
  const entero = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${signo}${PREFIJO[moneda]} ${entero},${String(a % 100).padStart(2, '0')}`;
}

/** Número entero de centavos a texto editable («12,50»). */
export function centavosATexto(centavos: number): string {
  const a = Math.abs(centavos);
  return `${centavos < 0 ? '-' : ''}${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`;
}

/**
 * Texto escrito por la persona a centavos enteros. Acepta «12», «12,5», «12.50» y «1.234,50». Devuelve `null` si no es
 * un monto no negativo con hasta dos decimales.
 */
export function textoACentavos(texto: string): number | null {
  const t = texto.trim().replace(/\s/g, '');
  if (t === '') return null;
  const normal = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t) ? t.replaceAll('.', '').replace(',', '.') : t.replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null;
  const [e = '0', d = ''] = normal.split('.');
  const c = Number(e) * 100 + Number(d.padEnd(2, '0'));
  return Number.isSafeInteger(c) ? c : null;
}
