import { describe, expect, it } from 'vitest';
import { limiteMemoria } from '@novutienda/nucleo';
import { manejarVista, type DepsVista } from './vista.js';
import { MIN_VISTAS_VISIBLES, marcarVista, textoVistas, yaContoVista } from '../lib/vistas.js';

function deps(publicados: Record<string, number>, max = 100): DepsVista {
  return {
    almacen: {
      leer: (id) => Promise.resolve(id in publicados ? (publicados[id] as number) : null),
      sumar: (id) => {
        if (!(id in publicados)) return Promise.resolve(null);
        publicados[id] = (publicados[id] as number) + 1;
        return Promise.resolve(publicados[id] as number);
      },
    },
    limite: limiteMemoria(max, 60_000),
    ahora: () => 1000,
  };
}

describe('/api/vista', () => {
  it('POST suma y GET lee, con caché solo en el GET', async () => {
    const d = deps({ 'tv-1': 4 });
    const p = await manejarVista({ metodo: 'POST', id: 'tv-1', origen: 'a' }, d);
    expect(p.status).toBe(200);
    expect(p.cuerpo).toEqual({ vistas: 5 });
    expect(p.headers['Cache-Control']).toBe('no-store');
    const g = await manejarVista({ metodo: 'GET', id: 'tv-1', origen: 'a' }, d);
    expect(g.cuerpo).toEqual({ vistas: 5 });
    expect(g.headers['Cache-Control']).toContain('s-maxage=60');
  });
  it('id inexistente o no publicado da 404; id mal formado, 400; otro método, 405', async () => {
    const d = deps({ 'tv-1': 0 });
    expect((await manejarVista({ metodo: 'POST', id: 'inventado', origen: 'a' }, d)).status).toBe(404);
    expect((await manejarVista({ metodo: 'GET', id: 'inventado', origen: 'a' }, d)).status).toBe(404);
    expect((await manejarVista({ metodo: 'POST', id: '../x', origen: 'a' }, d)).status).toBe(400);
    expect((await manejarVista({ metodo: 'POST', id: null, origen: 'a' }, d)).status).toBe(400);
    expect((await manejarVista({ metodo: 'DELETE', id: 'tv-1', origen: 'a' }, d)).status).toBe(405);
  });
  it('limita los POST por origen (429) sin afectar a otro origen ni a los GET', async () => {
    const d = deps({ 'tv-1': 0 }, 2);
    expect((await manejarVista({ metodo: 'POST', id: 'tv-1', origen: 'ip-1' }, d)).status).toBe(200);
    expect((await manejarVista({ metodo: 'POST', id: 'tv-1', origen: 'ip-1' }, d)).status).toBe(200);
    const r = await manejarVista({ metodo: 'POST', id: 'tv-1', origen: 'ip-1' }, d);
    expect(r.status).toBe(429);
    expect(r.headers['Retry-After']).toBeDefined();
    expect((await manejarVista({ metodo: 'POST', id: 'tv-1', origen: 'ip-2' }, d)).status).toBe(200);
    expect((await manejarVista({ metodo: 'GET', id: 'tv-1', origen: 'ip-1' }, d)).status).toBe(200);
  });
  it('un fallo del almacén da 503 sin detalle', async () => {
    const d: DepsVista = { ...deps({}), almacen: { leer: () => Promise.reject(new Error('secreto')), sumar: () => Promise.reject(new Error('secreto')) } };
    const r = await manejarVista({ metodo: 'GET', id: 'tv-1', origen: 'a' }, d);
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.cuerpo)).not.toContain('secreto');
  });
});

describe('vistas en el navegador', () => {
  it('no muestra el texto con menos de 10 y sí desde 10', () => {
    expect(MIN_VISTAS_VISIBLES).toBe(10);
    expect(textoVistas(9)).toBeNull();
    expect(textoVistas(10)).toBe('10 personas vieron este producto');
    expect(textoVistas(1234)).toBe('1234 personas vieron este producto');
    expect(textoVistas(Number.NaN)).toBeNull();
  });
  it('un navegador cuenta una vez por producto cada 24 h', () => {
    const m = new Map<string, string>();
    const alm = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    expect(yaContoVista(alm, 'tv-1', 1000)).toBe(false);
    marcarVista(alm, 'tv-1', 1000);
    expect(yaContoVista(alm, 'tv-1', 1000 + 23 * 3_600_000)).toBe(true);
    expect(yaContoVista(alm, 'tv-1', 1000 + 25 * 3_600_000)).toBe(false);
    expect(yaContoVista(alm, 'tv-2', 1000)).toBe(false);
    expect(yaContoVista(null, 'tv-1', 1000)).toBe(false);
  });
});
