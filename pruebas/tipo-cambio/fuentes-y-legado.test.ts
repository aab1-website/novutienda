import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COMERCIAL_LEGADO_TRES_MONEDAS,
  PAR_DE_FUENTE,
  actualizarMercadoDe,
  cargarManualDe,
  escribirCotizacionDe,
  leerCotizacionDe,
  validarConfiguracionComercial,
  type ConfiguracionComercial,
} from '@novutienda/nucleo';
import { AHORA, AlmacenMemoria } from './ayudas.js';

const clp = (fuentes: string[], par = 'CLP/USD'): unknown => ({
  mercados: [{
    id: 'CL', nombre: 'Chile', monedaVenta: 'CLP', monedaBase: 'USD', zonaHoraria: 'America/Santiago',
    tipoCambio: { par, fuentes }, redondeo: { tipo: 'decimales', decimales: 0, modo: 'cercano' },
  }],
  monedas: ['CLP', 'USD'],
});

describe('fuentes atadas al par', () => {
  it('tabla fuente → par', () => {
    expect(PAR_DE_FUENTE).toEqual({ BCB: 'BOB/USD', BNA: 'ARS/USD', BCRA: 'ARS/USD' });
  });
  it('una fuente automática de otro par se rechaza; otro par admite solo manual', () => {
    for (const f of ['BCB', 'BNA', 'BCRA']) {
      expect(validarConfiguracionComercial(clp([f]))).toMatchObject({ ok: false, error: expect.stringContaining(`la fuente ${f} solo sirve para`) });
    }
    expect(validarConfiguracionComercial(clp(['manual'])).ok).toBe(true);
    expect(validarConfiguracionComercial(clp(['BNA', 'manual'], 'BOB/USD')).ok).toBe(false);
  });
  it('las fuentes correctas siguen aceptadas', () => {
    expect(validarConfiguracionComercial(COMERCIAL_LEGADO_TRES_MONEDAS).ok).toBe(true);
  });
  it('en ejecución no se consulta una fuente que no corresponde al par (defensa en profundidad)', async () => {
    const mala = (clp(['BCB']) as ConfiguracionComercial);
    let llamadas = 0;
    const fetchFn = (() => { llamadas++; return Promise.reject(new Error('no debe consultarse')); }) as never;
    const almacen = new AlmacenMemoria();
    const r = await actualizarMercadoDe(almacen, 'CL', AHORA, { fetchFn, tenantId: 'tenant-x', comercial: mala });
    expect(llamadas).toBe(0);
    expect(r.escrita).toBeNull();
    expect(r.fallas.join(' ')).toContain('sirve para BOB/USD, no para CLP/USD');
  });
});

describe('la API por tenant exige la declaración (falla cerrado)', () => {
  it('un mercado no declarado no se lee, no se escribe y no se carga a mano', async () => {
    const almacen = new AlmacenMemoria();
    const c = COMERCIAL_LEGADO_TRES_MONEDAS;
    await expect(leerCotizacionDe(almacen, 'CL', AHORA, { tenantId: 'tenant-x', comercial: c })).rejects.toThrow(/no está declarado/);
    await expect(actualizarMercadoDe(almacen, 'CL', AHORA, { tenantId: 'tenant-x', comercial: c })).rejects.toThrow(RangeError);
    await expect(
      cargarManualDe(almacen, { mercado: 'CL', valor: 950, fecha: '2026-11-04', actor: { uid: 'u', rol: 'adm', proveedor: 'password' }, ahoraMs: AHORA }, { tenantId: 'tenant-x', comercial: c }),
    ).rejects.toThrow(RangeError);
    await expect(escribirCotizacionDe(almacen, { mercado: 'CL', principal: null, control: null, ahoraMs: AHORA }, { tenantId: 'tenant-x', comercial: c })).rejects.toThrow(RangeError);
    expect(almacen.docs.size).toBe(0);
  });
});

/** Símbolos LEGADO del núcleo: marcados `@deprecated`. La lista solo puede achicarse. */
const LEGADO_ADMITIDO = [
  'COMERCIAL_LEGADO_TRES_MONEDAS', 'MERCADOS', 'MONEDAS', 'MONEDA_DE', 'PAR_DE', 'ZONA_DE', 'ZONA_HORARIA', 'comercialLegado',
  'actualizarMercado', 'cargarManual', 'decidirCotizacion', 'escribirCotizacion', 'leerCotizacion', 'manejarCotizacion', 'precioFinal',
].sort();

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const r = `${dir}/${n}`;
    return statSync(r).isDirectory() ? archivos(r) : /\.ts$/.test(n) && !/\.test\.ts$/.test(n) ? [r] : [];
  });
}

describe('símbolos legado del núcleo', () => {
  it('son exactamente los admitidos: agregar uno nuevo falla', () => {
    const raiz = fileURLToPath(new URL('../../paquetes/nucleo/src', import.meta.url));
    const hallados = new Set<string>();
    for (const f of archivos(raiz)) {
      const txt = readFileSync(f, 'utf8');
      for (const m of txt.matchAll(/@deprecated[\s\S]*?\*\/\s*\n\s*export (?:async )?(?:const|function|type|interface) (\w+)/g)) {
        if (m[1] !== undefined) hallados.add(m[1]);
      }
    }
    expect([...hallados].sort()).toEqual(LEGADO_ADMITIDO);
  });
});
