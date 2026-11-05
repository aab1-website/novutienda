// Búsqueda de comprobantes (ola 3e), contra el emulador: número con serie sin importar mayúsculas, número sin serie
// («000123» encuentra «A-000123») y filtro «solo lo mío» del vendedor aplicado antes del límite.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { accion, crearUsuario, hayEmulador, herramientas, sembrarTenant, type Herramientas, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const A = 'busq-a';
type Obj = Record<string, unknown>;

describe.skipIf(!hayEmulador)('búsqueda de comprobantes (emulador)', () => {
  let h: Herramientas;
  let sup: Usuario;
  let caj: Usuario;
  let caj2: Usuario;

  const numeros = async (u: Usuario, consulta: Obj): Promise<string[]> => {
    const r = await accion('recibos', 'buscarComprobantes', consulta, u.token, A);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    return ((r.resultado as { recibos: { numero: string }[] }).recibos).map((x) => x.numero);
  };

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, A);
    sup = await crearUsuario(h, { rol: 'sup', tenant: A });
    caj = await crearUsuario(h, { rol: 'caj', tenant: A });
    caj2 = await crearUsuario(h, { rol: 'caj', tenant: A });
    await h.firestore.doc(`tenants/${A}/contadores/recibo_A`).set({ valor: 6 });
    // Los tres más antiguos son del vendedor 1; los tres más recientes, del vendedor 2.
    for (let n = 1; n <= 6; n += 1) {
      const dueno = n <= 3 ? caj : caj2;
      const numero = `A-${String(n).padStart(6, '0')}`;
      await h.firestore.doc(`tenants/${A}/ventas/v-${n}`).set({ cajeroUid: dueno.uid, creadoEnMs: n });
      await h.firestore.doc(`tenants/${A}/recibos/recibo-v-${n}`).set({
        reciboId: `recibo-v-${n}`, tenantId: A, ventaId: `v-${n}`, numero, estado: 'EMITIDO', fecha: `2026-11-0${n}`, emitidoEn: `2026-11-0${n}T15:00:00.000Z`,
      });
    }
  });

  it('el número con serie no distingue mayúsculas ni exige el número completo', async () => {
    expect(await numeros(sup, { numero: 'A-000002' })).toEqual(['A-000002']);
    expect(await numeros(sup, { numero: 'a-000002' })).toEqual(['A-000002']);
    expect(await numeros(sup, { numero: 'a-00000' })).toEqual(['A-000006', 'A-000005', 'A-000004', 'A-000003', 'A-000002', 'A-000001']);
  });

  it('un número sin serie encuentra el comprobante de la serie del tenant', async () => {
    expect(await numeros(sup, { numero: '000003' })).toEqual(['A-000003']);
    expect(await numeros(sup, { numero: '3' })).toEqual(['A-000003']);
    expect(await numeros(sup, { numero: '000099' })).toEqual([]);
  });

  it('el vendedor ve solo lo suyo y el filtro se aplica antes del límite', async () => {
    // Los 3 más recientes son ajenos: con límite 2, filtrar después dejaría la lista vacía.
    expect(await numeros(caj, { limite: 2 })).toEqual(['A-000003', 'A-000002']);
    expect(await numeros(caj2, { limite: 2 })).toEqual(['A-000006', 'A-000005']);
    expect(await numeros(caj, { numero: '000005' })).toEqual([]);
    expect(await numeros(caj, { numero: '000002' })).toEqual(['A-000002']);
    expect(await numeros(sup, { limite: 2 })).toEqual(['A-000006', 'A-000005']);
  });
});
