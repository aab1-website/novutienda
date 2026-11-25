import { arreglo, crearValidador, moneda, type Fixtures } from './esquema.js';

export const TIPO_REDONDEO_CAMBIADO_V1 = 'redondeo.cambiado';

/** Solo las monedas cuya regla cambió, sin repetir; nunca las reglas (el consumidor las lee de `config/redondeo`). */
export interface DatosRedondeoCambiadoV1 {
  readonly monedas: readonly string[];
}

export const validarRedondeoCambiadoV1 = crearValidador<DatosRedondeoCambiadoV1>(
  { monedas: arreglo(moneda, 1) },
  (d) => (new Set(d.monedas).size !== d.monedas.length ? 'datos.monedas no admite repetidos' : null),
);

export const fixturesRedondeoCambiadoV1: Fixtures<DatosRedondeoCambiadoV1> = {
  validos: [{ monedas: ['BOB'] }, { monedas: ['BOB', 'ARS'] }],
  invalidos: [
    { nombre: 'sin monedas', datos: { monedas: [] } },
    { nombre: 'moneda repetida', datos: { monedas: ['BOB', 'BOB'] } },
    { nombre: 'moneda mal escrita', datos: { monedas: ['bob'] } },
    { nombre: 'lleva las reglas', datos: { monedas: ['BOB'], reglas: {} } },
    { nombre: 'sin campo monedas', datos: {} },
  ],
};
