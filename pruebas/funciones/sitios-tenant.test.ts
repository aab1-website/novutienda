// scripts/sitios-tenant.mjs: matriz de reconstrucción y guardia de FIREBASE_DEPLOY_ONLY.
import { describe, expect, it } from 'vitest';
import { construirMatriz, ejecutar, ErrorSitios, parsearSitios, RE_SOLO_STAGING, validarSolo } from '../../scripts/sitios-tenant.mjs';

const A = { clave: 'a1', tenant: 'tienda-a', sitio: 'sitio-aaaa', url: 'https://a.example.com' };
const B = { clave: 'b2', tenant: 'tienda-b', sitio: 'sitio-bbbb', url: 'https://b.example.com/' };
const json = (x: unknown) => JSON.stringify(x);
const errores = (texto: string): string[] => {
  try {
    parsearSitios(texto);
  } catch (e) {
    return [...(e as ErrorSitios).errores];
  }
  return [];
};

describe('parsearSitios', () => {
  it('acepta entradas válidas', () => {
    expect(parsearSitios(json([A, B]))).toEqual([A, B]);
  });
  it('rechaza lo que no es JSON, vacío o no lista', () => {
    expect(errores('no json')).toEqual(['no es JSON']);
    expect(errores('[]')).toEqual(['debe ser una lista no vacía']);
    expect(errores('{}')).toEqual(['debe ser una lista no vacía']);
    expect(() => parsearSitios(undefined as unknown as string)).toThrow(ErrorSitios);
  });
  it('detecta claves y sitios duplicados', () => {
    expect(errores(json([A, { ...B, clave: 'a1' }]))).toEqual(['entrada 2: clave repetida']);
    expect(errores(json([A, { ...B, sitio: 'sitio-aaaa' }]))).toEqual(['entrada 2: sitio repetido']);
  });
  it('valida los patrones de cada campo', () => {
    expect(errores(json([{ ...A, clave: 'Mayus' }]))).toContain('entrada 1: clave inválida');
    expect(errores(json([{ ...A, clave: 'a'.repeat(13) }]))).toContain('entrada 1: clave inválida');
    expect(errores(json([{ ...A, tenant: '-malo' }]))).toContain('entrada 1: tenant inválido');
    expect(errores(json([{ ...A, sitio: 'corto' }]))).toContain('entrada 1: sitio inválido');
    expect(errores(json([{ ...A, sitio: 'a'.repeat(31) }]))).toContain('entrada 1: sitio inválido');
    for (const url of ['http://a.example.com', 'https://a.example.com/ruta', 'https://a.example.com?x=1', 'https://u@a.example.com', 5]) {
      expect(errores(json([{ ...A, url }]))).toContain('entrada 1: url debe ser https sin ruta');
    }
  });
  it('rechaza campos de más o de menos y entradas que no son objeto', () => {
    expect(errores(json([{ ...A, extra: 1 }]))).toContain('entrada 1: campos distintos de clave, tenant, sitio y url');
    const sinUrl = { clave: A.clave, tenant: A.tenant, sitio: A.sitio };
    expect(errores(json([sinUrl]))).toContain('entrada 1: campos distintos de clave, tenant, sitio y url');
    expect(errores(json([5, null, []]))).toEqual(['entrada 1: debe ser un objeto', 'entrada 2: debe ser un objeto', 'entrada 3: debe ser un objeto']);
  });
  it('los errores no filtran los valores recibidos', () => {
    const secreto = 'x'.repeat(24).toUpperCase();
    const msgs = [
      errores(json([{ clave: secreto, tenant: secreto, sitio: secreto, url: `http://${secreto}`, [secreto]: secreto }])).join(' '),
      errores(json([A, { ...A, sitio: 'otro-sitio' }])).join(' '),
    ];
    for (const m of msgs) expect(m).not.toContain(secreto);
    expect(msgs[1]).not.toContain('a.example.com');
  });
});

