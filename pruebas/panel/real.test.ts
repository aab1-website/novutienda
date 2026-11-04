// Conformidad de la traducción del panel (`api/real.ts`) con las tablas de acciones REALES de las Cloud Functions
// (plataforma/funciones/servidor/llamadas): toda acción que el panel invoca existe, con los mismos roles.
import { describe, expect, it } from 'vitest';
import type { CopiaCotizacion } from '@novutienda/nucleo';
import { preciosDelDia } from '@novutienda/consola';
import { ErrorApi, mensajeDeError, NOMBRES_CALLABLE, REDONDEO, ROLES_ACCION, ROLES_CALLABLE, TRADUCCION, precioDeVenta, usd, type NombreCallable } from '@novutienda/panel';
import { REDONDEO_POR_DEFECTO } from '../../plataforma/funciones/servidor/redondeo.js';
import { accionesConsola } from '../../plataforma/funciones/servidor/llamadas/consola.js';
import { accionesInventarios } from '../../plataforma/funciones/servidor/llamadas/inventarios.js';
import { accionesMedios } from '../../plataforma/funciones/servidor/llamadas/medios.js';
import { accionesPos } from '../../plataforma/funciones/servidor/llamadas/pos.js';
import { accionesRecibos } from '../../plataforma/funciones/servidor/llamadas/recibos.js';

const SERVIDOR: Readonly<Record<string, Readonly<Record<string, { readonly roles: readonly string[]; readonly propietario: boolean }>>>> = {
  pos: accionesPos, inventarios: accionesInventarios, consola: accionesConsola, recibos: accionesRecibos, medios: accionesMedios,
};
const real = (clave: string): { roles: readonly string[] } | undefined => {
  const [modulo = '', accion = ''] = clave.split('.');
  return SERVIDOR[modulo]?.[accion];
};

describe('acciones reales del servidor frente a la tabla del panel', () => {
  it('cada acción real tiene en el panel los mismos roles, y el panel no conoce acciones que no existen', () => {
    for (const [clave, roles] of Object.entries(ROLES_ACCION)) {
      const r = real(clave);
      expect(r, `${clave} no existe en el servidor`).toBeDefined();
      expect([...(r?.roles ?? [])].sort(), clave).toEqual([...roles].sort());
    }
    for (const [modulo, tabla] of Object.entries(SERVIDOR)) {
      for (const accion of Object.keys(tabla)) {
        // Acciones del propietario de la plataforma que el panel no usa.
        if (['buscarUsuarioPorCorreo'].includes(accion)) continue;
        expect(`${modulo}.${accion}` in ROLES_ACCION, `${modulo}.${accion} falta en ROLES_ACCION`).toBe(true);
      }
    }
  });
  it('cada operación del panel usa solo acciones que existen en el servidor', () => {
    for (const nombre of NOMBRES_CALLABLE) {
      for (const clave of TRADUCCION[nombre].usa) expect(real(clave), `${nombre} → ${clave}`).toBeDefined();
    }
  });
  it('los roles de cada operación no son más amplios que los del servidor', () => {
    for (const nombre of NOMBRES_CALLABLE) {
      const t = TRADUCCION[nombre];
      if (t.roles !== undefined) continue; // declaradas a mano (ver pendientes del informe)
      for (const rol of ROLES_CALLABLE[nombre]) {
        for (const clave of t.usa) expect([...(ROLES_ACCION[clave] ?? [])], `${nombre}/${clave}`).toContain(rol);
      }
    }
  });
});

