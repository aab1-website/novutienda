import { crearValidador, entero, objeto, porMoneda, texto, type Fixtures } from './esquema.js';

export const TIPO_TURNO_CERRADO_V1 = 'turno.cerrado';

/** Montos en enteros de centavos; la diferencia puede ser negativa (faltante). */
export interface ArqueoMoneda {
  readonly esperado: number;
  readonly contado: number;
  readonly diferencia: number;
}

export interface DatosTurnoCerradoV1 {
  readonly turnoId: string;
  readonly monedas: Readonly<Record<string, ArqueoMoneda>>;
}

export const validarTurnoCerradoV1 = crearValidador<DatosTurnoCerradoV1>(
  { turnoId: texto, monedas: porMoneda(objeto({ esperado: entero(0), contado: entero(0), diferencia: entero() })) },
  (d) => {
    for (const [m, a] of Object.entries(d.monedas)) {
      if (a.diferencia !== a.contado - a.esperado) return `datos.monedas.${m}.diferencia debe ser contado - esperado`;
    }
    return null;
  },
);

const valido: DatosTurnoCerradoV1 = {
  turnoId: 't1',
  monedas: { BOB: { esperado: 100000, contado: 99500, diferencia: -500 }, USD: { esperado: 5000, contado: 5000, diferencia: 0 } },
};

export const fixturesTurnoCerradoV1: Fixtures<DatosTurnoCerradoV1> = {
  validos: [valido],
  invalidos: [
    { nombre: 'diferencia inconsistente', datos: { turnoId: 't1', monedas: { BOB: { esperado: 100, contado: 90, diferencia: 5 } } } },
    { nombre: 'sin monedas', datos: { turnoId: 't1', monedas: {} } },
    { nombre: 'moneda inválida', datos: { turnoId: 't1', monedas: { bob: { esperado: 0, contado: 0, diferencia: 0 } } } },
    { nombre: 'monto decimal', datos: { turnoId: 't1', monedas: { BOB: { esperado: 1.5, contado: 1.5, diferencia: 0 } } } },
    { nombre: 'falta contado', datos: { turnoId: 't1', monedas: { BOB: { esperado: 1, diferencia: 0 } } } },
  ],
};
