// El asistente (catálogo e inventario) lee los precios por los mercados que declara el comercio, no por dos claves fijas: un
// producto al que le falta el precio de un mercado se omite en él y no tumba la respuesta; sin regla de redondeo para la
// moneda se omite; sin configuración comercial válida el inventario falla cerrado. Todo con datos ficticios.
import { comercialLegado, limiteMemoria, validarConfiguracionComercial, type ConfiguracionComercial } from '@novutienda/nucleo';
import { describe, expect, it } from 'vitest';
import { ComercialInvalida } from '../../plataforma/coordinador/index.js';
import type { Entorno } from '../../plataforma/funciones/servidor/entorno.js';
import { COLECCION_TOKENS, manejarCatalogo, manejarInventario, sha256Hex, type ConfigNovuchat } from '../../plataforma/funciones/servidor/http/novuchat.js';
import type { PeticionHttp } from '../../plataforma/funciones/servidor/http/tipos.js';
import { AHORA, REDONDEO, T, crearEscenario } from '../equivalencia/escenario.js';
import { firestoreDoble } from '../equivalencia/firestore-doble.js';

const TOKEN = 'token-ficticio-mercados-declarados';
const derivada = comercialLegado({ zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] });
if (!derivada.ok) throw new Error(derivada.error);
const COMERCIAL: ConfiguracionComercial = derivada.valor;
const ID = 'p-solo-bo';
const SOLO_BO = ((): ConfiguracionComercial => {
  const r = validarConfiguracionComercial({
    mercados: [{ id: 'BO', nombre: 'BO', monedaVenta: 'BOB', monedaBase: 'USD', zonaHoraria: 'America/La_Paz', tipoCambio: { par: 'BOB/USD', fuentes: ['BCB'] }, redondeo: { tipo: 'decimales', decimales: 2, modo: 'cercano' } }],
    monedas: ['BOB', 'USD'],
  });
  if (!r.ok) throw new Error(r.error);
  return r.valor;
})();

async function preparar(opciones: { redondeo?: unknown; comercial?: () => Promise<ConfiguracionComercial> } = {}) {
  const e = await crearEscenario();
  e.db.poner(`${COLECCION_TOKENS}/${sha256Hex(TOKEN)}`, { tenantId: T, hash: sha256Hex(TOKEN), activo: true });
  // Producto activo y publicado al que le falta la clave de precio `ar` (solo tiene `bo`).
  const lapiz = e.db.dato(`tenants/${T}/productos/p-lapiz`)!;
  e.db.poner(`tenants/${T}/productos/${ID}`, { ...lapiz, nombre: 'Solo Bolivia', precioUSD: { bo: 500 } });
  e.db.poner(`tenants/${T}/publicado/producto__${ID}`, { ...e.db.dato(`tenants/${T}/publicado/producto__p-lapiz`)!, id: ID, slug: 'solo-bolivia', nombre: 'Solo Bolivia' });
  const estado = e.db.dato(`tenants/${T}/publicado/estado`)!;
  e.db.poner(`tenants/${T}/publicado/estado`, { ...estado, productos: [...(estado['productos'] as string[]), ID].sort() });
  const entorno = {
    firestore: firestoreDoble(e.db), db: e.db, almacenCotizaciones: e.almacen, ahora: () => AHORA,
    redondeoDelTenant: () => Promise.resolve(opciones.redondeo ?? REDONDEO), comercialDelTenant: opciones.comercial ?? (() => Promise.resolve(COMERCIAL)),
  } as unknown as Entorno;
  const cfg: ConfigNovuchat = { sitioUrl: 'https://tienda.ejemplo.invalid', mediosBaseUrl: 'https://medios.ejemplo.invalid/publico', limite: limiteMemoria(1000, 60_000), secretoPedidos: 's' };
  return { entorno, cfg };
}

const peticion = (ruta: string, consulta: Record<string, string> = {}): PeticionHttp => ({
  metodo: 'GET', ruta, url: ruta, consulta, cabeceras: { authorization: `Bearer ${TOKEN}` }, cuerpoCrudo: '', cuerpo: undefined, origen: '203.0.113.9',
});
const sirve = (): Promise<boolean> => Promise.resolve(true);
const ids = (cuerpo: unknown): string[] => ((cuerpo as { items: { id: string }[] }).items).map((i) => i.id);

describe('NovuChat: mercados declarados', () => {
  it('un producto sin la clave `ar` sale en el catálogo BO, se omite en el AR y aparece en el inventario', async () => {
    const { entorno, cfg } = await preparar();
    const bo = await manejarCatalogo(entorno, peticion('/c', { mercado: 'BO' }), cfg, sirve);
    const ar = await manejarCatalogo(entorno, peticion('/c', { mercado: 'AR' }), cfg, sirve);
    const inv = await manejarInventario(entorno, peticion('/i'), cfg, sirve);
    expect([bo.status, ar.status, inv.status]).toEqual([200, 200, 200]);
    expect(ids(bo.cuerpo)).toContain(ID);
    expect(ids(ar.cuerpo)).not.toContain(ID);
    expect(ids(inv.cuerpo)).toContain(ID);
  });

  it('sin regla de redondeo para la moneda del mercado, los productos se omiten en él', async () => {
    const { entorno, cfg } = await preparar({ redondeo: { BOB: REDONDEO.BOB } });
    const bo = await manejarCatalogo(entorno, peticion('/c', { mercado: 'BO' }), cfg, sirve);
    const ar = await manejarCatalogo(entorno, peticion('/c', { mercado: 'AR' }), cfg, sirve);
    expect(ids(bo.cuerpo)).toContain(ID);
    expect(ids(ar.cuerpo)).toEqual([]);
  });

  it('sin regla para BOB el producto solo-BO se omite en el catálogo BO', async () => {
    const { entorno, cfg } = await preparar({ redondeo: { ARS: REDONDEO.ARS } });
    const bo = await manejarCatalogo(entorno, peticion('/c', { mercado: 'BO' }), cfg, sirve);
    expect(ids(bo.cuerpo)).not.toContain(ID);
  });

  it('comercio sin declaración comercial: el inventario falla cerrado con ComercialInvalida, sin salida', async () => {
    const { entorno, cfg } = await preparar({ comercial: () => Promise.reject(new ComercialInvalida('inexistente')) });
    await expect(manejarInventario(entorno, peticion('/i'), cfg, sirve)).rejects.toBeInstanceOf(ComercialInvalida);
  });

  it('un comercio que declara solo BO responde 400 mercado_invalido a mercado=AR', async () => {
    const { entorno, cfg } = await preparar({ comercial: () => Promise.resolve(SOLO_BO) });
    const r = await manejarCatalogo(entorno, peticion('/c', { mercado: 'AR' }), cfg, sirve);
    expect(r.status).toBe(400);
    expect(r.cuerpo).toEqual({ error: 'mercado_invalido' });
  });

  it('mercado=bo en minúscula responde 400', async () => {
    const { entorno, cfg } = await preparar();
    expect((await manejarCatalogo(entorno, peticion('/c', { mercado: 'bo' }), cfg, sirve)).status).toBe(400);
  });

  it('un comercio de la forma anterior (derivado de sus tres monedas) sigue respondiendo el inventario', async () => {
    const { entorno, cfg } = await preparar(); // COMERCIAL es la derivación de las tres monedas
    const r = await manejarInventario(entorno, peticion('/i'), cfg, sirve);
    expect(r.status).toBe(200);
  });
});
