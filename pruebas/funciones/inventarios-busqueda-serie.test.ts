// Búsqueda de serie por el comienzo (`porInicio`), por el callable real y por rol (emulador): mínimo de 4 caracteres, solo `sup` y
// `adm`, 10 resultados como máximo, ocultamiento con un conteo abierto y límite de tasa (30 por minuto por usuario).
import { FieldValue } from 'firebase-admin/firestore';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { accion, crearUsuario, hayEmulador, herramientas, sembrarTenant, unico, type Herramientas, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

// Tenant único por corrida: el tope por tenant (300 por hora) persiste en `limitesTasa` y no debe arrastrarse entre corridas.
const A = unico('serie').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 30);
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
      productos: [
        { id: 'cam', nombre: 'Cámara', precioUSD: { bo: 90000, ar: 90000 }, tienda: 3, conSerie: true, series: ['Abc-123', 'Xyz-777', 'Viej-001'] },
        { id: 'tv', nombre: 'Televisor', precioUSD: { bo: 90000, ar: 90000 }, tienda: 12, conSerie: true, series: Array.from({ length: 12 }, (_, i) => `TV-${String(i + 1).padStart(3, '0')}`) },
      ],
    });
    // Una unidad «anterior al relleno»: sin `serieBusqueda`.
    await h.firestore.doc(`tenants/${A}/unidades/cam__Viej-001`).update({ serieBusqueda: FieldValue.delete() });
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

  it('la búsqueda exacta no distingue mayúsculas y la respuesta no trae `serieBusqueda`', async () => {
    for (const u of [caj, sup, adm]) {
      for (const texto of ['abc-123', 'ABC-123', 'Abc-123']) {
        const r = unidades(await llamar(u, { serie: texto }));
        expect(r, texto).toHaveLength(1);
        expect(r[0]).toMatchObject({ productoId: 'cam', serie: 'Abc-123' });
        expect(r[0]).not.toHaveProperty('serieBusqueda');
      }
    }
    expect(unidades(await llamar(caj, { serie: 'abc-123', productoId: 'tv' }))).toHaveLength(0);
    expect(unidades(await llamar(caj, { serie: 'abc-123', productoId: 'cam' }))).toHaveLength(1);
  });

  it('una unidad sin `serieBusqueda` (anterior al relleno) se encuentra por su serie exacta', async () => {
    const r = unidades(await llamar(caj, { serie: 'Viej-001' }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ serie: 'Viej-001' });
    expect(r[0]).not.toHaveProperty('serieBusqueda');
    expect(unidades(await llamar(caj, { serie: 'viej-001' }))).toHaveLength(0); // sin relleno, solo la exacta
  });

  it('una unidad vieja «abc-777» y una nueva «ABC-777» aparecen juntas, sin repetirse', async () => {
    const viejo = { productoId: 'cam', serie: 'abc-777', estado: 'disponible', ubicacionId: 'deposito-1' };
    await h.firestore.doc(`tenants/${A}/unidades/cam__abc-777`).set(viejo); // sin `serieBusqueda`
    await h.firestore.doc(`tenants/${A}/unidades/cam__ABC-777`).set({ ...viejo, serie: 'ABC-777', serieBusqueda: 'abc-777' });
    // Escrita como la vieja («abc-777»): la nueva sale por `serieBusqueda` y la vieja por la serie exacta; ninguna tapa a la otra.
    expect(unidades(await llamar(adm, { serie: 'abc-777' })).map((u) => u['serie']).sort()).toEqual(['ABC-777', 'abc-777']);
    expect(unidades(await llamar(adm, { serie: 'abc-77', porInicio: true })).map((u) => u['serie']).sort()).toEqual(['ABC-777', 'abc-777']);
    // Escrita en mayúsculas, la vieja sigue sin aparecer hasta el relleno (no tiene `serieBusqueda`); la nueva sí.
    expect(unidades(await llamar(adm, { serie: 'ABC-777' })).map((u) => u['serie'])).toEqual(['ABC-777']);
  });

  it('porInicio no distingue mayúsculas, cae a la serie exacta y no devuelve `serieBusqueda`', async () => {
    const r = unidades(await llamar(adm, { serie: 'ABC-1', porInicio: true }));
    expect(r.map((u) => u['serie'])).toEqual(['Abc-123']);
    expect(r[0]).not.toHaveProperty('serieBusqueda');
    expect(unidades(await llamar(adm, { serie: 'xyz-', porInicio: true }))).toHaveLength(1);
    expect(unidades(await llamar(adm, { serie: 'Viej-', porInicio: true }))).toHaveLength(1);
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
