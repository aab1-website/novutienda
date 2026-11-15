// `consola.configuracionComercial` (Central, solo lectura) contra el emulador: sesión obligatoria, cualquier rol del
// comercio, siempre el tenant de la sesión y falla cerrado ante una configuración inválida.
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { construirClaim } from '@novutienda/nucleo';
import { ComercialInvalida } from '../../plataforma/coordinador/comercial.js';
import { crearEntorno } from '../../plataforma/funciones/servidor/entorno.js';
import { crearManejador } from '../../plataforma/funciones/servidor/llamadas/marco.js';
import { tablasCompuestas } from './tablas.js';
import { accion, crearUsuario, hayEmulador, herramientas, llamar, sembrarTenant, TENANT_TODO_ENCENDIDO, type Herramientas, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const A = 'comercial-a';
const B = 'comercial-b';
const C = 'comercial-c';
const TRES_MONEDAS = {
  mercados: [
    { id: 'BO', nombre: 'Bolivia', monedaVenta: 'BOB', monedaBase: 'USD', tieneTipoCambio: true },
    { id: 'AR', nombre: 'Argentina', monedaVenta: 'ARS', monedaBase: 'USD', tieneTipoCambio: true },
  ],
  monedasCaja: ['BOB', 'USD', 'ARS'],
};

describe.skipIf(!hayEmulador)('consola.configuracionComercial (emulador)', () => {
  let h: Herramientas;
  const u: Record<'caj' | 'sup' | 'adm', Usuario> = {} as never;
  let deB: Usuario;
  let deC: Usuario;

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, A);
    await sembrarTenant(h, B);
    await h.firestore.doc(`tenants/${B}`).set({
      estado: 'activo', plan: 'multimercado', modulos: TENANT_TODO_ENCENDIDO.modulos,
      comercial: { mercados: [{ id: 'PE', nombre: 'Perú', monedaVenta: 'PEN', monedaBase: 'USD', zonaHoraria: 'America/Lima', tipoCambio: { par: 'PEN/USD', fuentes: ['manual'] }, redondeo: { tipo: 'decimales', decimales: 2, modo: 'cercano' } }], monedas: ['PEN', 'USD'], monedaCosto: 'EUR' },
    });
    // Configuración inválida: monedas fuera de lo admitido por la forma anterior.
    await h.firestore.doc(`tenants/${C}`).set({ ...TENANT_TODO_ENCENDIDO, monedas: ['BOB'] });
    for (const rol of ['caj', 'sup', 'adm'] as const) u[rol] = await crearUsuario(h, { rol, tenant: A });
    deB = await crearUsuario(h, { rol: 'adm', tenant: B });
    deC = await crearUsuario(h, { rol: 'adm', tenant: C });
  });

  it('sin sesión se rechaza', async () => {
    expect((await accion('consola', 'configuracionComercial', {}, undefined, A)).status).toBe(401);
  });

  it('cada rol del comercio recibe la vista del tenant de la sesión', async () => {
    for (const rol of ['caj', 'sup', 'adm'] as const) {
      const r = await accion('consola', 'configuracionComercial', {}, u[rol].token, A);
      expect(r.status, JSON.stringify(r.error)).toBe(200);
      // El código de la moneda de costo llega solo al rol `adm`; `caj` y `sup` no reciben el campo.
      expect(r.resultado, rol).toEqual(rol === 'adm' ? { ...TRES_MONEDAS, monedaCosto: 'USD' } : TRES_MONEDAS);
    }
  });

  it('un usuario de otro tenant obtiene la suya y no puede pedir la ajena', async () => {
    const suya = await accion('consola', 'configuracionComercial', {}, deB.token, B); // deB es `adm`
    expect(suya.resultado).toEqual({ mercados: [{ id: 'PE', nombre: 'Perú', monedaVenta: 'PEN', monedaBase: 'USD', tieneTipoCambio: true }], monedasCaja: ['PEN', 'USD'], monedaCosto: 'EUR' });
    expect((await accion('consola', 'configuracionComercial', {}, deB.token, A)).status).toBe(403);
    expect((await accion('consola', 'configuracionComercial', {}, u.adm.token, B)).status).toBe(403);
  });

  it('no acepta datos del cliente', async () => {
    const r = await llamar('consola', { accion: 'configuracionComercial', tenantId: A, datos: { tenantId: B } }, u.adm.token);
    expect(r.status).toBe(400);
  });

  it('configuración inválida: el marco la rechaza antes de ejecutar, igual que un módulo apagado (falla cerrado)', async () => {
    const r = await accion('consola', 'configuracionComercial', {}, deC.token, C);
    expect(r.status).toBe(403);
    expect(r.error).toMatchObject({ details: { codigo: 'modulo-apagado' } });
  });
});

// Sin emulador: si el lector comercial falla cuando el tenant ya pasó el control de módulos (cachés con distinta edad), el
// callable responde failed-precondition con un mensaje útil y sin detalle interno.
describe('consola.configuracionComercial ante ComercialInvalida (sin emulador)', () => {
  const T = 'tienda-uno';
  const peticion = (tenantId = T): Parameters<ReturnType<typeof crearManejador>>[0] =>
    ({ data: { accion: 'configuracionComercial', tenantId, datos: {} }, rawRequest: { headers: { authorization: 'Bearer x' } }, app: {} }) as never;

  function manejador(motivo?: 'invalido' | 'inexistente') {
    const docs: Record<string, unknown> = { [`tenants/${T}`]: TENANT_TODO_ENCENDIDO };
    const f = { doc: (ruta: string) => ({ get: async () => ({ exists: Object.hasOwn(docs, ruta), data: () => docs[ruta] }) }), collection: () => ({ listDocuments: async () => [] }) };
    const claim = construirClaim({ [T]: 'caj' }, 1, false);
    if (!claim.ok) throw new Error(claim.error);
    const auth = { verifyIdToken: async () => ({ uid: 'u1', email_verified: true, firebase: { sign_in_provider: 'password' }, ...claim.valor }) };
    const e = crearEntorno({ firestore: f as never, auth: auth as never, bucket: {} as never, ahora: () => 1_000, env: {} });
    const entorno = motivo === undefined ? e : { ...e, comercialDelTenant: Object.assign(async () => { throw new ComercialInvalida(motivo); }, { invalidar: () => undefined }) };
    return crearManejador({ modulo: 'consola', acciones: tablasCompuestas()['consola'] ?? {}, entorno: () => entorno, appCheckExigido: () => true });
  }

  it('devuelve la vista del tenant de la sesión', async () => {
    expect(await manejador()(peticion())).toEqual(TRES_MONEDAS);
  });

  it.each(['invalido', 'inexistente'] as const)('ComercialInvalida (%s) → failed-precondition comercial-invalida', async (motivo) => {
    const error = await manejador(motivo)(peticion()).then(() => undefined, (x: unknown) => x as { code: string; message: string; details?: { codigo?: string } });
    expect(error).toMatchObject({ code: 'failed-precondition', details: { codigo: 'comercial-invalida' } });
    expect(error?.message).toMatch(/configuración comercial/i);
    expect(error?.message).not.toContain(T);
  });
});