describe('unidades', () => {
  /** Contexto que registra las acciones que la traducción envía al servidor. */
  async function enviado(nombre: NombreCallable, entrada: unknown): Promise<{ accion: string; datos: unknown }[]> {
    const llamadas: { accion: string; datos: unknown }[] = [];
    const c = {
      rol: 'adm' as const,
      esperar: (): Promise<void> => Promise.resolve(),
      llamar: (_m: string, accion: string, datos?: object): Promise<unknown> => {
        llamadas.push({ accion, datos });
        return Promise.resolve({ ok: true, productoId: 'x', config: {}, medio: {} });
      },
    };
    await (TRADUCCION[nombre] as unknown as { ejecutar(c: unknown, e: unknown): Promise<unknown> }).ejecutar(c, entrada);
    return llamadas;
  }
  it('el panel trabaja en centavos: solo consola.crearProducto, consola.editarProducto y consola.cambiarPrecioUSD reciben dólares', async () => {
    expect(usd(1250)).toBe(12.5);
    expect(usd(1999)).toBe(19.99);
    const alta = await enviado('crearProducto', { operacionId: 'o', producto: { id: 'p-1', nombre: 'P', categoria: 'C', sku: 'S', precioUSD: { bo: 1250, ar: 1999 }, costoUSD: 700 } });
    expect(alta[0]).toMatchObject({ accion: 'crearProducto', datos: { precioUSD: { bo: 12.5, ar: 19.99 } } });
    // El costo va a Inventarios, que usa centavos.
    expect(alta[1]).toMatchObject({ accion: 'fijarCosto', datos: { costoUSD: 700 } });
    const precio = await enviado('cambiarPrecioUSD', { productoId: 'p-1', precioUSD: { bo: 1999, ar: 2000 } });
    expect(precio[0]).toMatchObject({ accion: 'cambiarPrecioUSD', datos: { precioUSD: { bo: 19.99, ar: 20 } } });
    const edicion = await enviado('actualizarProducto', { operacionId: 'o', productoId: 'p-1', cambios: { nombre: 'N', precioUSD: { bo: 500, ar: 600 }, costoUSD: 300 } });
    expect(edicion.map((x) => x.accion)).toEqual(['editarProducto', 'cambiarPrecioUSD', 'fijarCosto']);
    expect(edicion[0]?.datos).toEqual({ productoId: 'p-1', cambios: { nombre: 'N' } });
    expect(edicion[1]?.datos).toMatchObject({ precioUSD: { bo: 5, ar: 6 } });
    expect(edicion[2]?.datos).toMatchObject({ costoUSD: 300 });
  });
  it('el resto de las operaciones con dinero no convierte nada', async () => {
    const venta = { requestId: 'r', carrito: { mercado: 'BO', moneda: 'BOB', lineas: [] }, pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 5568 }] };
    expect((await enviado('confirmarVenta', venta))[0]?.datos).toEqual(venta);
    const apertura = { turnoId: 't', apertura: { BOB: 10000 } };
    expect((await enviado('abrirTurno', apertura))[0]?.datos).toEqual(apertura);
  });
});

describe('redondeo: el panel calcula con la misma política que el servidor', () => {
  it('la política del panel es la del servidor por omisión', () => {
    expect(REDONDEO).toEqual(REDONDEO_POR_DEFECTO);
  });
  it('precioDeVenta del panel = consola.preciosDelDia (misma función y misma política)', () => {
    const copia = (par: 'BOB/USD' | 'ARS/USD', valor: number, fuente: string): CopiaCotizacion => ({ cotizacionId: 'x', par, valor, fecha: '2026-11-04', fuente, estado: 'vigente' }) as unknown as CopiaCotizacion;
    const cotBo = copia('BOB/USD', 6.96, 'BCB');
    const cotAr = copia('ARS/USD', 1031.37, 'BNA');
    for (const centavos of [1, 99, 800, 1250, 1999, 4500, 18000, 123457]) {
      const servidor = preciosDelDia({ bo: centavos / 100, ar: centavos / 100 }, { BO: cotBo, AR: cotAr }, REDONDEO_POR_DEFECTO);
      const bo = precioDeVenta(centavos, 'BO', 'BOB', { cotizacionId: 'x', par: 'BOB/USD', valor: 6.96, fecha: '2026-11-04', fuente: 'BCB', estado: 'vigente' });
      const ar = precioDeVenta(centavos, 'AR', 'ARS', { cotizacionId: 'x', par: 'ARS/USD', valor: 1031.37, fecha: '2026-11-04', fuente: 'BNA', estado: 'vigente' });
      for (const [panel, srv] of [[bo, servidor.BO], [ar, servidor.AR]] as const) {
        if (srv.tipo === 'precio') expect(panel).toMatchObject({ tipo: 'precio', centavos: srv.centavos });
        else expect(panel.tipo === 'precio').toBe(false);
      }
      // ARS: múltiplo de 100 pesos (10 000 centavos).
      if (servidor.AR.tipo === 'precio') expect(servidor.AR.centavos % 10_000).toBe(0);
    }
  });
});

