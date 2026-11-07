// Acciones agregadas para el panel (ola 3c), contra el emulador: cotizaciones y redondeo, series, auditoría, lecturas del
// sitio, créditos del vendedor, conteo ciego con resultado, costos fuera de movimientos para `sup`, `details.codigo` en
// todos los errores y la búsqueda de usuarios que no revela cuentas de otros negocios.
import { Timestamp } from 'firebase-admin/firestore';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { accion, crearUsuario, hayEmulador, herramientas, sembrarTenant, unico, TENANT_TODO_ENCENDIDO, type Herramientas, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const A = 'falt-a';
const B = 'falt-b';
type Obj = Record<string, unknown>;
const cuerpo = (r: { resultado?: unknown }): Obj => r.resultado as Obj;

describe.skipIf(!hayEmulador)('acciones faltantes del panel (emulador)', () => {
  let h: Herramientas;
  let adm: Usuario;
  let sup: Usuario;
  let caj: Usuario;
  let caj2: Usuario;
  let admB: Usuario;

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, A, {
      productos: [
        { id: 'celular', nombre: 'Celular X1', precioUSD: { bo: 10000, ar: 10000 }, tienda: 3, conSerie: true, series: ['S-A', 'S-B', 'S-C'] },
        { id: 'lapiz', nombre: 'Lápiz HB', precioUSD: { bo: 1000, ar: 1000 }, tienda: 10 },
      ],
    });
    await sembrarTenant(h, B);
    adm = await crearUsuario(h, { rol: 'adm', tenant: A });
    sup = await crearUsuario(h, { rol: 'sup', tenant: A });
    caj = await crearUsuario(h, { rol: 'caj', tenant: A });
    caj2 = await crearUsuario(h, { rol: 'caj', tenant: A });
    admB = await crearUsuario(h, { rol: 'adm', tenant: B });
  });

  describe('pos.cotizaciones', () => {
    it('todos los roles reciben las dos cotizaciones y la política de redondeo por defecto', async () => {
      for (const u of [caj, sup, adm]) {
        const r = await accion('pos', 'cotizaciones', {}, u.token, A);
        expect(r.status, JSON.stringify(r.error)).toBe(200);
        expect(cuerpo(r)).toMatchObject({
          cotizaciones: { BO: { par: 'BOB/USD', valor: 7, estado: 'vigente', fuente: 'manual' }, AR: { par: 'ARS/USD', valor: 1000, estado: 'vigente' } },
          redondeo: { BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' }, ARS: { tipo: 'multiplo', multiplo: 100, modo: 'cercano' } },
        });
      }
      expect((await accion('pos', 'cotizaciones', {}, undefined, A)).status).toBe(401);
      expect((await accion('pos', 'cotizaciones', {}, admB.token, A)).status).toBe(403);
    });

    it('respeta la política del tenant; sin cotización cargada devuelve null por mercado', async () => {
      const C = 'falt-c';
      await sembrarTenant(h, C);
      await h.firestore.doc(`tenants/${C}/config/redondeo`).set({ BOB: { tipo: 'ninguno' }, ARS: { tipo: 'multiplo', multiplo: 500, modo: 'arriba' } });
      const u = await crearUsuario(h, { rol: 'caj', tenant: C });
      const r = await accion('pos', 'cotizaciones', {}, u.token, C);
      expect(r.status).toBe(200);
      expect(cuerpo(r)['redondeo']).toEqual({ BOB: { tipo: 'ninguno' }, ARS: { tipo: 'multiplo', multiplo: 500, modo: 'arriba' } });
      const D = 'falt-d';
      await h.firestore.doc(`tenants/${D}`).set(TENANT_TODO_ENCENDIDO);
      const v = await crearUsuario(h, { rol: 'caj', tenant: D });
      expect(cuerpo(await accion('pos', 'cotizaciones', {}, v.token, D))['cotizaciones']).toEqual({ BO: null, AR: null });
    });
  });

  describe('inventarios.series', () => {
    it('todos los roles ven las unidades de un producto, con filtros y sin costos', async () => {
      const todas = await accion('inventarios', 'series', { productoId: 'celular' }, caj.token, A);
      expect(todas.status, JSON.stringify(todas.error)).toBe(200);
      const unidades = cuerpo(todas)['unidades'] as Obj[];
      expect(unidades.map((u) => u['serie'])).toEqual(['S-A', 'S-B', 'S-C']);
      expect(unidades[0]).toMatchObject({ productoId: 'celular', estado: 'disponible', ubicacionId: 'tienda' });
      expect(JSON.stringify(unidades)).not.toMatch(/costo/i);
      await h.firestore.doc(`tenants/${A}/unidades/celular__S-B`).set({ estado: 'vendida', ventaRef: { tipo: 'venta', id: 'venta-1' } }, { merge: true });
      const libres = cuerpo(await accion('inventarios', 'series', { productoId: 'celular', soloDisponibles: true }, sup.token, A))['unidades'] as Obj[];
      expect(libres.map((u) => u['serie'])).toEqual(['S-A', 'S-C']);
      const vendida = cuerpo(await accion('inventarios', 'series', { productoId: 'celular', ubicacionId: 'tienda' }, adm.token, A))['unidades'] as Obj[];
      expect(vendida.find((u) => u['serie'] === 'S-B')).toMatchObject({ estado: 'vendida', ventaRef: 'venta-1' });
      expect(cuerpo(await accion('inventarios', 'series', { productoId: 'celular', ubicacionId: 'deposito-1' }, adm.token, A))['unidades']).toEqual([]);
      expect((await accion('inventarios', 'series', { productoId: 'celular' }, admB.token, A)).status).toBe(403);
      expect((await accion('inventarios', 'series', { productoId: 'Mal Id' }, adm.token, A)).status).toBe(400);
    });
  });

  describe('consola.auditoria', () => {
    it('solo sup/adm; devuelve los campos de la vista, filtra por rango, acción y persona', async () => {
      // Tenant propio: el sembrado de los demás deja sus propias entradas de auditoría.
      const E = 'falt-e';
      await h.firestore.doc(`tenants/${E}`).set(TENANT_TODO_ENCENDIDO);
      const [supE, admE, cajE] = await Promise.all([crearUsuario(h, { rol: 'sup', tenant: E }), crearUsuario(h, { rol: 'adm', tenant: E }), crearUsuario(h, { rol: 'caj', tenant: E })]);
      const col = h.firestore.collection(`tenants/${E}/auditoria`);
      const base = Date.parse('2026-10-10T12:00:00Z');
      await col.add({ tenantId: E, uid: 'u-1', rol: 'adm', accion: 'seccion.crear', ruta: 'x', en: Timestamp.fromMillis(base), resumenDespues: { visible: true }, motivo: 'm1' });
      await col.add({ tenantId: E, uid: 'u-2', rol: 'sup', accion: 'ficha.guardar', ruta: 'y', en: Timestamp.fromMillis(base + 86_400_000) });
      await col.add({ tenantId: E, uid: 'u-1', rol: 'adm', accion: 'ficha.guardar', ruta: 'z', en: Timestamp.fromMillis(base + 2 * 86_400_000) });
      expect((await accion('consola', 'auditoria', {}, cajE.token, E)).status).toBe(403);
      const todas = cuerpo(await accion('consola', 'auditoria', {}, supE.token, E))['entradas'] as Obj[];
      expect(todas.map((e) => e['ruta'])).toEqual(['z', 'y', 'x']);
      expect(todas[2]).toMatchObject({ uid: 'u-1', rol: 'adm', accion: 'seccion.crear', fecha: '2026-10-10T12:00:00.000Z', motivo: 'm1' });
      expect(JSON.stringify(todas)).not.toContain('resumen');
      const rango = cuerpo(await accion('consola', 'auditoria', { desde: base + 3_600_000, hasta: base + 86_400_000 + 1000 }, admE.token, E))['entradas'] as Obj[];
      expect(rango.map((e) => e['ruta'])).toEqual(['y']);
      const porAccion = cuerpo(await accion('consola', 'auditoria', { accion: 'ficha.guardar', uid: 'u-1' }, admE.token, E))['entradas'] as Obj[];
      expect(porAccion.map((e) => e['ruta'])).toEqual(['z']);
      expect(cuerpo(await accion('consola', 'auditoria', { limite: 1 }, admE.token, E))['entradas']).toHaveLength(1);
      // Aislamiento: la auditoría de B no trae entradas de E.
      expect((cuerpo(await accion('consola', 'auditoria', {}, admB.token, B))['entradas'] as Obj[]).some((e) => ['x', 'y', 'z'].includes(String(e['ruta'])))).toBe(false);
    });
  });

  describe('lecturas del sitio', () => {
    it('fichas, secciones (en orden del índice), carruseles y configuración: solo sup/adm', async () => {
      await h.firestore.doc(`tenants/${A}/fichasWeb/celular`).set({ descripcion: 'Un celular' });
      await h.firestore.doc(`tenants/${A}/secciones/b-uno`).set({ id: 'b-uno', visible: true });
      await h.firestore.doc(`tenants/${A}/secciones/a-dos`).set({ id: 'a-dos', visible: false });
      await h.firestore.doc(`tenants/${A}/sitio/indice`).set({ secciones: ['b-uno', 'a-dos'] });
      await h.firestore.doc(`tenants/${A}/carruseles/inicio`).set({ plantilla: 'inicio', items: [] });
      for (const a of ['fichas', 'secciones', 'carruseles', 'configSitio']) expect((await accion('consola', a, {}, caj.token, A)).status, a).toBe(403);
      expect(cuerpo(await accion('consola', 'fichas', {}, sup.token, A))['fichas']).toEqual([{ productoId: 'celular', ficha: { descripcion: 'Un celular' } }]);
      expect((cuerpo(await accion('consola', 'secciones', {}, sup.token, A))['secciones'] as Obj[]).map((s) => s['id'])).toEqual(['b-uno', 'a-dos']);
      expect(cuerpo(await accion('consola', 'carruseles', {}, adm.token, A))['carruseles']).toEqual([{ plantilla: 'inicio', items: [] }]);
      expect(cuerpo(await accion('consola', 'configSitio', {}, sup.token, A))['config']).toBeNull();
      await h.firestore.doc(`tenants/${A}/sitio/config`).set({ plantilla: 'clasica' });
      expect(cuerpo(await accion('consola', 'configSitio', {}, adm.token, A))['config']).toEqual({ plantilla: 'clasica' });
      // Aislamiento por tenant.
      expect(cuerpo(await accion('consola', 'fichas', {}, admB.token, B))['fichas']).toEqual([]);
    });
  });

  describe('pos.creditos', () => {
    it('el vendedor solo ve los créditos de sus ventas; sup/adm ven todos', async () => {
      // El crédito guarda al vendedor: no se consulta a través de las ventas (sin tope de ventas recientes).
      const creditos = h.firestore.collection(`tenants/${A}/creditos`);
      await creditos.doc('v-1').set({ ventaId: 'v-1', cajeroUid: caj.uid, estado: 'pendiente', creadoEnMs: 1000 });
      await creditos.doc('v-2').set({ ventaId: 'v-2', cajeroUid: caj2.uid, estado: 'pendiente', creadoEnMs: 2000 });
      await creditos.doc('v-3').set({ ventaId: 'v-3', cajeroUid: caj.uid, estado: 'cobrado', creadoEnMs: 3000 });
      await creditos.doc('v-4').set({ ventaId: 'v-4', cajeroUid: caj.uid, estado: 'anulado', creadoEnMs: 4000 });
      const ids = async (u: Usuario, datos: object = {}): Promise<unknown[]> => ((cuerpo(await accion('pos', 'creditos', datos, u.token, A))['creditos'] as Obj[]).map((c) => c['ventaId']));
      expect(await ids(caj)).toEqual(['v-4', 'v-3', 'v-1']);
      expect(await ids(caj, { estado: 'pendiente' })).toEqual(['v-1']);
      expect(await ids(caj, { estado: 'anulado' })).toEqual(['v-4']);
      expect(await ids(caj2)).toEqual(['v-2']);
      expect(await ids(sup)).toEqual(['v-4', 'v-3', 'v-2', 'v-1']);
      expect(await ids(sup, { estado: 'anulado' })).toEqual(['v-4']);
      expect(await ids(adm, { estado: 'cobrado' })).toEqual(['v-3']);
      const sinVentas = await crearUsuario(h, { rol: 'caj', tenant: A });
      expect(await ids(sinVentas)).toEqual([]);
    });
  });

  describe('inventarios.conteo (ciego)', () => {
    it('el resultado (teórico, contado, diferencia) solo llega a sup/adm con el conteo cerrado', async () => {
      const conteoId = unico('cnt');
      expect((await accion('inventarios', 'abrirConteo', { operacionId: unico('op'), conteoId, ubicacionId: 'tienda' }, sup.token, A)).status).toBe(200);
      const lin = await accion('inventarios', 'registrarLineaConteo', { operacionId: unico('op'), conteoId, productoId: 'lapiz', contado: 8 }, caj.token, A);
      expect(lin.status, JSON.stringify(lin.error)).toBe(200);
      for (const u of [caj, sup, adm]) {
        const abierto = cuerpo(await accion('inventarios', 'conteo', { conteoId }, u.token, A));
        expect(abierto['resultado'], `abierto/${u.uid}`).toBeUndefined();
        expect(JSON.stringify(abierto)).not.toMatch(/teorico|esperado/i);
      }
      const cierre = await accion('inventarios', 'cerrarConteo', { operacionId: unico('op'), conteoId }, sup.token, A);
      expect(cierre.status, JSON.stringify(cierre.error)).toBe(200);
      expect(cuerpo(await accion('inventarios', 'conteo', { conteoId }, caj.token, A))['resultado']).toBeUndefined();
      for (const u of [sup, adm]) {
        const cerrado = cuerpo(await accion('inventarios', 'conteo', { conteoId }, u.token, A));
        expect(cerrado['resultado']).toEqual([{ productoId: 'lapiz', teorico: 10, contado: 8, diferencia: -2 }]);
      }
    });
  });

  describe('inventarios.movimientos', () => {
    it('el costo unitario es solo del administrador; filtros por tipo y persona', async () => {
      const col = h.firestore.collection(`tenants/${A}/movimientos`);
      const m = (id: string, tipo: string, por: string, ms: number): Promise<unknown> =>
        col.doc(id).set({ operacionId: id, productoId: 'filtro-p', ubicacionId: 'tienda', tipo, delta: 1, saldoUbicacion: 1, saldoTotal: 1, series: [], costoUSDUnit: 4.5, por, rol: 'sup', fecha: Timestamp.fromMillis(ms) });
      await m('mv-1', 'ingreso', 'u-a', 5_000_000_000_000);
      await m('mv-2', 'merma', 'u-b', 5_000_000_001_000);
      await m('mv-3', 'ingreso', 'u-b', 5_000_000_002_000);
      const ops = async (u: Usuario, datos: object): Promise<Obj[]> => cuerpo(await accion('inventarios', 'movimientos', { productoId: 'filtro-p', ...datos }, u.token, A))['movimientos'] as Obj[];
      expect((await ops(sup, {})).map((x) => x['operacionId'])).toEqual(['mv-3', 'mv-2', 'mv-1']);
      expect(JSON.stringify(await ops(sup, {}))).not.toContain('costoUSDUnit');
      expect((await ops(adm, {})).every((x) => x['costoUSDUnit'] === 4.5)).toBe(true);
      expect((await ops(sup, { tipo: 'ingreso' })).map((x) => x['operacionId'])).toEqual(['mv-3', 'mv-1']);
      expect((await ops(sup, { uid: 'u-b' })).map((x) => x['operacionId'])).toEqual(['mv-3', 'mv-2']);
      expect((await ops(adm, { tipo: 'ingreso', uid: 'u-b', limite: 1 })).map((x) => x['operacionId'])).toEqual(['mv-3']);
      expect((await accion('inventarios', 'movimientos', {}, caj.token, A)).status).toBe(403);
    });
  });

  describe('details.codigo en todos los errores', () => {
    it('los errores del borde, de autenticación y de los módulos llevan su código en kebab-case', async () => {
      const kebab = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
      const codigo = (r: { error?: { details?: unknown } }): unknown => (r.error?.details as { codigo?: unknown } | undefined)?.codigo;
      const casos = [
        { r: await accion('pos', 'leerConfig', {}, undefined, A), esperado: 'no-autenticado' },
        { r: await accion('pos', 'leerConfig', {}, admB.token, A), esperado: 'acceso-denegado' },
        { r: await accion('pos', 'guardarConfig', { config: {} }, sup.token, A), esperado: 'acceso-denegado' },
        { r: await accion('pos', 'noExiste', {}, caj.token, A), esperado: 'solicitud-invalida' },
        { r: await accion('pos', 'abrirTurno', { turnoId: 'x' }, caj.token, A), esperado: 'solicitud-invalida' },
        { r: await accion('pos', 'venta', { ventaId: '00000000-0000-4000-8000-0000000000aa' }, caj.token, A), esperado: 'recurso-inexistente' },
        { r: await accion('pos', 'cerrarTurno', { turnoId: '00000000-0000-4000-8000-0000000000bb', contado: {} }, caj.token, A), esperado: undefined },
        { r: await accion('inventarios', 'conteo', { conteoId: 'no-existe' }, sup.token, A), esperado: 'recurso-inexistente' },
        { r: await accion('inventarios', 'traspasar', { operacionId: unico('op'), origenId: 'tienda', destinoId: 'deposito-1', lineas: [{ productoId: 'lapiz', cantidad: 9999 }] }, sup.token, A), esperado: 'stock-insuficiente' },
        { r: await accion('recibos', 'leerRecibo', { reciboId: 'recibo-no-existe' }, sup.token, A), esperado: 'recurso-inexistente' },
        { r: await accion('consola', 'asignarRol', { uid: 'no-existe', rol: 'caj' }, adm.token, A), esperado: undefined },
      ];
      for (const { r, esperado } of casos) {
        expect(r.status, JSON.stringify(r.error)).toBeGreaterThanOrEqual(400);
        const c = codigo(r);
        expect(typeof c === 'string' && kebab.test(c), JSON.stringify(r.error)).toBe(true);
        if (esperado !== undefined) expect(c).toBe(esperado);
      }
      // Los datos inválidos conservan `campos` (sin valores) junto al código.
      const mal = await accion('pos', 'abrirTurno', { turnoId: 'no-es-uuid' }, caj.token, A);
      expect(mal.error?.details).toMatchObject({ codigo: 'solicitud-invalida', campos: expect.any(Array) });
      expect(JSON.stringify(mal.error)).not.toContain('no-es-uuid');
    });
  });

  describe('consola.buscarUsuarioPorCorreo no revela cuentas de otros negocios', () => {
    it('responde solo si la cuenta es miembro del negocio o no tiene ningún negocio; si no, igual que si no existiera', async () => {
      const libre = await crearUsuario(h, {});
      expect((await accion('consola', 'buscarUsuarioPorCorreo', { correo: libre.correo }, adm.token, A)).resultado).toMatchObject({ uid: libre.uid });
      // Miembro de este negocio.
      expect((await accion('consola', 'buscarUsuarioPorCorreo', { correo: sup.correo }, adm.token, A)).resultado).toMatchObject({ uid: sup.uid });
      // Cuenta de otro negocio (no miembro de A): indistinguible de una cuenta inexistente.
      const ajena = await accion('consola', 'buscarUsuarioPorCorreo', { correo: admB.correo }, adm.token, A);
      const inexistente = await accion('consola', 'buscarUsuarioPorCorreo', { correo: 'nadie@prueba.test' }, adm.token, A);
      expect(ajena.status).toBe(404);
      expect(ajena.error).toEqual(inexistente.error);
      // Cuenta con roles en A y en B: es miembro de A, se muestra.
      const doble = await crearUsuario(h, { roles: { [A]: 'caj', [B]: 'caj' } });
      expect((await accion('consola', 'buscarUsuarioPorCorreo', { correo: doble.correo }, adm.token, A)).status).toBe(200);
      // Y desde B tampoco se ve la cuenta que solo es de A.
      expect((await accion('consola', 'buscarUsuarioPorCorreo', { correo: caj.correo }, admB.token, B)).status).toBe(404);
    });
  });
});
