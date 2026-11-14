// (a, ampliación) Contrato con NovuChat con una política de redondeo DISTINTA de la de por defecto: `config/redondeo` del tenant
// de referencia en `ninguno`, en `decimales: 3` y con un precio menor a un centavo. Son reglas que el servidor admite hoy y que la
// batería original no ejercía (usaba solo el redondeo por defecto). Estas referencias se generaron con el código de `main`
// previo a la migración de mercados por tenant: esta rama debe reproducirlas byte a byte.
import { interpretarRedondeo } from '../../plataforma/funciones/servidor/redondeo.js';
import { describe, it } from 'vitest';
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
  const redondeo = interpretarRedondeo(configRedondeo);
  const derivada = comercialLegado({ zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] });
  if (!derivada.ok) throw new Error(derivada.error);
  const entorno = {
    firestore: firestoreDoble(e.db), db: e.db, almacenCotizaciones: e.almacen, ahora: () => AHORA,
    redondeo: () => Promise.resolve(redondeo), redondeoDelTenant: () => Promise.resolve(redondeo), comercialDelTenant: () => Promise.resolve(derivada.valor),
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
    const r = await manejarCatalogo(entorno, peticion(m), cfg, () => Promise.resolve(true));
    salida[m] = { status: r.status, headers: r.headers, cuerpo: r.cuerpo };
  }
  return salida;
}

describe('NovuChat: catálogo con políticas de redondeo distintas de la de por defecto', () => {
  it('config/redondeo en «ninguno» para BOB y ARS', async () => {
    compararConFotoJson('novuchat-catalogo-redondeo-ninguno.json', await catalogos({ BOB: { tipo: 'ninguno' }, ARS: { tipo: 'ninguno' } }));
  });

  it('config/redondeo en «decimales: 3» para BOB y ARS', async () => {
    compararConFotoJson('novuchat-catalogo-redondeo-decimales3.json', await catalogos({ BOB: { tipo: 'decimales', decimales: 3, modo: 'cercano' }, ARS: { tipo: 'decimales', decimales: 3, modo: 'cercano' } }));
  });

  it('precio menor a un centavo: cotización BO de 0,003 con redondeo «ninguno» y con «decimales: 3»', async () => {
    compararConFotoJson('novuchat-catalogo-redondeo-subcentavo.json', {
      ninguno: await catalogos({ BOB: { tipo: 'ninguno' }, ARS: { tipo: 'ninguno' } }, 0.003),
      decimales3: await catalogos({ BOB: { tipo: 'decimales', decimales: 3, modo: 'cercano' }, ARS: { tipo: 'ninguno' } }, 0.003),
    });
  });
});
