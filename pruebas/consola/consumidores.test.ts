import { beforeEach, describe, expect, it } from 'vitest';
import {
  consumirProductoCambiado, crearProductoConsola, ejecutorConsola, editarProductoConsola, guardarConfigSitio, publicarSitio,
} from '@novutienda/consola';
import { ErrorEvento, type SobreEvento } from '@novutienda/nucleo';
import { actor, CatalogoDoble, nuevaDb, RelojFijo, T } from './dobles.js';

let n = 0;
const en = (iso: string): SobreEvento => ({ ...evento(`ev-${String(++n)}`), ocurridoEn: iso });

const ESTADO = `tenants/${T}/sitio/estado`;
const evento = (id: string, datos: unknown = { productoId: 'p1', cambio: 'creado' }): SobreEvento => ({
  id, tipo: 'producto.cambiado', version: 1, tenantId: T, origen: 'inventarios',
  ocurridoEn: '2026-11-12T10:00:00.000Z', claveIdempotencia: `k-${id}`, datos,
});

describe('consumirProductoCambiado', () => {
  let db: ReturnType<typeof nuevaDb>;
  beforeEach(() => {
    db = nuevaDb();
  });

  it('el evento incrementa el contador una vez', async () => {
    expect(await consumirProductoCambiado(ejecutorConsola(db), evento('e1'))).toBe(true);
    expect(db.dato(ESTADO)).toEqual({ cambios: 1, ultimoCambioEn: '2026-11-12T10:00:00.000Z' });
    expect(await consumirProductoCambiado(ejecutorConsola(db), evento('e2', { productoId: 'p1', cambio: 'precio' }))).toBe(true);
    expect(db.dato(ESTADO)?.['cambios']).toBe(2);
  });

  it('la reentrega del mismo evento no vuelve a contar', async () => {
    await consumirProductoCambiado(ejecutorConsola(db), evento('e1'));
    expect(await consumirProductoCambiado(ejecutorConsola(db), evento('e1'))).toBe(false);
    expect(await consumirProductoCambiado(ejecutorConsola(db), { ...evento('e1b'), claveIdempotencia: 'k-e1' })).toBe(false);
    expect(db.dato(ESTADO)?.['cambios']).toBe(1);
  });

  it('un evento inválido se rechaza y no cuenta', async () => {
    await expect(consumirProductoCambiado(ejecutorConsola(db), evento('e3', { productoId: 'p1', cambio: 'borrado' }))).rejects.toBeInstanceOf(ErrorEvento);
    await expect(consumirProductoCambiado(ejecutorConsola(db), evento('e4', {}))).rejects.toBeInstanceOf(ErrorEvento);
    expect(db.dato(ESTADO)).toBeUndefined();
  });

  it('las operaciones de producto por consola no anotan el cambio: lo cuenta solo el evento de Inventarios', async () => {
    const deps = { db, catalogo: new CatalogoDoble(), reloj: new RelojFijo() };
    const adm = actor('adm');
    await crearProductoConsola(deps, {
      tenantId: T, actor: adm, productoId: 'p1', datos: { nombre: 'A', categoria: 'C', sku: 'S1' }, precioUSD: { bo: 1, ar: 1 },
    });
    await editarProductoConsola(deps, { tenantId: T, actor: adm, productoId: 'p1', cambios: { nombre: 'B' } });
    expect(db.dato(ESTADO)).toBeUndefined();
    // El evento que publica la biblioteca de Inventarios en esas mismas transacciones es la única vía: suma una vez por evento.
    await consumirProductoCambiado(ejecutorConsola(db), evento('pc-consola-crear-p1', { productoId: 'p1', cambio: 'creado' }));
    await consumirProductoCambiado(ejecutorConsola(db), evento('e5', { productoId: 'p1', cambio: 'editado' }));
    expect(db.dato(ESTADO)?.['cambios']).toBe(2);
  });
  describe('corte de la publicación', () => {
    const CORTE = '2026-11-12T10:00:00.000Z';
    beforeEach(() => {
      db.poner(ESTADO, { cambios: 0, ultimoCambioEn: CORTE, corteCatalogoEn: CORTE });
    });

    it('un evento anterior o igual al corte no cuenta (ya salió publicado) y se consume', async () => {
      expect(await consumirProductoCambiado(ejecutorConsola(db), en('2026-11-12T09:59:59.000Z'))).toBe(true);
      expect(await consumirProductoCambiado(ejecutorConsola(db), en(CORTE))).toBe(true);
      expect(db.dato(ESTADO)?.['cambios']).toBe(0);
    });

    it('un evento posterior al corte cuenta, una sola vez aunque se reentregue, y conserva el corte', async () => {
      const ev = en('2026-11-12T10:00:00.001Z');
      expect(await consumirProductoCambiado(ejecutorConsola(db), ev)).toBe(true);
      expect(await consumirProductoCambiado(ejecutorConsola(db), ev)).toBe(false);
      expect(db.dato(ESTADO)).toMatchObject({ cambios: 1, corteCatalogoEn: CORTE });
    });

    it('con la publicación real: antes del corte no cuenta; en el intervalo catálogo-fin de publicación sí', async () => {
      const db2 = nuevaDb();
      const catalogo = new CatalogoDoble(db2);
      const reloj = new RelojFijo(Date.UTC(2026, 10, 12, 12, 0, 0));
      const disparador = { programar: () => Promise.resolve(), reconstruir: () => Promise.resolve() };
      const deps = { db: db2, catalogo, reloj, disparador };
      const adm = actor('adm');
      await guardarConfigSitio(deps, { tenantId: T, actor: adm, config: { plantillaActiva: 'ambar', whatsappNovuchat: '59100000000', medicion: {} } });
      // La lectura del catálogo ocurre a las 12:00:00; el reloj avanza 5 s hasta fijar `publicadoEn`.
      const lista = catalogo.listarProductos.bind(catalogo);
      catalogo.listarProductos = async () => {
        const r = await lista();
        reloj.ms += 5_000;
        return r;
      };
      await publicarSitio(deps, { tenantId: T, actor: adm });
      expect(db2.dato(ESTADO)).toMatchObject({ cambios: 0, corteCatalogoEn: '2026-11-12T12:00:00.000Z' });
      expect(db2.dato(`tenants/${T}/publicado/estado`)).toMatchObject({ publicadoEn: '2026-11-12T12:00:05.000Z' });
      // Anterior a la lectura: ya publicado, no cuenta.
      await consumirProductoCambiado(ejecutorConsola(db2), en('2026-11-12T11:59:59.000Z'));
      expect(db2.dato(ESTADO)?.['cambios']).toBe(0);
      // Entre la lectura y el fin de la publicación: pudo no entrar en la copia, cuenta.
      await consumirProductoCambiado(ejecutorConsola(db2), en('2026-11-12T12:00:03.000Z'));
      expect(db2.dato(ESTADO)?.['cambios']).toBe(1);
    });
  });
});
