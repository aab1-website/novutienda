// Conformidad de la traducción del panel (`api/real.ts`) con las tablas de acciones REALES de las Cloud Functions
// (plataforma/funciones/servidor/llamadas): toda acción que el panel invoca existe, con los mismos roles, salvo las
// propuestas pendientes (que deben seguir ausentes del servidor: si el servidor las agrega, hay que pasarlas a reales).
import { describe, expect, it } from 'vitest';
import type { CopiaCotizacion } from '@novutienda/nucleo';
import { preciosDelDia } from '@novutienda/consola';
import { ErrorApi, NOMBRES_CALLABLE, PROPUESTAS, REDONDEO, ROLES_ACCION, ROLES_CALLABLE, TRADUCCION, precioDeVenta, usd, type NombreCallable } from '@novutienda/panel';
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
  it('cada operación del panel usa solo acciones reales o propuestas declaradas; las propuestas no existen aún en el servidor', () => {
    for (const nombre of NOMBRES_CALLABLE) {
      for (const clave of TRADUCCION[nombre].usa) {
        const propuesta = clave in PROPUESTAS;
        expect(propuesta ? real(clave) === undefined : real(clave) !== undefined, `${nombre} → ${clave}`).toBe(true);
      }
    }
  });
  it('los roles de cada operación no son más amplios que los del servidor', () => {
    for (const nombre of NOMBRES_CALLABLE) {
      const t = TRADUCCION[nombre];
      if (t.roles !== undefined) continue; // declaradas a mano (ver pendientes del informe)
      for (const rol of ROLES_CALLABLE[nombre]) {
        for (const clave of t.usa) expect([...(ROLES_ACCION[clave] ?? PROPUESTAS[clave] ?? [])], `${nombre}/${clave}`).toContain(rol);
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
