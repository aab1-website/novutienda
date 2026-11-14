// Contrato con NovuChat ante un `config/redondeo` con una regla que D7 (13/11/2026) dejó de admitir: `ninguno`, `decimales: 3` y el
// caso de un precio menor a un centavo. Comportamiento nuevo y deliberado: el conector del catálogo falla cerrado: lanza
// `RedondeoInvalido` y no entrega respuesta ni precios; el manejador `api` (index.ts) lo convierte en 500 `{"error":"interno"}`.
// Antes estas referencias recogían precios con esas reglas.
// El doble de `redondeo` interpreta la configuración recién al pedirlo, dentro del conector real, para ejercer su camino de error.
import { interpretarRedondeo } from '../../plataforma/funciones/servidor/redondeo.js';
import { describe, expect, it } from 'vitest';
import { limiteMemoria } from '@novutienda/nucleo';
import type { Entorno as EntornoServidor } from '../../plataforma/funciones/servidor/entorno.js';
import { COLECCION_TOKENS, manejarCatalogo, sha256Hex, type ConfigNovuchat } from '../../plataforma/funciones/servidor/http/novuchat.js';
import type { PeticionHttp } from '../../plataforma/funciones/servidor/http/tipos.js';
import { AHORA, T, crearEscenario } from './escenario.js';
import { firestoreDoble } from './firestore-doble.js';
import { compararConFotoJson } from './foto.js';
import { comercialLegado } from '@novutienda/nucleo';

const TOKEN = 'token-ficticio-de-equivalencia';

async function preparar(configRedondeo: Record<string, unknown>, cotizacionBo?: number) {
  const e = await crearEscenario();
  e.db.poner(`${COLECCION_TOKENS}/${sha256Hex(TOKEN)}`, { tenantId: T, hash: sha256Hex(TOKEN), activo: true });
  e.db.poner(`tenants/${T}/config/redondeo`, configRedondeo);
  if (cotizacionBo !== undefined) {
    const ruta = `tenants/${T}/cotizaciones/BO`;
    e.db.poner(ruta, { ...(e.db.docs.get(ruta)?.datos), valor: cotizacionBo });
  }
  const redondeo = (): Promise<ReturnType<typeof interpretarRedondeo>> => Promise.resolve().then(() => interpretarRedondeo(configRedondeo));
  const derivada = comercialLegado({ zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] });
  if (!derivada.ok) throw new Error(derivada.error);
  const entorno = {
    firestore: firestoreDoble(e.db), db: e.db, almacenCotizaciones: e.almacen, ahora: () => AHORA,
    redondeo, redondeoDelTenant: redondeo, comercialDelTenant: () => Promise.resolve(derivada.valor),
  } as unknown as EntornoServidor;
  const cfg: ConfigNovuchat = {
    sitioUrl: 'https://tienda.ejemplo.invalid', mediosBaseUrl: 'https://medios.ejemplo.invalid/publico', limite: limiteMemoria(1000, 60_000), secretoPedidos: 'secreto-ficticio-de-pedidos',
  };
  return { entorno, cfg };
}

const peticion = (mercado: string): PeticionHttp => ({
  metodo: 'GET', ruta: '/api/novuchat/v1/catalogo', url: '/api/novuchat/v1/catalogo', consulta: { mercado }, cabeceras: { authorization: `Bearer ${TOKEN}` }, cuerpoCrudo: '', cuerpo: undefined, origen: '203.0.113.9',
});

async function catalogos(configRedondeo: Record<string, unknown>, cotizacionBo?: number) {
  const { entorno, cfg } = await preparar(configRedondeo, cotizacionBo);
  const salida: Record<string, unknown> = {};
  for (const m of ['BO', 'AR']) {
    // Falla cerrado: sin respuesta, solo el error tipado. El 500 «interno» lo pone `api` (index.ts), fuera de este conector.
    salida[m] = await manejarCatalogo(entorno, peticion(m), cfg, () => Promise.resolve(true)).then(
      (r) => ({ status: r.status, headers: r.headers, cuerpo: r.cuerpo }),
      (error: unknown) => ({ falla: error instanceof Error ? error.name : String(error) }),
    );
  }
  return salida;
}

const NINGUNO = { BOB: { tipo: 'ninguno' }, ARS: { tipo: 'ninguno' } };
const DECIMALES_3 = { tipo: 'decimales', decimales: 3, modo: 'cercano' };

describe('NovuChat: el catálogo falla cerrado con una regla de redondeo prohibida (D7)', () => {
  it('config/redondeo en «ninguno» para BOB y ARS', async () => {
    compararConFotoJson('novuchat-catalogo-redondeo-ninguno.json', await catalogos(NINGUNO));
  });

  it('config/redondeo en «decimales: 3» para BOB y ARS', async () => {
    compararConFotoJson('novuchat-catalogo-redondeo-decimales3.json', await catalogos({ BOB: DECIMALES_3, ARS: DECIMALES_3 }));
  });

  it('precio menor a un centavo: con «ninguno» y con «decimales: 3» tampoco hay precios', async () => {
    compararConFotoJson('novuchat-catalogo-redondeo-subcentavo.json', {
      ninguno: await catalogos(NINGUNO, 0.003),
      decimales3: await catalogos({ BOB: DECIMALES_3, ARS: { tipo: 'ninguno' } }, 0.003),
    });
  });

  it('el fallo es RedondeoInvalido y no trae precios', async () => {
    const r = await catalogos(NINGUNO) as Record<string, unknown>;
    expect(r).toEqual({ BO: { falla: 'RedondeoInvalido' }, AR: { falla: 'RedondeoInvalido' } });
  });
});
