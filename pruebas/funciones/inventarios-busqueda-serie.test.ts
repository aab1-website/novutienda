// Búsqueda de serie por el comienzo (`porInicio`), por el callable real y por rol (emulador): mínimo de 4 caracteres, solo `sup` y
// `adm`, 10 resultados como máximo, ocultamiento con un conteo abierto y límite de tasa (30 por minuto por usuario).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { accion, crearUsuario, hayEmulador, herramientas, sembrarTenant, unico, type Herramientas, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

const A = 'serie-a';
type Obj = Record<string, unknown>;
const unidades = (r: { resultado?: unknown }): Obj[] => (r.resultado as Obj)['unidades'] as Obj[];

describe.skipIf(!hayEmulador)('inventarios: búsqueda de serie por el comienzo (emulador)', () => {
  let h: Herramientas;
  let adm: Usuario;
  let sup: Usuario;
  let caj: Usuario;
  const llamar = (u: Usuario, datos: unknown) => accion('inventarios', 'buscarSerie', datos, u.token, A);

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, A, {
      productos: [{ id: 'tv', nombre: 'Televisor', precioUSD: { bo: 90000, ar: 90000 }, tienda: 12, conSerie: true, series: Array.from({ length: 12 }, (_, i) => `TV-${String(i + 1).padStart(3, '0')}`) }],
    });
    adm = await crearUsuario(h, { rol: 'adm', tenant: A });
    sup = await crearUsuario(h, { rol: 'sup', tenant: A });
    caj = await crearUsuario(h, { rol: 'caj', tenant: A });
  });

  it('con menos de 4 caracteres se rechaza', async () => {
    expect((await llamar(sup, { serie: 'TV-', porInicio: true })).status).toBe(400);
  });

  it('el cajero no puede usar porInicio, pero conserva la búsqueda exacta', async () => {
    expect((await llamar(caj, { serie: 'TV-00', porInicio: true })).status).toBe(403);
    expect(unidades(await llamar(caj, { serie: 'TV-001' }))).toHaveLength(1);
    expect(unidades(await llamar(caj, { serie: 'TV-00' }))).toHaveLength(0);
  });

  it('sup y adm encuentran por el comienzo, con 10 resultados como máximo', async () => {
    for (const u of [sup, adm]) {
      const r = await llamar(u, { serie: 'TV-0', porInicio: true });
      expect(r.status).toBe(200);
      expect(unidades(r)).toHaveLength(10);
      expect(unidades(await llamar(u, { serie: 'TV-012', porInicio: true }))).toHaveLength(1);
    }
  });

  it('con un conteo abierto, sup no recibe las disponibles de la tienda; adm sí', async () => {
    const abrir = await accion('inventarios', 'abrirConteo', { operacionId: unico('op'), conteoId: unico('ct').slice(0, 30), ubicacionId: 'tienda' }, sup.token, A);
    expect(abrir.status, JSON.stringify(abrir.error)).toBe(200);
    expect(unidades(await llamar(sup, { serie: 'TV-0', porInicio: true }))).toHaveLength(0);
    expect(unidades(await llamar(adm, { serie: 'TV-0', porInicio: true })).length).toBeGreaterThan(0);
  });

  it('la búsqueda 31 de un usuario en un minuto da resource-exhausted (429)', async () => {
    const otro = await crearUsuario(h, { rol: 'sup', tenant: A });
    for (let i = 0; i < 30; i += 1) expect((await llamar(otro, { serie: 'TV-001', porInicio: true })).status).toBe(200);
    expect((await llamar(otro, { serie: 'TV-001', porInicio: true })).status).toBe(429);
  });
});
