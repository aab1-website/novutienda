// Contador de vistas contra el emulador: POST suma, GET lee, un id no publicado da 404 y el límite por origen (en memoria).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { HOST_A, hayEmulador, herramientas, http, T, TENANT_TODO_ENCENDIDO, unico, type Herramientas } from './ayudas.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// El limitador vive en la memoria del emulador (mismo proceso entre pruebas y corridas): cada llamada devuelve un origen
// que no repite ninguno anterior (contador + base aleatoria de 16 bits), no uno de solo 200 valores que podían chocar.
const baseOrigen = Math.floor(Math.random() * 60_000);
let contadorOrigen = 0;
const origenAleatorio = (): string => {
  contadorOrigen += 1;
  const n = baseOrigen + contadorOrigen;
  return `100.64.${String(Math.floor(n / 250) % 250)}.${String((n % 250) + 1)}`;
};
const cabecera = (ip: string): Record<string, string> => ({ 'sec-fetch-site': 'same-origin', 'x-forwarded-for': `9.9.9.9, ${ip}, 151.101.1.1` });

describe.skipIf(!hayEmulador)('/api/vista (emulador)', () => {
  let h: Herramientas;
  const prod = unico('vista-lapiz').toLowerCase();

  beforeAll(async () => {
    h = herramientas();
    // Sin `sembrarTenant`: otro archivo ya siembra `T` y repetirlo falla (ubicaciones que ya existen).
    await h.firestore.doc(`tenants/${T}`).set(TENANT_TODO_ENCENDIDO, { merge: true });
    await h.firestore.doc(`dominios/${HOST_A}`).set({ tenantId: T });
    await h.firestore.doc(`tenants/${T}/publicado/producto__${prod}`).set({ id: prod, slug: 'lapiz-vistas', nombre: 'Lápiz vistas' });
  });

  it('POST suma, GET lee y el contador queda en vistasProducto', async () => {
    const ip = origenAleatorio();
    const g0 = await http(`/api/vista?id=${prod}`, { headers: cabecera(ip) });
    expect(g0.status).toBe(200);
    expect(g0.cuerpo).toEqual({ vistas: 0 });
    for (const esperado of [1, 2]) {
      const p = await http(`/api/vista?id=${prod}`, { method: 'POST', headers: cabecera(ip) });
      expect(p.status).toBe(200);
      expect(p.cuerpo).toEqual({ vistas: esperado });
    }
    const g = await http(`/api/vista?id=${prod}`, { headers: cabecera(ip) });
    expect(g.cuerpo).toEqual({ vistas: 2 });
    expect(g.cabeceras.get('cache-control')).toContain('s-maxage');
    expect((await h.firestore.doc(`tenants/${T}/vistasProducto/${prod}`).get()).data()).toEqual({ vistas: 2 });
  });

  it('un id no publicado da 404 y no crea el contador', async () => {
    const id = unico('vista-fantasma').toLowerCase();
    const ip = origenAleatorio();
    expect((await http(`/api/vista?id=${id}`, { headers: cabecera(ip) })).status).toBe(404);
    expect((await http(`/api/vista?id=${id}`, { method: 'POST', headers: cabecera(ip) })).status).toBe(404);
    expect((await h.firestore.doc(`tenants/${T}/vistasProducto/${id}`).get()).exists).toBe(false);
    expect((await http('/api/vista?id=A', { headers: cabecera(ip) })).status).toBe(400);
  });

  it('límite por producto, origen y hora: el 3.º POST da 429; otro origen no se afecta', async () => {
    const ip = origenAleatorio();
    const estados: number[] = [];
    for (let i = 0; i < 3; i += 1) estados.push((await http(`/api/vista?id=${prod}`, { method: 'POST', headers: cabecera(ip) })).status);
    expect(estados).toEqual([200, 200, 429]);
    expect((await http(`/api/vista?id=${prod}`, { method: 'POST', headers: cabecera(origenAleatorio()) })).status).toBe(200);
  });

  it('límite por origen y minuto: la petición 31 (GET) da 429', async () => {
    const ip = origenAleatorio();
    let ultimo = 0;
    for (let i = 0; i < 31; i += 1) ultimo = (await http(`/api/vista?id=${prod}`, { headers: cabecera(ip) })).status;
    expect(ultimo).toBe(429);
  });
});
