// (g) Contenido del sitio generado desde lo publicado: la misma función que la reconstrucción (`contenidoDesdePublicado`)
// aplicada a la respuesta de `/api/sitio/v1/publicado` del escenario fijo. Fija precios base por mercado, mercados
// ofrecidos (selector de país), redondeo inyectado, SEO con moneda (JSON-LD) y el convertidor de referencia.
// No cubre el HTML compilado por Astro: ver README.
import {
  contenidoDesdePublicado, contenidoEjemplo, convertir, formatearMonto, jsonLdOrganizacion, jsonLdProducto, monedaDe, validarNegocio, type EntornoSitio,
} from '@novutienda/website';
import { describe, expect, it } from 'vitest';
import { COTIZACION_AR, COTIZACION_BO, FECHA, REDONDEO, T, crearEscenario } from './escenario.js';
import { compararConFotoJson } from './foto.js';

const entorno: EntornoSitio = {
  origen: 'https://tienda.ejemplo.invalid', origenMedios: 'https://medios.ejemplo.invalid', baseMedios: 'https://medios.ejemplo.invalid/publico',
  appCheck: null, recaptchaSiteKey: null,
  disponibilidad: { 'p-lapiz': true, 'p-celular': true, 'p-cable': true, 'p-adaptador': true, 'p-parlante': true, 'p-agotado': false, 'p-servicio': true },
};

const negocio = () => {
  const c = contenidoEjemplo;
  return {
    nombre: 'Tienda de Ejemplo', lema: 'Lema de ejemplo', logo: null, whatsappTienda: null, telefono: null, correo: null,
    direccion: 'Calle Ficticia 123', horario: null, mercados: ['BO', 'AR'], mercadoInicial: 'BO', enlacesPermitidos: ['ejemplo.invalid'],
    portada: c.portada, beneficios: c.beneficios, identidad: { ...c.identidad, foto: null }, textoPrivacidad: ['Texto de privacidad de ejemplo.'],
    categorias: {}, destacados: [],
  };
};

describe('contenido del sitio de Casa Bermejo', () => {
  it('contenido desde lo publicado: precios base por mercado, mercados, redondeo y SEO con moneda', async () => {
    const e = await crearEscenario();
    const documentos: Record<string, unknown> = {
      sitio: { plantillaActiva: 'bosque', whatsappNovuchat: '59170000000', medicion: {}, version: 3 },
      estado: { version: 3, secciones: [] },
    };
    for (const d of e.db.coleccion(`tenants/${T}/publicado`)) documentos[d.id] = d.datos;
    const respuesta = { documentos, redondeo: REDONDEO };
    const negocioValidado = validarNegocio(negocio());
    expect(negocioValidado.ok, JSON.stringify(negocioValidado)).toBe(true);
    const contenido = contenidoDesdePublicado(respuesta, negocio(), entorno);
    expect(contenido.config.mercados).toEqual(['BO', 'AR']);
    compararConFotoJson('sitio-contenido.json', contenido);
    compararConFotoJson('sitio-seo.json', {
      organizacion: jsonLdOrganizacion(contenido),
      productos: contenido.productos.map((p) => jsonLdProducto(p, contenido)),
    });
  });

  it('selector de país y convertidor de referencia (BOB, USD, ARS)', () => {
    const cot = {
      BO: { cotizacionId: 'BO-x', par: 'BOB/USD', valor: COTIZACION_BO, fecha: FECHA, fuente: 'manual', estado: 'vigente' },
      AR: { cotizacionId: 'AR-x', par: 'ARS/USD', valor: COTIZACION_AR, fecha: FECHA, fuente: 'manual', estado: 'vigente' },
    } as const;
    compararConFotoJson('sitio-selector-y-convertidor.json', {
      monedaPorMercado: { BO: monedaDe('BO'), AR: monedaDe('AR') },
      conversiones: {
        desdeUSD: convertir('USD', 10, cot), desdeBOB: convertir('BOB', 100, cot), desdeARS: convertir('ARS', 20000, cot),
        sinAR: convertir('USD', 10, { BO: cot.BO }), sinBO_desdeBOB: convertir('BOB', 100, { AR: cot.AR }),
      },
      formatos: [[0, 'BOB'], [871, 'BOB'], [139293, 'BOB'], [1230000, 'ARS'], [708, 'USD'], [100000000, 'ARS']].map(([c, m]) => [c, m, formatearMonto(c as number, m as 'BOB' | 'ARS' | 'USD')]),
    });
  });
});
