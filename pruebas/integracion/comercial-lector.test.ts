// Lector de la configuración comercial (coordinador) con un Firestore de documentos en memoria: sin emulador.
import { describe, expect, it } from 'vitest';
import { ComercialInvalida, crearLectorComercial, TTL_COMERCIAL_MS, TTL_COMERCIAL_NEGATIVO_MS, MAX_ENTRADAS_COMERCIAL, vistaComercial } from '../../plataforma/coordinador/index.js';

const docs = new Map<string, unknown>();
let lecturas = 0;
const firestore = { doc: (ruta: string) => ({ get: () => { lecturas += 1; return Promise.resolve({ exists: docs.has(ruta), data: () => docs.get(ruta) }); } }) };
let reloj = 1_000_000;

const UNO = {
  estado: 'activo', plan: 'base', modulos: {},
  comercial: { mercados: [{ id: 'CO', nombre: 'Colombia', monedaVenta: 'COP', monedaBase: 'COP', zonaHoraria: 'America/Bogota', tipoCambio: null, redondeo: { tipo: 'decimales', decimales: 0, modo: 'cercano' } }], monedas: ['COP'] },
};

describe('lector de la configuración comercial', () => {
  const leer = crearLectorComercial(firestore, () => reloj);

  it('entrega la configuración declarada y la cachea hasta el TTL', async () => {
    docs.set('tenants/uno', UNO);
    lecturas = 0;
    expect((await leer('uno')).monedas).toEqual(['COP']);
    await leer('uno');
    expect(lecturas).toBe(1);
    reloj += TTL_COMERCIAL_MS + 1;
    await leer('uno');
    expect(lecturas).toBe(2);
  });

  it('falla cerrado y cachea poco el error; invalidar fuerza la relectura', async () => {
    lecturas = 0;
    await expect(leer('ausente')).rejects.toMatchObject({ name: 'ComercialInvalida', motivo: 'inexistente' });
    await expect(leer('ausente')).rejects.toThrow(ComercialInvalida);
    expect(lecturas).toBe(1);
    docs.set('tenants/ausente', UNO);
    reloj += TTL_COMERCIAL_NEGATIVO_MS + 1;
    expect((await leer('ausente')).mercados).toHaveLength(1);
    docs.set('tenants/roto', { estado: 'activo', plan: 'base', modulos: {} });
    await expect(leer('roto')).rejects.toMatchObject({ motivo: 'invalido' });
    docs.set('tenants/roto', UNO);
    leer.invalidar('roto');
    expect((await leer('roto')).monedas).toEqual(['COP']);
    await expect(leer('Id/Malo')).rejects.toMatchObject({ motivo: 'invalido' });
  });

  it('el documento anterior (sin comercial) se deriva a los tres monedas; otra combinación falla', async () => {
    docs.set('tenants/viejo', { estado: 'activo', plan: 'base', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] });
    const c = await leer('viejo');
    expect(c.mercados.map((m) => m.id)).toEqual(['BO', 'AR']);
    expect(vistaComercial(c).monedasCaja).toEqual(['BOB', 'USD', 'ARS']);
    docs.set('tenants/viejo2', { estado: 'activo', plan: 'base', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB'] });
    await expect(leer('viejo2')).rejects.toThrow(ComercialInvalida);
  });

  it('la caché expulsa las entradas vencidas y no pasa del tope', async () => {
    const lector = crearLectorComercial(firestore, () => reloj);
    for (let i = 0; i < MAX_ENTRADAS_COMERCIAL + 50; i += 1) {
      docs.set(`tenants/t${String(i)}`, UNO);
      await lector(`t${String(i)}`);
    }
    lecturas = 0;
    await lector('t0'); // la más antigua fue descartada: se vuelve a leer
    expect(lecturas).toBe(1);
    await lector(`t${String(MAX_ENTRADAS_COMERCIAL + 49)}`); // la última sigue en caché
    expect(lecturas).toBe(1);
  });
});