describe('construirMatriz', () => {
  it('lista todas las entradas o solo la clave pedida', () => {
    expect(construirMatriz([A, B])).toEqual({ include: [A, B] });
    expect(construirMatriz([A, B], 'b2')).toEqual({ include: [B] });
  });
  it('falla si la clave no existe', () => {
    expect(() => construirMatriz([A], 'zz')).toThrow(ErrorSitios);
  });
});

describe('validarSolo', () => {
  it('staging: lista permitida; vacía, hosting, hosting:sitio y hosting:<tenant> son problema', () => {
    expect(validarSolo('staging', '')).toHaveLength(1);
    expect(validarSolo('staging', 'functions,firestore:rules')).toEqual([]);
    expect(validarSolo('staging', 'functions:api, storage, firestore, firestore:indexes, hosting:panel')).toEqual([]);
    expect(validarSolo('staging', 'functions, hosting')).toHaveLength(1);
    expect(validarSolo('staging', 'hosting')).toHaveLength(1);
    expect(validarSolo('staging', 'hosting:sitio')).toHaveLength(1);
    expect(validarSolo('staging', 'hosting:panel')).toEqual([]);
    expect(validarSolo('staging', 'hosting:sitio-aaaa')).toHaveLength(1);
    expect(validarSolo('staging', 'hosting:sitio-aaaa', [A])).toHaveLength(1);
  });
  it('staging rechaza entradas vacías dentro de la lista, como «hosting:,functions»', () => {
    expect(validarSolo('staging', 'hosting:,functions')).toHaveLength(1);
    expect(validarSolo('staging', 'functions,,storage')).toHaveLength(1);
    expect(validarSolo('staging', 'functions,')).toHaveLength(1);
    expect(validarSolo('staging', ',').length).toBeGreaterThan(0);
  });
  it('RE_SOLO_STAGING acepta solo la lista permitida', () => {
    for (const ok of ['functions', 'functions:api', 'firestore', 'firestore:rules', 'firestore:indexes', 'storage', 'hosting:panel']) expect(RE_SOLO_STAGING.test(ok)).toBe(true);
    for (const mal of ['', 'hosting', 'hosting:', 'hosting:sitio', 'hosting:sitio-aaaa', 'firestore:otra', 'functions:', 'storage:x', 'functions api']) expect(RE_SOLO_STAGING.test(mal)).toBe(false);
  });
  it('production: la guardia depende de cuántos sitios hay, no de cuántas entradas trae la lista', () => {
    const lista = ['hosting', 'functions', 'firestore', 'storage'].join(',');
    expect(validarSolo('production', lista, [])).toEqual([]);
    expect(validarSolo('production', lista, [A])).toEqual([]);
    expect(validarSolo('production', '')).toEqual([]);
    expect(validarSolo('production', 'hosting')).toEqual([]);
    expect(validarSolo('production', 'hosting:sitio')).toEqual([]);
    const dos = validarSolo('production', lista, [A, B]);
    expect(dos).toHaveLength(1);
    expect(dos[0]).toContain('hosting sin calificar');
    expect(validarSolo('production', 'hosting', [A, B])).toHaveLength(1);
    expect(validarSolo('production', 'functions,hosting:sitio', [A, B])).toHaveLength(1);
  });
  it('production rechaza siempre hosting:<sitio de tenant> cuando se dan los sitios, aunque sea la única entrada', () => {
    expect(validarSolo('production', 'hosting:sitio-aaaa', [A])).toHaveLength(1);
    expect(validarSolo('production', 'functions,hosting:sitio-bbbb', [A, B])).toHaveLength(1);
    expect(validarSolo('production', 'hosting:sitio-aaaa')).toEqual([]);
    expect(validarSolo('production', 'hosting:panel', [A, B])).toEqual([]);
  });
  it('rechaza un ambiente desconocido', () => {
    expect(validarSolo('dev', 'functions')).toEqual(['ambiente no válido']);
  });
  it('los problemas no incluyen los valores de la lista', () => {
    const m = [validarSolo('staging', 'hosting:sitio-aaaa', [A]), validarSolo('production', 'hosting:sitio-aaaa', [A]), validarSolo('staging', 'hosting:sitio-aaaa')].flat().join(' ');
    expect(m).not.toContain('sitio-aaaa');
  });
});

