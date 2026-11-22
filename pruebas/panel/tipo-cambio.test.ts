// Acciones de tipo de cambio manual (borde Central del servidor): permisos del núcleo, salto, confirmación, nombres en vez de uid.
import { describe, expect, it } from 'vitest';
import { COMERCIAL_LEGADO_TRES_MONEDAS, escribirCotizacionDe, limiteMemoria, type AlmacenCotizaciones, type Documento, type TransaccionCotizaciones } from '@novutienda/nucleo';
import { accionesTipoCambio } from '../../plataforma/funciones/servidor/llamadas/tipo-cambio.js';
import type { Contexto } from '../../plataforma/funciones/servidor/llamadas/marco.js';
import type { Entorno } from '../../plataforma/funciones/servidor/entorno.js';

interface Vista { mercados: { mercado: string; historial: { accion: string }[]; [k: string]: unknown }[] }
const AHORA = Date.parse('2026-11-04T14:00:00Z');

class Almacen implements AlmacenCotizaciones {
  readonly docs = new Map<string, Documento>();
  async leer(ruta: string): Promise<Documento | null> {
    return this.docs.get(ruta) ?? null;
  }
  async transaccion<T>(fn: (tx: TransaccionCotizaciones) => Promise<T>): Promise<T> {
    const pend: (() => void)[] = [];
    const r = await fn({ leer: (x) => this.leer(x), establecer: (x, d) => void pend.push(() => void this.docs.set(x, d)), crear: (x, d) => void pend.push(() => void this.docs.set(x, d)) });
    pend.forEach((p) => p());
    return r;
  }
  async listarRecientes(ruta: string, limite: number): Promise<readonly Documento[]> {
    return [...this.docs].filter(([r]) => r.startsWith(`${ruta}/`)).map(([, d]) => d).sort((a, b) => String(b['actualizadoEn']).localeCompare(String(a['actualizadoEn']))).slice(0, limite);
  }
}

async function montar() {
  const almacen = new Almacen();
  await escribirCotizacionDe(almacen, { mercado: 'BO', principal: { valor: 6.96, fecha: '2026-11-04', fuente: 'BCB' }, control: null, ahoraMs: AHORA - 1000 }, { tenantId: 't1', comercial: COMERCIAL_LEGADO_TRES_MONEDAS });
  let ahora = AHORA;
  const e = {
    almacenCotizaciones: almacen, ahora: () => ahora, comercialDelTenant: async () => COMERCIAL_LEGADO_TRES_MONEDAS,
    limiteTipoCambio: limiteMemoria(10, 3_600_000),
    auth: { getUsers: async (ids: { uid: string }[]) => ({ users: ids.map((i) => ({ uid: i.uid, email: `${i.uid}@ejemplo.test`, displayName: undefined })) }) },
  } as unknown as Entorno;
  const como = (uid: string, rol: Contexto['rol'] = 'adm', proveedor = 'password'): Contexto => ({ e, tenantId: 't1', rol, sesion: { uid, proveedor } as never, actor: {} as never }) as Contexto;
  const llamar = async (c: Contexto, n: string, d: unknown): Promise<Vista> => (accionesTipoCambio[n] as { ejecutar(c: Contexto, d: unknown): Promise<unknown> }).ejecutar(c, d) as Promise<Vista>;
  return { almacen, e, como, llamar, avanzar: (ms: number) => (ahora += ms) };
}

