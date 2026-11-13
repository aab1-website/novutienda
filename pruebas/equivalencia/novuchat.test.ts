// (a) Contrato con NovuChat: catálogo por mercado BO y AR, inventario y pedido firmado, con los manejadores reales
// (`http/novuchat.ts`) sobre un Firestore de lectura doble. Reloj e ids fijos: sin emulador.
import { calcularFirma } from '@novutienda/nucleo/servidor';
import { limiteMemoria } from '@novutienda/nucleo';
import { describe, expect, it } from 'vitest';
import type { Entorno as EntornoServidor } from '../../plataforma/funciones/servidor/entorno.js';
import { COLECCION_TOKENS, manejarCatalogo, manejarInventario, manejarPedido, sha256Hex, type ConfigNovuchat } from '../../plataforma/funciones/servidor/http/novuchat.js';
import type { PeticionHttp } from '../../plataforma/funciones/servidor/http/tipos.js';
import { AHORA, REDONDEO, T, crearEscenario } from './escenario.js';
import { firestoreDoble } from './firestore-doble.js';
import { compararConFotoJson } from './foto.js';

const TOKEN = 'token-ficticio-de-equivalencia';
const SECRETO = 'secreto-ficticio-de-pedidos';

async function preparar() {
  const e = await crearEscenario();
  e.db.poner(`${COLECCION_TOKENS}/${sha256Hex(TOKEN)}`, { tenantId: T, hash: sha256Hex(TOKEN), activo: true });
  const entorno = {
    firestore: firestoreDoble(e.db), db: e.db, almacenCotizaciones: e.almacen, ahora: () => AHORA, redondeo: () => Promise.resolve(REDONDEO),
  } as unknown as EntornoServidor;
  const cfg: ConfigNovuchat = {
    sitioUrl: 'https://tienda.ejemplo.invalid', mediosBaseUrl: 'https://medios.ejemplo.invalid/publico', limite: limiteMemoria(1000, 60_000), secretoPedidos: SECRETO,
  };
  return { e, entorno, cfg };
}

const peticion = (ruta: string, consulta: Record<string, string> = {}, extra: Partial<PeticionHttp> = {}): PeticionHttp => ({
  metodo: 'GET', ruta, url: ruta, consulta, cabeceras: { authorization: `Bearer ${TOKEN}` }, cuerpoCrudo: '', cuerpo: undefined, origen: '203.0.113.9', ...extra,
});
const sirve = (): Promise<boolean> => Promise.resolve(true);