describe('finalizarSubida frente al disparador de Storage', () => {
  it('reintenta mientras el servidor responde «ya fue resuelta» y devuelve el medio; si persiste, el error sube', async () => {
    let intentos = 0;
    const c = (fallan: number): unknown => ({
      rol: 'sup', esperar: () => Promise.resolve(),
      llamar: () => {
        intentos += 1;
        return intentos <= fallan ? Promise.reject(new ErrorApi('failed-precondition', 'La subida ya fue resuelta por otra solicitud')) : Promise.resolve({ medio: { id: 'sub-1', productoId: 'p' } });
      },
    });
    const t = TRADUCCION.finalizarSubida as unknown as { ejecutar(c: unknown, e: unknown): Promise<{ id: string }> };
    expect((await t.ejecutar(c(2), { subidaId: 'sub-1' })).id).toBe('sub-1');
    expect(intentos).toBe(3);
    intentos = 0;
    await expect(t.ejecutar(c(100), { subidaId: 'sub-1' })).rejects.toBeInstanceOf(ErrorApi);
    expect(intentos).toBe(8);
    intentos = 0;
    const otro = { rol: 'sup', esperar: () => Promise.resolve(), llamar: () => { intentos += 1; return Promise.reject(new ErrorApi('permission-denied', 'x')); } };
    await expect(t.ejecutar(otro, { subidaId: 'sub-1' })).rejects.toMatchObject({ codigoHttps: 'permission-denied' });
    expect(intentos).toBe(1);
  });
});

describe('redondeo que llega del servidor (pos.cotizaciones)', () => {
  const cot = { cotizacionId: 'x', par: 'ARS/USD' as const, valor: 1000, fecha: '2026-11-04', fuente: 'BNA', estado: 'vigente' as const };
  const BOB = { tipo: 'decimales', decimales: 2, modo: 'cercano' };
  const t = TRADUCCION.cotizacionesVigentes as unknown as { ejecutar(c: unknown, e: unknown): Promise<{ AR: unknown; BO: unknown }> };
  const respuesta = (redondeo: unknown) => ({
    rol: 'caj' as const, esperar: (): Promise<void> => Promise.resolve(),
    llamar: (): Promise<unknown> => Promise.resolve({ cotizaciones: { BO: null, AR: cot }, redondeo }),
  });
  it('la traducción adopta el redondeo del servidor y precioDeVenta lo usa; una forma inválida se ignora', async () => {
    // 10,49 USD * 1000 = 10 490 ARS: múltiplo de 100 → 10 500; múltiplo de 1000 → 10 000.
    await t.ejecutar(respuesta({ BOB, ARS: { tipo: 'multiplo', multiplo: 100, modo: 'cercano' } }), {});
    expect(precioDeVenta(1049, 'AR', 'ARS', cot)).toMatchObject({ centavos: 1_050_000 });
    expect(await t.ejecutar(respuesta({ BOB, ARS: { tipo: 'multiplo', multiplo: 1000, modo: 'cercano' } }), {})).toMatchObject({ BO: null, AR: { valor: 1000 } });
    expect(precioDeVenta(1049, 'AR', 'ARS', cot)).toMatchObject({ centavos: 1_000_000 });
    await t.ejecutar(respuesta({ cualquier: 'cosa' }), {});
    await t.ejecutar(respuesta(undefined), {});
    expect(precioDeVenta(1049, 'AR', 'ARS', cot)).toMatchObject({ centavos: 1_000_000 });
    // Se deja el respaldo vigente para el resto de la suite.
    await t.ejecutar(respuesta(REDONDEO), {});
    expect(precioDeVenta(1049, 'AR', 'ARS', cot)).toMatchObject({ centavos: 1_050_000 });
  });
});

