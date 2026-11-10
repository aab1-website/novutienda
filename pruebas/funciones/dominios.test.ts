// Tenant por host (sin emulador): normalización del host de la petición y lector de `dominios/{host}` con caché.
import { describe, expect, it } from 'vitest';
import {
  TOPE_DOMINIOS, TTL_DOMINIO_MS, TTL_DOMINIO_NEGATIVO_MS, crearLectorDominios, hostDePeticion,
} from '../../plataforma/coordinador/dominios.js';

describe('hostDePeticion', () => {
  const de = (v: string | undefined, extra: Record<string, string> = {}) => hostDePeticion({ ...(v === undefined ? {} : { 'x-forwarded-host': v }), ...extra });
  it('normaliza: minúsculas, sin puerto y sin punto final', () => {
    expect(de('Tienda-A.Test')).toBe('tienda-a.test');
    expect(de('tienda-a.test:443')).toBe('tienda-a.test');
    expect(de('tienda-a.test.')).toBe('tienda-a.test');
    expect(de('  tienda-a.test  ')).toBe('tienda-a.test');
  });
  it('rechaza lo ausente, las listas y lo que no es un host', () => {
    expect(de(undefined)).toBeUndefined();
    expect(de('a.test, b.test')).toBeUndefined();
    expect(de('a.test,b.test')).toBeUndefined();
    expect(de('')).toBeUndefined();
    expect(de('localhost')).toBeUndefined();
    expect(de('10.0.0.1')).toBeUndefined();
    expect(de('a.test/ruta')).toBeUndefined();
    expect(de('a b.test')).toBeUndefined();
  });
  it('nunca cae a `host`', () => {
    expect(de(undefined, { host: 'tienda-a.test' })).toBeUndefined();
    expect(de('a.test', { host: 'otro.test' })).toBe('a.test');
  });
});

describe('crearLectorDominios', () => {
  function montar(docs: Record<string, unknown> = {}, falla = false) {
    let ahora = 1_000_000;
    const lecturas: string[] = [];
    const firestore = {
      doc: (ruta: string) => ({
        get: () => {
          lecturas.push(ruta);
          if (falla) return Promise.reject(new Error('firestore caído'));
          return Promise.resolve({ exists: Object.hasOwn(docs, ruta), data: () => docs[ruta] });
        },
      }),
    };
    return { lector: crearLectorDominios(firestore, () => ahora), lecturas, docs, avanzar: (ms: number) => { ahora += ms; } };
  }

  it('devuelve el tenant del documento y cachea 60 s', async () => {
    const m = montar({ 'dominios/tienda-a.test': { tenantId: 'tienda-a' } });
    expect(await m.lector('tienda-a.test')).toBe('tienda-a');
    expect(await m.lector('tienda-a.test')).toBe('tienda-a');
    expect(m.lecturas).toHaveLength(1);
    expect(m.lector.enCache('tienda-a.test')).toBe(true);
    m.avanzar(TTL_DOMINIO_MS - 1);
    await m.lector('tienda-a.test');
    expect(m.lecturas).toHaveLength(1);
    m.avanzar(2);
    expect(m.lector.enCache('tienda-a.test')).toBe(false);
    await m.lector('tienda-a.test');
    expect(m.lecturas).toHaveLength(2);
  });

  it('sin mapeo: undefined y caché negativa de 10 s', async () => {
    const m = montar();
    expect(await m.lector('nada.test')).toBeUndefined();
    expect(await m.lector('nada.test')).toBeUndefined();
    expect(m.lecturas).toHaveLength(1);
    m.avanzar(TTL_DOMINIO_NEGATIVO_MS + 1);
    await m.lector('nada.test');
    expect(m.lecturas).toHaveLength(2);
  });

  it('un host inválido no lee Firestore', async () => {
    const m = montar();
    for (const h of ['localhost', 'A.TEST', 'a.test:80', 'a/b.test', '../x.test', '']) expect(await m.lector(h)).toBeUndefined();
    expect(m.lecturas).toEqual([]);
  });

  it('un documento inválido da undefined', async () => {
    const m = montar({ 'dominios/a.test': { tenantId: 'No Valido!' }, 'dominios/b.test': { otro: 1 }, 'dominios/c.test': { tenantId: 7 } });
    for (const h of ['a.test', 'b.test', 'c.test']) expect(await m.lector(h)).toBeUndefined();
  });

  it('el error de Firestore se propaga y no se cachea', async () => {
    const m = montar({}, true);
    await expect(m.lector('a.test')).rejects.toThrow('firestore caído');
    expect(m.lector.enCache('a.test')).toBe(false);
  });

  it('respeta el tope de entradas', async () => {
    const m = montar();
    for (let i = 0; i < TOPE_DOMINIOS + 50; i += 1) await m.lector(`h${String(i)}.test`);
    expect(m.lecturas).toHaveLength(TOPE_DOMINIOS + 50);
    expect(m.lector.enCache('h0.test')).toBe(false); // desalojado el más antiguo
    expect(m.lector.enCache(`h${String(TOPE_DOMINIOS + 49)}.test`)).toBe(true);
    const antes = m.lecturas.length;
    await m.lector('h0.test');
    expect(m.lecturas).toHaveLength(antes + 1);
  });
});
