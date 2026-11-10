import { describe, expect, it } from 'vitest';
import {
  ESTADOS_TENANT,
  esTenantIdValido,
  proyectoFirebase,
  tenantOperativo,
  transicionValida,
  validarTenant,
} from '@novutienda/nucleo';

const ok = () => ({
  estado: 'activo',
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
    ['estado ausente', { ...ok(), estado: undefined }],
    ['estado desconocido', { ...ok(), estado: 'pausado' }],
    ['estado no texto', { ...ok(), estado: 1 }],
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

describe('estado del tenant', () => {
  it('solo activo es operativo', () => {
    expect(tenantOperativo({ estado: 'activo' })).toBe(true);
    expect(tenantOperativo({ estado: 'suspendido' })).toBe(false);
    expect(tenantOperativo({ estado: 'baja' })).toBe(false);
  });

  it('acepta cada estado conocido', () => {
    for (const e of ESTADOS_TENANT) expect(validarTenant({ ...ok(), estado: e }).ok).toBe(true);
  });

  it.each([
    ['activo', 'suspendido', true],
    ['suspendido', 'activo', true],
    ['activo', 'baja', true],
    ['suspendido', 'baja', true],
    ['activo', 'activo', false],
    ['suspendido', 'suspendido', false],
    ['baja', 'activo', false],
    ['baja', 'suspendido', false],
    ['baja', 'baja', false],
  ] as const)('transición %s -> %s = %s', (de, a, esperado) => {
    expect(transicionValida(de, a)).toBe(esperado);
  });
});