/** `generadoEn` viene del reloj inyectado (fijo); se deja tal cual: el reloj no es real. */
describe('NovuChat: contrato actual del tenant de referencia', () => {
  it('catálogo del mercado BO (bolivianos)', async () => {
    const { entorno, cfg } = await preparar();
    const r = await manejarCatalogo(entorno, peticion('/api/novuchat/v1/catalogo', { mercado: 'BO' }), cfg, sirve);
    expect(r.status).toBe(200);
    compararConFotoJson('novuchat-catalogo-BO.json', { status: r.status, headers: r.headers, cuerpo: r.cuerpo });
  });

  it('catálogo del mercado AR (pesos argentinos)', async () => {
    const { entorno, cfg } = await preparar();
    const r = await manejarCatalogo(entorno, peticion('/api/novuchat/v1/catalogo', { mercado: 'AR' }), cfg, sirve);
    expect(r.status).toBe(200);
    compararConFotoJson('novuchat-catalogo-AR.json', { status: r.status, headers: r.headers, cuerpo: r.cuerpo });
  });

  it('catálogo: mercado inválido, método y credenciales, y 304 con If-None-Match', async () => {
    const { entorno, cfg } = await preparar();
    const ok = await manejarCatalogo(entorno, peticion('/api/novuchat/v1/catalogo', { mercado: 'BO' }), cfg, sirve);
    const etag = ok.headers['ETag'] ?? '';
    const casos = {
      mercadoInvalido: await manejarCatalogo(entorno, peticion('/api/novuchat/v1/catalogo', { mercado: 'EC' }), cfg, sirve),
      sinMercado: await manejarCatalogo(entorno, peticion('/api/novuchat/v1/catalogo'), cfg, sirve),
      metodo: await manejarCatalogo(entorno, peticion('/api/novuchat/v1/catalogo', { mercado: 'BO' }, { metodo: 'POST' }), cfg, sirve),
      sinCredencial: await manejarCatalogo(entorno, peticion('/api/novuchat/v1/catalogo', { mercado: 'BO' }, { cabeceras: {} }), cfg, sirve),
      credencialMala: await manejarCatalogo(entorno, peticion('/api/novuchat/v1/catalogo', { mercado: 'BO' }, { cabeceras: { authorization: 'Bearer otro' } }), cfg, sirve),
      moduloApagado: await manejarCatalogo(entorno, peticion('/api/novuchat/v1/catalogo', { mercado: 'BO' }), cfg, () => Promise.resolve(false)),
      noModificado: await manejarCatalogo(entorno, peticion('/api/novuchat/v1/catalogo', { mercado: 'BO' }, { cabeceras: { authorization: `Bearer ${TOKEN}`, 'if-none-match': etag } }), cfg, sirve),
    };
    expect(casos.noModificado.status).toBe(304);
    compararConFotoJson('novuchat-catalogo-errores.json', casos);
  });

  it('catálogo sin cotización utilizable responde 503 sin_cotizacion', async () => {
    const { e, entorno, cfg } = await preparar();
    e.db.docs.delete(`tenants/${T}/cotizaciones/AR`);
    const r = await manejarCatalogo(entorno, peticion('/api/novuchat/v1/catalogo', { mercado: 'AR' }), cfg, sirve);
    compararConFotoJson('novuchat-catalogo-sin-cotizacion.json', { status: r.status, headers: r.headers, cuerpo: r.cuerpo });
  });

  it('inventario con existencias por almacén', async () => {
    const { entorno, cfg } = await preparar();
    const r = await manejarInventario(entorno, peticion('/api/novuchat/v1/inventario'), cfg, sirve);
    expect(r.status).toBe(200);
    compararConFotoJson('novuchat-inventario.json', { status: r.status, headers: r.headers, cuerpo: r.cuerpo });
  });

  it('pedido firmado: confirma, repite sin duplicar y rechaza stock insuficiente', async () => {
    const { e, entorno, cfg } = await preparar();
    const pedido = async (pedidoId: string, items: { productoId: string; cantidad: number }[]) => {
      const cuerpo = JSON.stringify({ pedidoId, items, confirmadoEn: '2026-11-04T14:59:00Z' });
      const marca = String(AHORA);
      const r = await manejarPedido(entorno, peticion('/api/novuchat/v1/pedidos/confirmar', {}, {
        metodo: 'POST', cuerpoCrudo: cuerpo, cabeceras: { 'x-marca-tiempo': marca, 'x-firma': calcularFirma(SECRETO, marca, cuerpo) },
      }), cfg, T, sirve);
      return { status: r.status, cuerpo: r.cuerpo };
    };
    const resultados = {
      confirma: await pedido('pd-1', [{ productoId: 'p-lapiz', cantidad: 3 }, { productoId: 'p-celular', cantidad: 1 }]),
      repite: await pedido('pd-1', [{ productoId: 'p-celular', cantidad: 1 }, { productoId: 'p-lapiz', cantidad: 3 }]),
      sinStock: await pedido('pd-2', [{ productoId: 'p-lapiz', cantidad: 12 }]),
    };
    const existencias = Object.fromEntries(e.db.coleccion(`tenants/${T}/existencias`).map((d) => [d.id, d.datos['cantidad']]));
    compararConFotoJson('novuchat-pedido.json', { resultados, existencias });
  });
});
