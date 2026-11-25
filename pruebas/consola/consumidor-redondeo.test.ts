import { beforeEach, describe, expect, it } from 'vitest';
import { consumirRedondeoCambiado, ejecutorConsola, guardarConfigSitio, publicarSitio, type DepsConsumidorRedondeo } from '@novutienda/consola';
import { ErrorEvento, fixturesRedondeoCambiadoV1, TIPO_REDONDEO_CAMBIADO_V1, type SobreEvento } from '@novutienda/nucleo';
import { actor, CatalogoDoble, nuevaDb, RelojFijo, T } from './dobles.js';

const PUB = `tenants/${T}/publicado`;
const ev = (id: string, datos: unknown = fixturesRedondeoCambiadoV1.validos[0]): SobreEvento => ({
  id, tipo: TIPO_REDONDEO_CAMBIADO_V1, version: 1, tenantId: T, origen: 'central',
  ocurridoEn: '2026-11-26T10:00:00.000Z', claveIdempotencia: `k-${id}`, datos,
});

describe('consumirRedondeoCambiado', () => {
  let db: ReturnType<typeof nuevaDb>;
  let reloj: RelojFijo;
  let programadas: number[];
  let deps: DepsConsumidorRedondeo;
  const estado = (): Record<string, unknown> => db.dato(`${PUB}/estado`) as Record<string, unknown>;

  beforeEach(() => {
    db = nuevaDb();
    reloj = new RelojFijo(Date.UTC(2026, 10, 26, 12, 0, 0));
    programadas = [];
    deps = { reloj, disparador: { programar: (_t, para) => { programadas.push(para); return Promise.resolve(); }, reconstruir: () => Promise.resolve() } };
  });

  it('sin nada publicado no hace nada', async () => {
    expect(await consumirRedondeoCambiado(ejecutorConsola(db), ev('r0'), deps)).toBe(true);
    expect(db.dato(`${PUB}/estado`)).toBeUndefined();
    expect(programadas).toEqual([]);
  });

  it('un evento inválido se rechaza', async () => {
    await expect(consumirRedondeoCambiado(ejecutorConsola(db), ev('r9', { monedas: [] }), deps)).rejects.toBeInstanceOf(ErrorEvento);
  });

  describe('con el sitio publicado', () => {
    beforeEach(async () => {
      const catalogo = new CatalogoDoble(db);
      catalogo.agregar('p1');
      db.poner(`tenants/${T}/fichasWeb/p1`, { productoId: 'p1', slug: 's-p1', descripcion: 'D', garantia: '', estado: 'publicado', medios: [{ medioId: 'medio-0001', alt: 'f' }], seo: { titulo: '', descripcion: '' } });
      db.poner(`tenants/${T}/medios/medio-0001`, { tipo: 'foto', ancho: 100, alto: 100, versiones: [{ clase: 'imagen', lado: 100, formato: 'webp', ruta: 'x/1.webp' }] });
      const d = { db, catalogo, reloj, disparador: { programar: () => Promise.resolve(), reconstruir: () => Promise.resolve() } };
      await guardarConfigSitio(d, { tenantId: T, actor: actor('adm'), config: { plantillaActiva: 'ambar', whatsappNovuchat: '59100000000', medicion: {} } });
      await publicarSitio(d, { tenantId: T, actor: actor('adm') });
      db.poner(`${PUB}/estado`, { ...estado(), reconstruccion: { programadaPara: null, ultima: 1 } });
      reloj.ms += 60_000;
    });

    it('sube la versión de estado y sitio, guarda redondeoVivoEn, deja publicadoEn y agenda la construcción', async () => {
      const antes = estado();
      expect(await consumirRedondeoCambiado(ejecutorConsola(db), ev('r1'), deps)).toBe(true);
      expect(estado()['version']).toBe((antes['version'] as number) + 1);
      expect(db.dato(`${PUB}/sitio`)?.['version']).toBe(estado()['version']);
      expect(estado()['redondeoVivoEn']).toBe(new Date(reloj.ms).toISOString());
      expect(estado()['publicadoEn']).toBe(antes['publicadoEn']);
      expect(programadas).toHaveLength(1);
    });

    it('el mismo evento, o su clave, no vuelve a avanzar ni a agendar', async () => {
      await consumirRedondeoCambiado(ejecutorConsola(db), ev('r2'), deps);
      const v = estado()['version'];
      expect(await consumirRedondeoCambiado(ejecutorConsola(db), ev('r2'), deps)).toBe(false);
      expect(await consumirRedondeoCambiado(ejecutorConsola(db), { ...ev('r2b'), claveIdempotencia: 'k-r2' }, deps)).toBe(false);
      expect(estado()['version']).toBe(v);
      expect(programadas).toHaveLength(1);
    });

    it('dos eventos distintos en la ventana suben dos versiones y agendan una sola vez', async () => {
      const antes = estado()['version'] as number;
      await consumirRedondeoCambiado(ejecutorConsola(db), ev('r3'), deps);
      await consumirRedondeoCambiado(ejecutorConsola(db), ev('r4'), deps);
      expect(estado()['version']).toBe(antes + 2);
      expect(programadas).toHaveLength(1);
    });
  });
});
