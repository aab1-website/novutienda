/** Formato de montos. Los montos viajan en centavos enteros; aquí solo se presentan. */
import type { Moneda } from '@novutienda/nucleo';

const PREFIJO: Readonly<Record<Moneda, string>> = { BOB: 'Bs ', ARS: '$ ', USD: 'US$ ' };

/** `12345` centavos de BOB -> «Bs 123,45»; sin decimales si son cero. Separador de miles: punto. */
export function formatearMonto(centavos: number, moneda: Moneda): string {
  if (!Number.isSafeInteger(centavos)) throw new RangeError('los centavos deben ser un entero seguro');
  const signo = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const entero = Math.trunc(abs / 100);
  const resto = abs % 100;
  const miles = String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decimales = resto === 0 ? '' : `,${String(resto).padStart(2, '0')}`;
  return `${signo}${PREFIJO[moneda]}${miles}${decimales}`;
}

/** Interpreta lo que escribe una persona: «1.234,5», «1234.5», «1 234,50». Devuelve null si no es un monto. */
export function parsearMonto(texto: string): number | null {
  const t = texto.trim().replace(/\s+/g, '');
  if (t === '') return null;
  let normal: string;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) normal = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d+(,\d+)?$/.test(t)) normal = t.replace(',', '.');
  else if (/^\d+(\.\d+)?$/.test(t)) normal = t;
  else return null;
  const n = Number(normal);
  return Number.isFinite(n) && n >= 0 && n <= 1e12 ? n : null;
}
