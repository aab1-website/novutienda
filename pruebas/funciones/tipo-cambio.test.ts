// Tipo de cambio manual por el callable real `consola` (emulador): el administrador fija, ve con historial y vuelve al banco central;
// caj y sup son rechazados; el salto de más del 5 % sin confirmar se rechaza.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { accion, crearUsuario, hayEmulador, herramientas, sembrarTenant, type Herramientas, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

const A = 'tc-manual';
type Obj = Record<string, unknown>;
const cuerpo = (r: { resultado?: unknown }): Obj => r.resultado as Obj;
const mercadoBO = (r: { resultado?: unknown }): Obj => (cuerpo(r)['mercados'] as Obj[]).find((m) => m['mercado'] === 'BO') as Obj;

describe.skipIf(!hayEmulador)('consola: tipo de cambio manual (emulador)', () => {
  let h: Herramientas;
  let adm: Usuario;
  let sup: Usuario;
  let caj: Usuario;
  const ver = (u: Usuario) => accion('consola', 'verTipoCambio', {}, u.token, A);
  const fijar = (u: Usuario, datos: Obj) => accion('consola', 'cotizacionManual', { mercado: 'BO', ...datos }, u.token, A);

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, A); // referencia BO = 7 de hoy
    adm = await crearUsuario(h, { rol: 'adm', tenant: A });
    sup = await crearUsuario(h, { rol: 'sup', tenant: A });
    caj = await crearUsuario(h, { rol: 'caj', tenant: A });
  });

  it('caj y sup no ven ni fijan', async () => {
    for (const u of [caj, sup]) {
      for (const r of [await ver(u), await fijar(u, { valor: 7.1 })]) {
        expect(r.status, JSON.stringify(r.error)).toBeGreaterThanOrEqual(400);
        expect(r.resultado).toBeUndefined();
      }
    }
  });

  it('el administrador fija, ve el manual con su historial y vuelve al del banco central; el salto sin confirmar se rechaza', async () => {
    const fija = await fijar(adm, { valor: 7.1 });
    expect(fija.status, JSON.stringify(fija.error)).toBe(200);

    const v1 = mercadoBO(await ver(adm));
    expect(v1).toMatchObject({ rige: 'manual', manual: { valor: 7.1 }, referencia: { valor: 7 } });
    expect((v1['historial'] as Obj[])[0]).toMatchObject({ accion: 'fijar', valor: 7.1 });

    const salto = await fijar(adm, { valor: 8 });
    expect(salto.status).toBe(400);
    expect(salto.error?.status).toBe('FAILED_PRECONDITION');
    expect(mercadoBO(await ver(adm))).toMatchObject({ manual: { valor: 7.1 } });

    const confirmado = await fijar(adm, { valor: 8, confirmarSalto: true });
    expect(confirmado.status, JSON.stringify(confirmado.error)).toBe(200);
    expect(mercadoBO(await ver(adm))).toMatchObject({ manual: { valor: 8 } });

    const sin = await accion('consola', 'quitarCotizacionManual', { mercado: 'BO' }, adm.token, A);
    expect(sin.error?.status).toBe('FAILED_PRECONDITION');
    const quita = await accion('consola', 'quitarCotizacionManual', { mercado: 'BO', confirmar: true }, adm.token, A);
    expect(quita.status, JSON.stringify(quita.error)).toBe(200);
    const v2 = mercadoBO(await ver(adm));
    expect(v2).toMatchObject({ rige: 'referencia', manual: null });
    expect((v2['historial'] as Obj[])[0]).toMatchObject({ accion: 'quitar' });
  });

  it('el tope de 10 cambios por hora es global (en Firestore): el cambio 11 del comercio da resource-exhausted', async () => {
    const T = 'tc-limite';
    await sembrarTenant(h, T);
    const u = await crearUsuario(h, { rol: 'adm', tenant: T });
    const f = (valor: number) => accion('consola', 'cotizacionManual', { mercado: 'BO', valor }, u.token, T);
    for (let i = 0; i < 10; i++) {
      const r = await f(i % 2 === 0 ? 7.1 : 7.2);
      expect(r.status, `cambio ${i + 1}: ${JSON.stringify(r.error)}`).toBe(200);
    }
    const once = await f(7.1);
    expect(once.error?.status).toBe('RESOURCE_EXHAUSTED');
  });
});
