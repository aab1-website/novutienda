import { crearValidador, entero, moneda, objeto, texto, type Campo, type Fixtures } from './esquema.js';
import type { ArqueoMoneda } from './turno-cerrado.v1.js';

/**
 * Contrato v2 del cierre de turno: igual que la v1, con arqueos por cualquier moneda ISO (tres letras mayúsculas)
 * declarada por el tenant en vez de solo BOB, USD y ARS. Que la moneda exista en el tenant lo comprueba el servidor.
 */
export const TIPO_TURNO_CERRADO_V2 = 'turno.cerrado';

/** Tope de monedas por cierre: el mismo que las monedas de caja del tenant (`MAX_MONEDAS`). */
export const MAX_MONEDAS_TURNO = 20;

export interface DatosTurnoCerradoV2 {
  readonly turnoId: string;
  readonly cajaId: string;
  readonly cajeroUid: string;
  /** Al menos una moneda; las ausentes no tuvieron movimiento. */
  readonly monedas: Readonly<Record<string, ArqueoMoneda>>;
}

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
  if (claves.length > MAX_MONEDAS_TURNO) return `${r} admite como máximo ${MAX_MONEDAS_TURNO} monedas`;
  for (const k of claves) {
    const m = moneda(k, `${r}.${k}`);
    if (m !== null) return m;
    const e = arqueo((v as Record<string, unknown>)[k], `${r}.${k}`);
    if (e !== null) return e;
  }
  return null;
};

export const validarTurnoCerradoV2 = crearValidador<DatosTurnoCerradoV2>(
  { turnoId: texto, cajaId: texto, cajeroUid: texto, monedas: monedasTurno },
  (d) => {
    for (const [m, a] of Object.entries(d.monedas)) {
      if (a.diferencia !== a.contado - a.esperado) return `datos.monedas.${m}.diferencia debe ser contado - esperado`;
    }
    return null;
  },
);

const clp: ArqueoMoneda = { apertura: 20000, esperado: 100000, contado: 99500, diferencia: -500, efectivo: 80000, qr: 30000, transferencia: 0, credito: 0 };
const eur: ArqueoMoneda = { apertura: 0, esperado: 5000, contado: 5000, diferencia: 0, efectivo: 5000, qr: 0, transferencia: 2000, credito: 1000 };
const valido: DatosTurnoCerradoV2 = { turnoId: 't1', cajaId: 'c1', cajeroUid: 'u-caj', monedas: { CLP: clp, EUR: eur } };

export const fixturesTurnoCerradoV2: Fixtures<DatosTurnoCerradoV2> = {
  validos: [valido, { ...valido, monedas: { BRL: { ...clp, diferencia: 0, contado: 100000 } } }],
  invalidos: [
    { nombre: 'diferencia inconsistente', datos: { ...valido, monedas: { CLP: { ...clp, diferencia: 5 } } } },
    { nombre: 'sin monedas', datos: { ...valido, monedas: {} } },
    { nombre: 'moneda en minúsculas', datos: { ...valido, monedas: { clp } } },
    { nombre: 'moneda de dos letras', datos: { ...valido, monedas: { CL: clp } } },
    { nombre: 'monto decimal', datos: { ...valido, monedas: { CLP: { ...clp, esperado: 1.5 } } } },
    { nombre: 'falta contado', datos: { ...valido, monedas: { CLP: { ...clp, contado: undefined } } } },
    { nombre: 'sin caja', datos: { ...valido, cajaId: undefined } },
    { nombre: 'campo sobrante en el arqueo', datos: { ...valido, monedas: { CLP: { ...clp, otro: 1 } } } },
  ],
};
