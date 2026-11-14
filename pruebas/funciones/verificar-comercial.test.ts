// Comprobación D7 del redondeo (`plataforma/operador/verificar-comercial.ts`) y su script de solo lectura
// (`scripts/verificar-comercial.mjs`): lógica pura, guardias de entorno y corrida completa contra el emulador.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { hayEmulador, herramientas, unico } from './ayudas.js';
import { lineasDelInforme, motivoIncumpleD7, verificarComercial, type InformeComercial, type ResultadoVerificacion } from '../../plataforma/operador/verificar-comercial.js';

const LEGADO = { estado: 'activo', plan: 'base', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] };
const mercado = (id: string, moneda: string, redondeo: unknown) => ({
  id, nombre: `Mercado ${id}`, monedaVenta: moneda, monedaBase: moneda, zonaHoraria: 'America/La_Paz', tipoCambio: null, redondeo,
});
const v3 = (redondeo: unknown) => ({ estado: 'activo', plan: 'base', modulos: {}, comercial: { mercados: [mercado('BO', 'BOB', redondeo)], monedas: ['BOB'] } });
const informeDe = (r: ResultadoVerificacion): InformeComercial => {
  if (!r.ok) throw new Error(r.error);
  return r.informe;
};
const D2 = { tipo: 'decimales', decimales: 2, modo: 'cercano' };

describe('motivoIncumpleD7', () => {
  it.each([
    [{ tipo: 'decimales', decimales: 0, modo: 'cercano' }],
    [{ tipo: 'decimales', decimales: 1, modo: 'abajo' }],
    [D2],
    [{ tipo: 'multiplo', multiplo: 0.01, modo: 'cercano' }],
    [{ tipo: 'multiplo', multiplo: 0.05, modo: 'arriba' }],
    [{ tipo: 'multiplo', multiplo: 100, modo: 'cercano' }],
  ])('cumple %j', (r) => {
    expect(motivoIncumpleD7(r)).toBeNull();
  });

  it('«ninguno» no cumple', () => {
    expect(motivoIncumpleD7({ tipo: 'ninguno' })).toBe('regla ninguno');
  });
  it('más de 2 decimales no cumple y dice cuántos', () => {
    expect(motivoIncumpleD7({ tipo: 'decimales', decimales: 3, modo: 'cercano' })).toBe('decimales 3');
    expect(motivoIncumpleD7({ tipo: 'decimales', decimales: 6, modo: 'cercano' })).toBe('decimales 6');
  });
  it('un múltiplo menor de 0,01 o fuera de centavos no cumple', () => {
    for (const multiplo of [0.005, 0.001, 0.015, 0.125, 2.505]) {
      expect(motivoIncumpleD7({ tipo: 'multiplo', multiplo, modo: 'cercano' })).toBe('múltiplo no exacto en centavos');
    }
  });
  it('una regla mal formada no cumple', () => {
    for (const r of [undefined, null, 'x', { tipo: 'otro' }, { tipo: 'decimales', decimales: 2 }, { tipo: 'multiplo', multiplo: 0, modo: 'cercano' }]) {
      expect(motivoIncumpleD7(r)).toBe('regla inválida');
    }
  });
});

describe('verificarComercial', () => {
  it('forma anterior sin documento de redondeo: evalúa los valores por omisión del servidor y cumple', () => {
    const r = verificarComercial(LEGADO, undefined);
    expect(r).toMatchObject({ ok: true, informe: { forma: 'anterior', plan: 'base', origen: 'valores por omisión del servidor', cumple: true } });
    expect(lineasDelInforme(informeDe(r)).slice(3)).toEqual(['BOB: cumple D7', 'ARS: cumple D7']);
  });

  it('v3: evalúa la regla declarada de cada moneda de venta', () => {
    expect(verificarComercial(v3(D2), undefined)).toMatchObject({ ok: true, informe: { forma: 'v3 (comercial)', cumple: true, monedas: [{ moneda: 'BOB', cumple: true }] } });
    const r = verificarComercial(v3({ tipo: 'ninguno' }), undefined);
    expect(r).toMatchObject({ ok: true, informe: { cumple: false, monedas: [{ moneda: 'BOB', cumple: false, motivo: 'regla ninguno' }] } });
  });

  it('el documento config/redondeo manda sobre la configuración', () => {
    const malo = verificarComercial(LEGADO, { BOB: D2, ARS: { tipo: 'multiplo', multiplo: 0.005, modo: 'cercano' } });
    expect(malo).toMatchObject({ ok: true, informe: { origen: 'documento config/redondeo', cumple: false } });
    expect(lineasDelInforme(informeDe(malo)).slice(3)).toEqual(['BOB: cumple D7', 'ARS: NO cumple (múltiplo no exacto en centavos)']);
    expect(verificarComercial(v3({ tipo: 'ninguno' }), { BOB: D2 })).toMatchObject({ ok: true, informe: { cumple: true } });
  });

  it('una moneda de venta sin regla en el documento no cumple', () => {
    const r = verificarComercial(LEGADO, { BOB: D2 });
    expect(r).toMatchObject({ ok: true, informe: { cumple: false, monedas: [{ moneda: 'BOB', cumple: true }, { moneda: 'ARS', cumple: false, motivo: 'regla inválida' }] } });
  });

  it('dos mercados con la misma moneda dan una sola línea; basta una regla mala', () => {
    const t = { ...v3(D2), plan: 'multimercado', comercial: { mercados: [mercado('BO', 'BOB', D2), mercado('XX', 'BOB', { tipo: 'decimales', decimales: 3, modo: 'cercano' })], monedas: ['BOB'] } };
    expect(verificarComercial(t, undefined)).toMatchObject({ ok: true, informe: { cumple: false, monedas: [{ moneda: 'BOB', motivo: 'decimales 3' }] } });
  });

  it('plan desconocido se informa como tal; tenant ausente o ilegible falla', () => {
    expect(verificarComercial({ ...v3(D2), plan: 'secreto' }, undefined)).toMatchObject({ ok: true, informe: { plan: 'desconocido' } });
    expect(verificarComercial(undefined, undefined)).toMatchObject({ ok: false });
    expect(verificarComercial({ plan: 'base' }, undefined)).toMatchObject({ ok: false });
    expect(verificarComercial({ comercial: 'x' }, undefined)).toMatchObject({ ok: false });
  });

  it('las líneas no vuelcan nombres ni el contenido de los documentos', () => {
    const texto = lineasDelInforme(informeDe(verificarComercial(v3(D2), undefined))).join('\n');
    expect(texto).not.toContain('Mercado');
    expect(texto).not.toContain('America/La_Paz');
  });
});

