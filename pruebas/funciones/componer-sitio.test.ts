// componerSitioTenant: firebase.json solo con la entrada `site` y su regla ** sellada (el despliegue por tenant no puede tocar otra cosa).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { componer, componerSitioTenant, RE_SITIO } from '../../plataforma/funciones/scripts/componer-hosting.mjs';

type Regla = { source: string; headers: { key: string; value: string }[] };
type Sitio = { target?: string; site?: string; headers: Regla[] };
const SITIO_ID = 'sitio-aaaa';
const firebase = JSON.parse(readFileSync(new URL('../../firebase.json', import.meta.url), 'utf8')) as { hosting: Sitio[] } & Record<string, unknown>;
const SELLADO = [{ key: 'Content-Security-Policy', value: "default-src 'none'; script-src 'sha256-abc'" }, { key: 'X-Sello', value: 'si' }];
const cabeceras = [{ source: '**', headers: SELLADO }];

describe('componerSitioTenant', () => {
  const solo = componerSitioTenant(firebase, cabeceras, SITIO_ID) as { hosting: Sitio[] } & Record<string, unknown>;

  it('contiene solo hosting con una entrada `site`, sin target, functions, firestore, storage ni emulators', () => {
    expect(Object.keys(solo)).toEqual(['hosting']);
    expect(solo.hosting).toHaveLength(1);
    expect(solo.hosting[0]?.site).toBe(SITIO_ID);
    expect(solo.hosting[0]).not.toHaveProperty('target');
  });

  it('sella la regla ** y deja igual al firebase.json versionado todo lo demás de la entrada', () => {
    const original = firebase.hosting.find((h) => h.target === 'sitio')!;
    const sitio = solo.hosting[0]!;
    expect(sitio.headers.find((h) => h.source === '**')?.headers).toEqual(SELLADO);
    const sinRegla = (s: Sitio) => ({ ...s, target: undefined, site: undefined, headers: s.headers.filter((h) => h.source !== '**') });
    expect(sinRegla(sitio)).toEqual(sinRegla(original));
    expect(sitio.headers.map((h) => h.source)).toEqual(original.headers.map((h) => h.source));
  });

  it('no muta la entrada y coincide con lo que componer deja para el sitio', () => {
    const antes = JSON.stringify(firebase);
    const otra = componerSitioTenant(firebase, cabeceras, SITIO_ID) as { hosting: Sitio[] };
    expect(JSON.stringify(firebase)).toBe(antes);
    const completo = componer(firebase, cabeceras) as { hosting: Sitio[] };
    const delCompleto = { ...completo.hosting.find((h) => h.target === 'sitio')! };
    delete delCompleto.target;
    expect(otra.hosting[0]).toEqual({ site: SITIO_ID, ...delCompleto });
  });

  it('rechaza cabeceras mal formadas', () => {
    expect(() => componerSitioTenant(firebase, [], SITIO_ID)).toThrow(/exactamente una regla/);
    expect(() => componerSitioTenant(firebase, [{ source: '/x', headers: SELLADO }], SITIO_ID)).toThrow(/exactamente una regla/);
    expect(() => componerSitioTenant(firebase, [{ source: '**', headers: [{ key: 'X-Otra', value: '1' }] }], SITIO_ID)).toThrow(/Content-Security-Policy/);
    expect(() => componerSitioTenant(firebase, [{ source: '**', headers: [{ key: 'Content-Security-Policy', value: '' }] }], SITIO_ID)).toThrow(/Content-Security-Policy/);
  });

  it('falla si falta el sitio o su regla **', () => {
    expect(() => componerSitioTenant({ hosting: [{ target: 'panel', headers: [] }] }, cabeceras, SITIO_ID)).toThrow(/no tiene el sitio/);
    expect(() => componerSitioTenant({ hosting: [{ target: 'sitio', headers: [{ source: '/a', headers: [] }] }] }, cabeceras, SITIO_ID)).toThrow(/regla de cabeceras/);
  });

  it('rechaza ids de sitio inválidos con «id de sitio inválido» sin eco del valor', () => {
    for (const malo of ['', 'corto', 'MAYUS-aaaa', 'a'.repeat(31), 'con espacio', 'ruta/../x', undefined, 5]) {
      expect(() => componerSitioTenant(firebase, cabeceras, malo as unknown as string)).toThrow('id de sitio inválido');
    }
    try {
      componerSitioTenant(firebase, cabeceras, 'MAL ID privado');
    } catch (e) {
      expect((e as Error).message).not.toContain('privado');
    }
  });

  it('RE_SITIO coincide con el patrón de sitios-tenant (6 a 30, minúsculas, dígitos y guion)', () => {
    expect(RE_SITIO.test('sitio-aaaa')).toBe(true);
    expect(RE_SITIO.test('a'.repeat(30))).toBe(true);
    expect(RE_SITIO.test('a'.repeat(5))).toBe(false);
    expect(RE_SITIO.test('Sitio-aaaa')).toBe(false);
  });
});
