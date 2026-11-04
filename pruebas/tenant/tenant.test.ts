import { describe, expect, it } from 'vitest';
import { esTenantIdValido, proyectoFirebase, validarTenant } from '@novutienda/nucleo';

const ok = () => ({
  plan: 'base',
  modulos: { inventarios: { version: '1.0.0', submodulos: ['series'] } },
  zonaHoraria: 'America/La_Paz',
  monedas: ['BOB', 'USD', 'ARS'],
});

describe('documento de tenant', () => {
  it('acepta un documento válido', () => {
    expect(validarTenant(ok()).ok).toBe(true);
  });

  it.each([
    ['no objeto', 5],
    ['plan desconocido', { ...ok(), plan: 'oro' }],
    ['zona distinta', { ...ok(), zonaHoraria: 'UTC' }],
    ['monedas incompletas', { ...ok(), monedas: ['BOB'] }],
    ['monedas ajenas', { ...ok(), monedas: ['BOB', 'USD', 'EUR'] }],
    ['modulos no objeto', { ...ok(), modulos: [] }],
    ['versión mala', { ...ok(), modulos: { a: { version: '1', submodulos: [] } } }],
    ['submódulos malos', { ...ok(), modulos: { a: { version: '1.0.0', submodulos: [1] } } }],
    ['módulo no objeto', { ...ok(), modulos: { a: 3 } }],
    ['id de módulo vacío', { ...ok(), modulos: { '': { version: '1.0.0', submodulos: [] } } }],
  ])('rechaza: %s', (_n, x) => {
    expect(validarTenant(x).ok).toBe(false);
  });

  it('valida el tenantId', () => {
    expect(esTenantIdValido('casa-bermejo')).toBe(true);
    for (const x of ['', 'A', 'a/b', '..', '-a', 5]) expect(esTenantIdValido(x)).toBe(false);
  });

  it('el proyecto Firebase sale de la configuración y falla si falta', () => {
    expect(proyectoFirebase({ FIREBASE_PROJECT_ID: 'demo-proyecto' })).toBe('demo-proyecto');
    expect(() => proyectoFirebase({})).toThrow(/FIREBASE_PROJECT_ID/);
    expect(() => proyectoFirebase({ FIREBASE_PROJECT_ID: 'X/..' })).toThrow();
  });
});