describe('scripts/verificar-comercial.mjs: guardias previas a tocar la nube', () => {
  const correr = (args: string[], env: Record<string, string> = {}) =>
    spawnSync('node', ['scripts/verificar-comercial.mjs', ...args], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', ...env } });
  it('sin entorno de operador se niega con código 2', () => {
    const r = correr(['tenant-a', '--proyecto', 'demo-x']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('GOOGLE_CLOUD_PROJECT');
  });
  it('se niega en producción, fuera de staging y con uso incorrecto', () => {
    const prod = { GOOGLE_CLOUD_PROJECT: 'proyecto-prod', NOVUTIENDA_AMBIENTE: 'produccion', GCP_PROJECT_ID_PROD: 'proyecto-prod' };
    expect(correr(['tenant-a', '--proyecto', 'proyecto-prod'], prod)).toMatchObject({ status: 2 });
    const otro = { GOOGLE_CLOUD_PROJECT: 'proyecto-otro', NOVUTIENDA_AMBIENTE: 'staging', GCP_PROJECT_ID_STAGING: 'proyecto-stg' };
    const r = correr(['tenant-a', '--proyecto', 'proyecto-otro'], otro);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('no es el de staging');
    expect(r.stderr).not.toContain('proyecto-otro');
    expect(correr(['--proyecto', 'x']).stderr).toContain('uso:');
    expect(correr(['a', '--aplicar']).stderr).toContain('uso:');
  });
});

describe.skipIf(!hayEmulador)('scripts/verificar-comercial.mjs contra el emulador', () => {
  const correr = (tenant: string) =>
    spawnSync('node', ['scripts/verificar-comercial.mjs', tenant, '--proyecto', 'demo-pruebas'], {
      encoding: 'utf8',
      env: { ...process.env, GOOGLE_CLOUD_PROJECT: 'demo-pruebas', NOVUTIENDA_AMBIENTE: 'emulador' },
    });

  it('cumple, no cumple, documento ausente y tenant inexistente', async () => {
    const h = herramientas();
    const ok = unico('vc-ok').toLowerCase();
    const mal = unico('vc-mal').toLowerCase();
    const sin = unico('vc-sin').toLowerCase();
    const doc = unico('vc-doc').toLowerCase();
    await h.firestore.doc(`tenants/${ok}`).set(v3(D2));
    await h.firestore.doc(`tenants/${mal}`).set(v3({ tipo: 'ninguno' }));
    await h.firestore.doc(`tenants/${sin}`).set(LEGADO);
    await h.firestore.doc(`tenants/${doc}`).set(LEGADO);
    await h.firestore.doc(`tenants/${doc}/config/redondeo`).set({ BOB: { tipo: 'decimales', decimales: 3, modo: 'cercano' }, ARS: D2 });

    const a = correr(ok);
    expect(a.status, a.stderr).toBe(0);
    expect(a.stdout).toContain('BOB: cumple D7');
    expect(a.stdout).toContain('forma del tenant: v3 (comercial)');

    const b = correr(mal);
    expect(b.status, b.stderr).toBe(1);
    expect(b.stdout).toContain('BOB: NO cumple (regla ninguno)');

    const c = correr(sin);
    expect(c.status, c.stderr).toBe(0);
    expect(c.stdout).toContain('valores por omisión del servidor');
    expect(c.stdout).toContain('ARS: cumple D7');

    const d = correr(doc);
    expect(d.status, d.stderr).toBe(1);
    expect(d.stdout).toContain('BOB: NO cumple (decimales 3)');
    expect(d.stdout).toContain('ARS: cumple D7');

    const e = correr(unico('vc-no').toLowerCase());
    expect(e.status).toBe(2);
    for (const r of [a, b, c, d, e]) {
      for (const x of ['demo-pruebas', 'Mercado', 'America/La_Paz']) expect(r.stdout + r.stderr).not.toContain(x);
    }
  }, 60_000);
});