describe('errores del servidor: el panel mapea por details.codigo', () => {
  it('cada código de módulo conocido tiene su mensaje; el del borde usa el mensaje del servidor', () => {
    expect(mensajeDeError(new ErrorApi('failed-precondition', 'x', { codigo: 'serie-no-disponible' }))).toBe('Esa serie no está disponible en ese almacén.');
    expect(mensajeDeError(new ErrorApi('not-found', 'x', { codigo: 'recibo-no-encontrado' }))).toBe('No se encontró el comprobante.');
    expect(mensajeDeError(new ErrorApi('permission-denied', 'Solo puede ver sus propias ventas.', { codigo: 'acceso-denegado' }))).toBe('Solo puede ver sus propias ventas.');
    expect(mensajeDeError(new ErrorApi('internal', 'detalle técnico', { codigo: 'error-interno' }))).not.toContain('técnico');
  });
});

describe('buscarUsuarioPorCorreo y exportarVentasCsv', () => {
  it('traducen a sus acciones reales con los datos y roles del servidor', async () => {
    const llamadas: { modulo: string; accion: string; datos: unknown }[] = [];
    const c = {
      rol: 'adm' as const, esperar: (): Promise<void> => Promise.resolve(),
      llamar: (modulo: string, accion: string, datos?: object): Promise<unknown> => {
        llamadas.push({ modulo, accion, datos });
        return Promise.resolve(accion === 'exportarVentasCsv' ? { csv: 'a\r\n', truncado: llamadas.length === 3 } : { uid: 'u1', correoVerificado: true, conContrasena: false });
      },
    };
    const ejecutar = (n: NombreCallable, e: unknown): Promise<unknown> => (TRADUCCION[n] as unknown as { ejecutar(c: unknown, e: unknown): Promise<unknown> }).ejecutar(c, e);
    expect(await ejecutar('buscarUsuarioPorCorreo', { correo: ' ana@ejemplo.test ' })).toEqual({ uid: 'u1', correoVerificado: true, conContrasena: false });
    expect(llamadas[0]).toEqual({ modulo: 'consola', accion: 'buscarUsuarioPorCorreo', datos: { correo: 'ana@ejemplo.test' } });
    expect(await ejecutar('exportarVentasCsv', { desde: '2026-11-01', hasta: '2026-11-03' })).toEqual({ csv: 'a\r\n', truncado: false });
    expect(llamadas[1]).toEqual({ modulo: 'pos', accion: 'exportarVentasCsv', datos: { desde: Date.parse('2026-11-01T00:00:00.000-04:00'), hasta: Date.parse('2026-11-03T23:59:59.999-04:00') } });
    // Sin fechas: último año, siempre dentro del tope de 366 días del servidor.
    // El aviso de truncado del servidor llega al panel.
    expect(await ejecutar('exportarVentasCsv', {})).toEqual({ csv: 'a\r\n', truncado: true });
    const d = llamadas[2]?.datos as { desde: number; hasta: number };
    expect(d.hasta - d.desde).toBeLessThanOrEqual(366 * 86_400_000);
    expect([...ROLES_CALLABLE.buscarUsuarioPorCorreo]).toEqual(['adm']);
    expect([...ROLES_CALLABLE.exportarVentasCsv].sort()).toEqual(['adm', 'sup']);
  });
});
