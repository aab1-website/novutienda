import { crearValidador, entero, objeto, texto, type Campo, type Fixtures } from './esquema.js';

/** CONTRATO CONGELADO al terminar la ola 1c: un cambio incompatible exige un contrato v2. */
export const TIPO_TURNO_CERRADO_V1 = 'turno.cerrado';

/**
 * Montos en enteros de centavos. `diferencia` = `contado` − `esperado` (negativa
 * si falta dinero). El efectivo se informa aparte de qr, transferencia y crédito;
 * esos cuatro son los cobros netos del turno por medio (un reembolso de otro
 * turno puede dejarlos negativos).
 */
export interface ArqueoMoneda {
  readonly apertura: number;
  readonly esperado: number;
  readonly contado: number;
  readonly diferencia: number;
  readonly efectivo: number;
  readonly qr: number;
  readonly transferencia: number;
  readonly credito: number;
}

export type MonedaTurno = 'BOB' | 'USD' | 'ARS';

export interface DatosTurnoCerradoV1 {
  readonly turnoId: string;
  readonly cajaId: string;
  readonly cajeroUid: string;
  /** Al menos una de BOB, USD o ARS; las ausentes no tuvieron movimiento. */
  readonly monedas: Readonly<Partial<Record<MonedaTurno, ArqueoMoneda>>>;
}

const MONEDAS: readonly string[] = ['BOB', 'USD', 'ARS'];

const arqueo = objeto({
  apertura: entero(0),
  esperado: entero(0),
  contado: entero(0),
  diferencia: entero(),
  efectivo: entero(),
  qr: entero(),
  transferencia: entero(),
  credito: entero(),
});

const monedasTurno: Campo = (v, r) => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return `${r} debe ser un objeto`;
  const claves = Object.keys(v);
  if (claves.length === 0) return `${r} requiere al menos una moneda`;
  for (const k of claves) {
    if (!MONEDAS.includes(k)) return `${r}.${k} no es una moneda del turno (BOB, USD, ARS)`;
    const e = arqueo((v as Record<string, unknown>)[k], `${r}.${k}`);
    if (e !== null) return e;
  }
  return null;
};

export const validarTurnoCerradoV1 = crearValidador<DatosTurnoCerradoV1>(
  { turnoId: texto, cajaId: texto, cajeroUid: texto, monedas: monedasTurno },
  (d) => {
    for (const [m, a] of Object.entries(d.monedas)) {
      if (a.diferencia !== a.contado - a.esperado) return `datos.monedas.${m}.diferencia debe ser contado - esperado`;
    }
    return null;
  },
);

const bob: ArqueoMoneda = { apertura: 20000, esperado: 100000, contado: 99500, diferencia: -500, efectivo: 80000, qr: 30000, transferencia: 0, credito: 0 };
const usd: ArqueoMoneda = { apertura: 0, esperado: 5000, contado: 5000, diferencia: 0, efectivo: 5000, qr: 0, transferencia: 2000, credito: 1000 };

const valido: DatosTurnoCerradoV1 = { turnoId: 't1', cajaId: 'c1', cajeroUid: 'u-caj', monedas: { BOB: bob, USD: usd } };

export const fixturesTurnoCerradoV1: Fixtures<DatosTurnoCerradoV1> = {
  validos: [valido, { ...valido, monedas: { ARS: { ...bob, diferencia: 0, contado: 100000 } } }],
  invalidos: [
    { nombre: 'diferencia inconsistente', datos: { ...valido, monedas: { BOB: { ...bob, diferencia: 5 } } } },
    { nombre: 'sin monedas', datos: { ...valido, monedas: {} } },
    { nombre: 'moneda inválida', datos: { ...valido, monedas: { bob } } },
    { nombre: 'moneda fuera de BOB, USD y ARS', datos: { ...valido, monedas: { EUR: bob } } },
    { nombre: 'monto decimal', datos: { ...valido, monedas: { BOB: { ...bob, esperado: 1.5 } } } },
    { nombre: 'falta contado', datos: { ...valido, monedas: { BOB: { ...bob, contado: undefined } } } },
    { nombre: 'falta apertura', datos: { ...valido, monedas: { BOB: { ...bob, apertura: undefined } } } },
    { nombre: 'falta el desglose de qr', datos: { ...valido, monedas: { BOB: { ...bob, qr: undefined } } } },
    { nombre: 'sin caja', datos: { ...valido, cajaId: undefined } },
    { nombre: 'sin cajero', datos: { ...valido, cajeroUid: undefined } },
    { nombre: 'campo sobrante en el arqueo', datos: { ...valido, monedas: { BOB: { ...bob, otro: 1 } } } },
  ],
};