describe('ejecutar', () => {
  const env = { SITIOS_TENANT: json([A, B]) };
  it('matriz usa --sitios o SITIOS_TENANT', () => {
    expect(JSON.parse(ejecutar(['matriz'], env).salida!)).toEqual({ include: [A, B] });
    expect(JSON.parse(ejecutar(['matriz', '--clave', 'a1'], env).salida!)).toEqual({ include: [A] });
    expect(JSON.parse(ejecutar(['matriz', '--sitios', json([B])], {}).salida!)).toEqual({ include: [B] });
  });
  it('matriz con clave inexistente o SITIOS_TENANT ausente da código 1', () => {
    expect(ejecutar(['matriz', '--clave', 'zz'], env).codigo).toBe(1);
    expect(ejecutar(['matriz'], {}).codigo).toBe(1);
  });
  it('validar-solo: 0 válido, 1 inválido, 2 uso', () => {
    expect(ejecutar(['validar-solo', '--ambiente', 'staging', '--solo', 'functions'], {}).codigo).toBe(0);
    expect(ejecutar(['validar-solo', '--ambiente', 'staging', '--solo', 'hosting'], {}).codigo).toBe(1);
    expect(ejecutar(['validar-solo', '--ambiente', 'staging'], {}).codigo).toBe(2);
    expect(ejecutar(['validar-solo', '--ambiente', 'production', '--solo', 'functions,hosting:sitio-bbbb'], env).codigo).toBe(1);
    expect(ejecutar(['otra'], {}).codigo).toBe(2);
  });
  it('validar-solo: --sitios \'[]\' cuenta 0 sitios; matriz sigue rechazando la lista vacía', () => {
    const lista = 'hosting,functions,firestore,storage';
    expect(ejecutar(['validar-solo', '--ambiente', 'production', '--solo', lista, '--sitios', '[]'], {}).codigo).toBe(0);
    expect(ejecutar(['validar-solo', '--ambiente', 'production', '--solo', lista, '--sitios', json([A])], {}).codigo).toBe(0);
    const dos = ejecutar(['validar-solo', '--ambiente', 'production', '--solo', lista, '--sitios', json([A, B])], {});
    expect(dos.codigo).toBe(1);
    expect(dos.error).toContain('hosting sin calificar');
    expect(ejecutar(['matriz', '--sitios', '[]'], {}).codigo).toBe(1);
  });
  it('un valor que empieza con «--» es uso inválido (código 2) y no se interpreta como valor', () => {
    expect(ejecutar(['validar-solo', '--ambiente', 'staging', '--solo', '--sitios', json([A])], {}).codigo).toBe(2);
    expect(ejecutar(['validar-solo', '--ambiente', '--solo', 'functions'], {}).codigo).toBe(2);
    expect(ejecutar(['matriz', '--clave', '--sitios', json([A])], {}).codigo).toBe(2);
    expect(ejecutar(['matriz', '--sitios', '--clave', 'a1'], env).codigo).toBe(2);
  });
  it('staging con SITIOS_TENANT: hosting:<sitio de tenant> da código 1', () => {
    expect(ejecutar(['validar-solo', '--ambiente', 'staging', '--solo', 'hosting:sitio-aaaa'], env).codigo).toBe(1);
    expect(ejecutar(['validar-solo', '--ambiente', 'staging', '--solo', 'hosting:,functions'], {}).codigo).toBe(1);
    expect(ejecutar(['validar-solo', '--ambiente', 'production', '--solo', 'hosting:sitio-aaaa', '--sitios', json([A])], {}).codigo).toBe(1);
  });
  it('un SITIOS_TENANT inválido en validar-solo da código 1 sin eco', () => {
    const r = ejecutar(['validar-solo', '--ambiente', 'staging', '--solo', 'functions'], { SITIOS_TENANT: json([{ ...A, tenant: 'MAL-VALOR' }]) });
    expect(r.codigo).toBe(1);
    expect(r.error).not.toContain('MAL-VALOR');
  });
});
