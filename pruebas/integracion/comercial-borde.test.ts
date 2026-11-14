// Bordes de la configuración comercial sin emulador: el catálogo del asistente ante un mercado ajeno, el mapeo de errores de los
// callables y la cotización programada ante un fallo de lectura.
import { limiteMemoria, validarConfiguracionComercial, type ConfiguracionComercial } from '@novutienda/nucleo';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entorno } from '../../plataforma/funciones/servidor/entorno.js';
import { comoHttpsError } from '../../plataforma/funciones/servidor/llamadas/marco.js';
import { COLECCION_TOKENS, manejarCatalogo, sha256Hex, type ConfigNovuchat } from '../../plataforma/funciones/servidor/http/novuchat.js';
import { ejecutarCotizaciones } from '../../plataforma/funciones/servidor/programadas/cotizacion.js';
import { REDONDEO_POR_DEFECTO, RedondeoInvalido } from '../../plataforma/funciones/servidor/redondeo.js';
import { ComercialInvalida } from '../../plataforma/coordinador/index.js';
import { AHORA, T, crearEscenario } from '../equivalencia/escenario.js';
import { firestoreDoble } from '../equivalencia/firestore-doble.js';

// El logger de `firebase-functions` toma `console.error` al cargarse: se intercepta antes de los imports (hoisted).
const registros = vi.hoisted(() => {
  const lista: string[] = [];
  console.error = (...a: unknown[]): void => { lista.push(a.map(String).join(' ')); };
  return lista;
});
beforeEach(() => { registros.length = 0; });

const TOKEN = 'token-ficticio-de-borde';
const regla = { tipo: 'decimales', decimales: 2, modo: 'cercano' } as const;
const mercado = (id: string, moneda: string, base: string, tc: { par: string; fuentes: string[] } | null) => ({
  id, nombre: id, monedaVenta: moneda, monedaBase: base, zonaHoraria: 'America/Bogota', tipoCambio: tc, redondeo: regla,
});
const validar = (x: unknown): ConfiguracionComercial => {
  const r = validarConfiguracionComercial(x);
  if (!r.ok) throw new Error(r.error);
  return r.valor;
};
/** Tenant con BO (como el de referencia) y además un tercer mercado CO sin tipo de cambio. */
const CON_CO = validar({
  mercados: [mercado('BO', 'BOB', 'USD', { par: 'BOB/USD', fuentes: ['BCB'] }), mercado('CO', 'COP', 'COP', null)],
  monedas: ['BOB', 'COP'],
});
const SOLO_CO = validar({ mercados: [mercado('CO', 'COP', 'COP', null)], monedas: ['COP'] });

async function catalogo(comercial: ConfiguracionComercial, consulta: Record<string, string>) {
  const e = await crearEscenario();
  e.db.poner(`${COLECCION_TOKENS}/${sha256Hex(TOKEN)}`, { tenantId: T, hash: sha256Hex(TOKEN), activo: true });
  const entorno = {
    firestore: firestoreDoble(e.db), db: e.db, almacenCotizaciones: e.almacen, ahora: () => AHORA,
    redondeo: () => Promise.resolve(REDONDEO_POR_DEFECTO), comercialDelTenant: () => Promise.resolve(comercial),
  } as unknown as Entorno;
  const cfg: ConfigNovuchat = { sitioUrl: 'https://tienda.ejemplo.invalid', mediosBaseUrl: 'https://medios.ejemplo.invalid/publico', limite: limiteMemoria(1000, 60_000), secretoPedidos: 's' };
  const r = await manejarCatalogo(entorno, {
    metodo: 'GET', ruta: '/c', url: '/c', consulta, cabeceras: { authorization: `Bearer ${TOKEN}` }, cuerpoCrudo: '', cuerpo: undefined, origen: '203.0.113.9',
  }, cfg, () => Promise.resolve(true));
  return { status: r.status, cuerpo: r.cuerpo };
}

describe('catálogo del asistente: mercado que no es del tenant', () => {
  it('un mercado ajeno responde exactamente lo mismo que uno inválido', async () => {
    const invalido = await catalogo(CON_CO, { mercado: 'EC' });
    expect(invalido.status).toBe(400);
    expect(await catalogo(SOLO_CO, { mercado: 'AR' })).toEqual(invalido); // AR no es de este tenant
    expect(await catalogo(SOLO_CO, { mercado: 'BO' })).toEqual(invalido);
  });

  it('hasta B2, un mercado del tenant que no es BO ni AR también responde como inválido (no publica el precio ar en otra moneda)', async () => {
    const invalido = await catalogo(CON_CO, { mercado: 'EC' });
    expect(await catalogo(CON_CO, { mercado: 'CO' })).toEqual(invalido);
    expect((await catalogo(CON_CO, { mercado: 'BO' })).status).toBe(200);
  });
});

describe('mapeo de errores de los callables', () => {
  it('ComercialInvalida: failed-precondition con código «comercial-invalida» y registro con alerta, sin datos del documento', () => {
    const r = comoHttpsError(new ComercialInvalida('invalido'), { modulo: 'pos', tenantId: 't' });
    expect(r.code).toBe('failed-precondition');
    expect(r.details).toMatchObject({ codigo: 'comercial-invalida' });
    const linea = registros.join('\n');
    expect(linea).toContain('callable rechazado');
    expect(linea).toMatch(/"alerta":"comercial"/);
    expect(linea).toMatch(/"motivo":"invalido"/);
  });

  it('RedondeoInvalido: failed-precondition con código «redondeo-invalido» y registro con alerta', () => {
    const r = comoHttpsError(new RedondeoInvalido(), { modulo: 'consola' });
    expect(r.code).toBe('failed-precondition');
    expect(r.details).toMatchObject({ codigo: 'redondeo-invalido' });
    expect(registros.join('\n')).toMatch(/"alerta":"redondeo"/);
  });
});

describe('cotización programada ante errores de lectura de la configuración', () => {
  const entornoCon = (leer: (t: string) => Promise<ConfiguracionComercial>): Entorno => {
    const ids = ['malo', 'otro'];
    const firestore = {
      collection: () => ({ listDocuments: () => Promise.resolve(ids.map((id) => ({ id }))) }),
      getAll: (...refs: { id?: string }[]) => Promise.resolve(refs.filter((r) => r.id !== undefined).map((r) => ({ id: r.id, exists: true, get: () => 'activo' }))),
    };
    return { firestore, ahora: () => AHORA, comercialDelTenant: leer, modulosDelTenant: () => Promise.resolve(undefined) } as unknown as Entorno;
  };

  it('una configuración inválida se salta con alerta y la corrida sigue sin fallar', async () => {
    const e = entornoCon(() => Promise.reject(new ComercialInvalida('invalido')));
    await expect(ejecutarCotizaciones(e)).resolves.toEqual([]);
    expect(registros.join('\n')).toMatch(/"tipo":"comercial_invalida"/);
  });

  it('cualquier otro error (fallo de lectura) no se traga: los demás tenants siguen y la corrida falla al final', async () => {
    const vistos: string[] = [];
    const e = entornoCon((t) => { vistos.push(t); return Promise.reject(new Error('UNAVAILABLE')); });
    await expect(ejecutarCotizaciones(e)).rejects.toThrow('UNAVAILABLE');
    expect(vistos).toEqual(['malo', 'otro']);
  });
});