describe('tipo de cambio manual (borde del servidor)', () => {
  it('ver: referencia, sin manual, y un manual con el nombre de quien lo cargó (nunca el uid)', async () => {
    const m = await montar();
    const c = m.como('ana');
    let v = await m.llamar(c, 'verTipoCambio', {});
    const bo = v.mercados.find((x: { mercado: string }) => x.mercado === 'BO');
    expect(bo).toMatchObject({ par: 'BOB/USD', rige: 'referencia', manual: null, referencia: { valor: 6.96, fuente: 'BCB' } });
    await m.llamar(c, 'cotizacionManual', { mercado: 'BO', valor: 7 });
    v = await m.llamar(c, 'verTipoCambio', {});
    const b2 = v.mercados.find((x: { mercado: string }) => x.mercado === 'BO');
    expect(b2).toMatchObject({ rige: 'manual', manual: { valor: 7, por: 'ana@ejemplo.test' } });
    expect(b2?.historial[0]).toMatchObject({ accion: 'fijar', valor: 7, antes: 6.96, por: 'ana@ejemplo.test' });
    expect(JSON.stringify(v)).not.toMatch(/"ana"/);
  });

  it('un valor fuera de la banda de cordura se rechaza con un mensaje claro, aun confirmado', async () => {
    const m = await montar();
    await expect(m.llamar(m.como('ana'), 'cotizacionManual', { mercado: 'BO', valor: 696, confirmarSalto: true })).rejects.toMatchObject({ details: { codigo: 'valor-fuera-de-rango' }, message: expect.stringContaining('1 a 100') });
  });

  it('un salto de más del 5 % exige confirmarSalto', async () => {
    const m = await montar();
    await expect(m.llamar(m.como('ana'), 'cotizacionManual', { mercado: 'BO', valor: 9 })).rejects.toMatchObject({ name: 'SaltoSinConfirmar' });
    await expect(m.llamar(m.como('ana'), 'cotizacionManual', { mercado: 'BO', valor: 9, confirmarSalto: true })).resolves.toMatchObject({ ok: true });
  });

  it('rechaza un cajero, un administrador con Google, valores inválidos, claves extra y mercados sin tipo de cambio', async () => {
    const m = await montar();
    await expect(m.llamar(m.como('caj1', 'caj'), 'cotizacionManual', { mercado: 'BO', valor: 7 })).rejects.toMatchObject({ name: 'CargaNoAutorizada' });
    await expect(m.llamar(m.como('ana', 'adm', 'google.com'), 'cotizacionManual', { mercado: 'BO', valor: 7 })).rejects.toMatchObject({ name: 'CargaNoAutorizada' });
    for (const valor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.1234567]) await expect(m.llamar(m.como('ana'), 'cotizacionManual', { mercado: 'BO', valor })).rejects.toBeDefined();
    await expect(m.llamar(m.como('ana'), 'cotizacionManual', { mercado: 'BO', valor: 7, extra: 1 })).rejects.toBeDefined();
    await expect(m.llamar(m.como('ana'), 'cotizacionManual', { mercado: 'US', valor: 7 })).rejects.toBeDefined();
    expect(m.almacen.docs.has('tenants/t1/cotizaciones/manual-BO')).toBe(false);
  });

  it('volver al del banco central exige confirmar, solo lo hace el administrador con contraseña y queda en el historial', async () => {
    const m = await montar();
    await m.llamar(m.como('ana'), 'cotizacionManual', { mercado: 'BO', valor: 7 });
    await expect(m.llamar(m.como('ana'), 'quitarCotizacionManual', { mercado: 'BO' })).rejects.toMatchObject({ details: { codigo: 'confirmacion-requerida' } });
    await expect(m.llamar(m.como('ana', 'adm', 'google.com'), 'quitarCotizacionManual', { mercado: 'BO', confirmar: true })).rejects.toMatchObject({ name: 'CargaNoAutorizada' });
    await m.llamar(m.como('ana'), 'quitarCotizacionManual', { mercado: 'BO', confirmar: true });
    const v = await m.llamar(m.como('ana'), 'verTipoCambio', {});
    const bo = v.mercados.find((x: { mercado: string }) => x.mercado === 'BO');
    expect(bo).toMatchObject({ rige: 'referencia', manual: null });
    expect(bo?.historial.map((h) => h.accion).sort()).toEqual(['fijar', 'quitar']);
    await expect(m.llamar(m.como('ana'), 'quitarCotizacionManual', { mercado: 'BO', confirmar: true })).rejects.toMatchObject({ details: { codigo: 'sin-manual' } });
  });

  it('limita a 10 cambios por hora y comercio, y falla cerrado si falta el puerto del límite', async () => {
    const m = await montar();
    for (let i = 0; i < 10; i++) await m.llamar(m.como('ana'), 'cotizacionManual', { mercado: 'BO', valor: 7 + i * 0.001 });
    await expect(m.llamar(m.como('ana'), 'cotizacionManual', { mercado: 'BO', valor: 7 })).rejects.toMatchObject({ code: 'resource-exhausted' });
    const sin = await montar();
    (sin.e as unknown as Record<string, unknown>)['limiteTipoCambio'] = undefined;
    await expect(sin.llamar(sin.como('ana'), 'cotizacionManual', { mercado: 'BO', valor: 7 })).rejects.toMatchObject({ code: 'internal' });
  });
});
