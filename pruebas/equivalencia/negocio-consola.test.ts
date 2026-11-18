// (g) bis: el negocio del sitio leído del documento de la consola (`documentos.negocio`) da EXACTAMENTE el mismo contenido que
// el respaldo. No altera el escenario compartido: toma la respuesta publicada del escenario, le agrega en memoria un
// `documentos.negocio` con los mismos datos del negocio de referencia (forma `NegocioPublicado`: sin mercados, logo ni WhatsApp,
// con versión y fecha) y compara con la referencia `sitio-contenido.json`. Garantiza que migrar del respaldo a la consola no cambia el sitio.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contenidoDesdePublicado, contenidoEjemplo, contenidoYFuenteDesdePublicado, type EntornoSitio } from '@novutienda/website';
import { describe, expect, it } from 'vitest';
import { REDONDEO, T, crearEscenario } from './escenario.js';
import { CARPETA_REFERENCIAS, serializar } from './foto.js';

const entorno: EntornoSitio = {
  origen: 'https://tienda.ejemplo.invalid', origenMedios: 'https://medios.ejemplo.invalid', baseMedios: 'https://medios.ejemplo.invalid/publico',
  appCheck: null, recaptchaSiteKey: null,
  disponibilidad: { 'p-lapiz': true, 'p-celular': true, 'p-cable': true, 'p-adaptador': true, 'p-parlante': true, 'p-agotado': false, 'p-servicio': true },
};

// Mismos datos que `negocio()` de contenido-sitio.test.ts (respaldo de referencia).
const respaldo = () => {
  const c = contenidoEjemplo;
  return {
    nombre: 'Tienda de Ejemplo', lema: 'Lema de ejemplo', logo: null, whatsappTienda: null, telefono: null, correo: null,
    direccion: 'Calle Ficticia 123', horario: null, mercados: ['BO', 'AR'], mercadoInicial: 'BO', enlacesPermitidos: ['ejemplo.invalid'],
    portada: c.portada, beneficios: c.beneficios, identidad: { ...c.identidad, foto: null }, textoPrivacidad: ['Texto de privacidad de ejemplo.'],
    categorias: {}, destacados: [],
  };
};

/** Documento como lo publica la consola: los datos del respaldo sin lo que sigue viniendo del secreto, más versión y fecha. */
const documentoConsola = (): Record<string, unknown> => {
  const resto: Record<string, unknown> = { ...respaldo() };
  for (const k of ['mercados', 'mercadoInicial', 'logo', 'whatsappTienda']) delete resto[k];
  return { ...resto, version: 1, actualizadoEn: '2026-11-04T00:00:00.000Z' };
};

describe('negocio del sitio desde la consola: equivalencia con el respaldo', () => {
  it('con documentos.negocio de los mismos datos, el contenido es idéntico a la referencia sitio-contenido.json', async () => {
    const e = await crearEscenario();
    const documentos: Record<string, unknown> = {
      sitio: { plantillaActiva: 'bosque', whatsappNovuchat: '59170000000', medicion: {}, version: 3 },
      estado: { version: 3, secciones: [] },
    };
    for (const d of e.db.coleccion(`tenants/${T}/publicado`).filter((x) => x.id !== 'estado')) documentos[d.id] = d.datos;
    const sin = { documentos, redondeo: REDONDEO };
    const con = { documentos: { ...documentos, negocio: documentoConsola() }, redondeo: REDONDEO };
    expect(contenidoYFuenteDesdePublicado(sin, respaldo(), entorno).fuenteNegocio).toBe('respaldo');
    expect(contenidoYFuenteDesdePublicado(con, respaldo(), entorno).fuenteNegocio).toBe('consola');
    const advertencias: string[] = [];
    const desdeConsola = contenidoDesdePublicado(con, respaldo(), entorno, advertencias);
    expect(advertencias).toEqual([]);
    expect(desdeConsola).toEqual(contenidoDesdePublicado(sin, respaldo(), entorno));
    expect(serializar(desdeConsola)).toBe(readFileSync(join(CARPETA_REFERENCIAS, 'sitio-contenido.json'), 'utf8'));
  });
});
