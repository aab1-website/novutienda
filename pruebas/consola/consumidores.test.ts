import { beforeEach, describe, expect, it } from 'vitest';
import {
  consumirProductoCambiado, ejecutorConsola, guardarConfigSitio, publicarSitio, type DepsConsumidorProducto,
} from '@novutienda/consola';
import { ErrorEvento, type SobreEvento } from '@novutienda/nucleo';
import { actor, CatalogoDoble, nuevaDb, RelojFijo, T } from './dobles.js';

let n = 0;
/** Dependencias sin productos publicados: el consumidor se comporta como el contador de siempre. */
const depsVacias = (): DepsConsumidorProducto => ({
  catalogo: new CatalogoDoble(), reloj: new RelojFijo(), disparador: { programar: () => Promise.resolve(), reconstruir: () => Promise.resolve() },
});
const en = (iso: string, productoId = 'p1'): SobreEvento => ({ ...evento(`ev-${String(++n)}`, { productoId, cambio: 'creado' }), ocurridoEn: iso });

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
    expect(await consumirProductoCambiado(ejecutorConsola(db), evento('e1'), depsVacias())).toBe(true);
    expect(db.dato(ESTADO)).toEqual({ cambios: 1, ultimoCambioEn: '2026-11-12T10:00:00.000Z' });
    expect(await consumirProductoCambiado(ejecutorConsola(db), evento('e2', { productoId: 'p1', cambio: 'precio' }), depsVacias())).toBe(true);
    expect(db.dato(ESTADO)?.['cambios']).toBe(2);
  });

  it('la reentrega del mismo evento no vuelve a contar', async () => {
    await consumirProductoCambiado(ejecutorConsola(db), evento('e1'), depsVacias());
    expect(await consumirProductoCambiado(ejecutorConsola(db), evento('e1'), depsVacias())).toBe(false);
    expect(await consumirProductoCambiado(ejecutorConsola(db), { ...evento('e1b'), claveIdempotencia: 'k-e1' }, depsVacias())).toBe(false);
    expect(db.dato(ESTADO)?.['cambios']).toBe(1);
  });

  it('un evento inválido se rechaza y no cuenta', async () => {
    await expect(consumirProductoCambiado(ejecutorConsola(db), evento('e3', { productoId: 'p1', cambio: 'borrado' }), depsVacias())).rejects.toBeInstanceOf(ErrorEvento);
    await expect(consumirProductoCambiado(ejecutorConsola(db), evento('e4', {}), depsVacias())).rejects.toBeInstanceOf(ErrorEvento);
    expect(db.dato(ESTADO)).toBeUndefined();
  });

  it('el estado del sitio solo lo mueven los eventos de Inventarios: sin eventos no hay cambios', () => {
    expect(db.dato(ESTADO)).toBeUndefined();
  });

  describe('corte de la publicación', () => {
    const CORTE = '2026-11-12T10:00:00.000Z';
    beforeEach(() => {
      db.poner(ESTADO, { cambios: 0, ultimoCambioEn: CORTE, corteCatalogoEn: CORTE });
    });

    it('un evento anterior o igual al corte no cuenta (ya salió publicado) y se consume', async () => {
      expect(await consumirProductoCambiado(ejecutorConsola(db), en('2026-11-12T09:59:59.000Z'), depsVacias())).toBe(true);
      expect(await consumirProductoCambiado(ejecutorConsola(db), en(CORTE), depsVacias())).toBe(true);
      expect(db.dato(ESTADO)?.['cambios']).toBe(0);
    });

    it('un evento posterior al corte cuenta, una sola vez aunque se reentregue, y conserva el corte', async () => {
      const ev = en('2026-11-12T10:00:00.001Z');
      expect(await consumirProductoCambiado(ejecutorConsola(db), ev, depsVacias())).toBe(true);
      expect(await consumirProductoCambiado(ejecutorConsola(db), ev, depsVacias())).toBe(false);
      expect(db.dato(ESTADO)).toMatchObject({ cambios: 1, corteCatalogoEn: CORTE });
    });

    it('con la publicación real: antes del corte no cuenta; en el intervalo catálogo-fin de publicación sí', async () => {
      const db2 = nuevaDb();
      const catalogo = new CatalogoDoble(db2);
      const reloj = new RelojFijo(Date.UTC(2026, 10, 12, 12, 0, 0));
      const disparador = { programar: () => Promise.resolve(), reconstruir: () => Promise.resolve() };
      catalogo.agregar('p1');
      db2.poner(`tenants/${T}/fichasWeb/p1`, { productoId: 'p1', slug: 'p-uno', descripcion: 'D', garantia: '', estado: 'publicado', medios: [{ medioId: 'medio-0001', alt: 'f' }], seo: { titulo: '', descripcion: '' } });
      db2.poner(`tenants/${T}/medios/medio-0001`, { tipo: 'foto', ancho: 100, alto: 100, versiones: [{ clase: 'imagen', lado: 100, formato: 'webp', ruta: 'x/1.webp' }] });
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
      await consumirProductoCambiado(ejecutorConsola(db2), en('2026-11-12T11:59:59.000Z', 'p9'), { catalogo, reloj, disparador });
      expect(db2.dato(ESTADO)?.['cambios']).toBe(0);
      // Entre la lectura y el fin de la publicación: pudo no entrar en la copia, cuenta.
      await consumirProductoCambiado(ejecutorConsola(db2), en('2026-11-12T12:00:03.000Z', 'p9'), { catalogo, reloj, disparador });
      expect(db2.dato(ESTADO)?.['cambios']).toBe(1);
    });
  });

  describe('precio vivo', () => {
    const PUB = `tenants/${T}/publicado`;
    let db3: ReturnType<typeof nuevaDb>;
    let catalogo: CatalogoDoble;
    let reloj: RelojFijo;
    let programadas: number[];
    let deps: DepsConsumidorProducto;
    const adm = actor('adm');
    const ficha = (id: string): Record<string, unknown> => ({
      productoId: id, slug: `s-${id}`, descripcion: 'D', garantia: '', estado: 'publicado', medios: [{ medioId: 'medio-0001', alt: 'f' }], seo: { titulo: '', descripcion: '' },
    });
    const ev = (id: string, cambio = 'precio', productoId = 'p1', ocurridoEn = '2026-11-12T13:00:00.000Z'): SobreEvento =>
      ({ ...evento(id, { productoId, cambio }), ocurridoEn });
    const consumirEv = (e: SobreEvento): Promise<boolean> => consumirProductoCambiado(ejecutorConsola(db3), e, deps);
    const estadoPub = (): Record<string, unknown> => db3.dato(`${PUB}/estado`) as Record<string, unknown>;

    beforeEach(async () => {
      db3 = nuevaDb();
      catalogo = new CatalogoDoble(db3);
      reloj = new RelojFijo(Date.UTC(2026, 10, 12, 12, 0, 0));
      programadas = [];
      deps = { catalogo, reloj, disparador: { programar: (_t, para) => { programadas.push(para); return Promise.resolve(); }, reconstruir: () => Promise.resolve() } };
      catalogo.agregar('p1');
      catalogo.agregar('p2');
      for (const id of ['p1', 'p2']) db3.poner(`tenants/${T}/fichasWeb/${id}`, ficha(id));
      db3.poner(`tenants/${T}/medios/medio-0001`, { tipo: 'foto', ancho: 100, alto: 100, versiones: [{ clase: 'imagen', lado: 100, formato: 'webp', ruta: 'x/1.webp' }] });
      const d = { db: db3, catalogo, reloj, disparador: { programar: () => Promise.resolve(), reconstruir: () => Promise.resolve() } };
      await guardarConfigSitio(d, { tenantId: T, actor: adm, config: { plantillaActiva: 'ambar', whatsappNovuchat: '59100000000', medicion: {} } });
      await publicarSitio(d, { tenantId: T, actor: adm });
      reloj.ms += 60_000; // pasa un minuto desde publicar
    });

    it('cambia el precio: copia nueva, versión +1 en estado y sitio, precioVivoEn, publicadoEn intacto, programada y sin contar', async () => {
      const antes = estadoPub();
      catalogo.agregar('p1', { precioUSD: { bo: 99, ar: 120 } });
      expect(await consumirEv(ev('a1'))).toBe(true);
      expect(db3.dato(`${PUB}/producto__p1`)?.['precioUSD']).toEqual({ bo: 99, ar: 120 });
      expect(db3.dato(`${PUB}/producto__p1`)?.['nombre']).toBe('Producto p1');
      expect(estadoPub()['version']).toBe((antes['version'] as number) + 1);
      expect(db3.dato(`${PUB}/sitio`)?.['version']).toBe(estadoPub()['version']);
      expect(estadoPub()['precioVivoEn']).toBe(new Date(reloj.ms).toISOString());
      expect(estadoPub()['publicadoEn']).toBe(antes['publicadoEn']);
      expect(estadoPub()['productos']).toEqual(['p1', 'p2']);
      expect(estadoPub()['reconstruccion']).toMatchObject({ programadaPara: (antes['reconstruccion'] as { programadaPara: number }).programadaPara });
      expect(db3.dato(ESTADO)?.['cambios']).toBe(0);
    });

    it('el primer cambio tras una reconstrucción programa a +10 min; los siguientes dentro de la ventana no reprograman', async () => {
      db3.poner(`${PUB}/estado`, { ...estadoPub(), reconstruccion: { programadaPara: null, ultima: 1 } });
      catalogo.agregar('p1', { precioUSD: { bo: 1, ar: 1 } });
      await consumirEv(ev('b1'));
      catalogo.agregar('p2', { precioUSD: { bo: 2, ar: 2 } });
      await consumirEv(ev('b2', 'precio', 'p2'));
      expect(programadas).toEqual([reloj.ms + 600_000]);
      expect(estadoPub()['reconstruccion']).toMatchObject({ programadaPara: reloj.ms + 600_000, ultima: 1 });
      expect(estadoPub()['version']).toBe(3);
    });

    it('un evento repetido, uno con otra clave o uno cuyo precio ya está publicado no cambian nada', async () => {
      catalogo.agregar('p1', { precioUSD: { bo: 99, ar: 120 } });
      const e = ev('c1');
      await consumirEv(e);
      const v = estadoPub()['version'];
      expect(await consumirEv(e)).toBe(false);
      expect(await consumirEv(ev('c2'))).toBe(true); // otro evento del mismo cambio: el estado vivo ya coincide
      expect(estadoPub()['version']).toBe(v);
      expect(db3.dato(ESTADO)?.['cambios']).toBe(0);
    });

    it('un evento de precio posterior a una publicación con ese precio no hace nada', async () => {
      catalogo.agregar('p1', { precioUSD: { bo: 77, ar: 88 } });
      await publicarSitio({ db: db3, catalogo, reloj, disparador: deps.disparador }, { tenantId: T, actor: adm });
      const antes = estadoPub();
      expect(await consumirEv(ev('d1', 'precio', 'p1', '2026-11-12T11:00:00.000Z'))).toBe(true);
      expect(estadoPub()).toEqual(antes);
      expect(db3.dato(ESTADO)?.['cambios']).toBe(0);
    });

    it('solo cambia el nombre: cuenta como cambio sin publicar y la copia y la versión no se tocan', async () => {
      const antes = estadoPub();
      catalogo.agregar('p1', { nombre: 'Otro nombre' });
      await consumirEv(ev('e1', 'editado'));
      expect(db3.dato(`${PUB}/producto__p1`)?.['nombre']).toBe('Producto p1');
      expect(estadoPub()).toEqual(antes);
      expect(db3.dato(ESTADO)?.['cambios']).toBe(1);
      expect(programadas).toEqual([]);
    });

    it('precio y nombre a la vez: aplica el precio y cuenta el cambio', async () => {
      catalogo.agregar('p1', { nombre: 'Otro nombre', precioUSD: { bo: 5, ar: 6 } });
      await consumirEv(ev('f1', 'editado'));
      expect(db3.dato(`${PUB}/producto__p1`)).toMatchObject({ nombre: 'Producto p1', precioUSD: { bo: 5, ar: 6 } });
      expect(estadoPub()['version']).toBe(2);
      expect(db3.dato(ESTADO)?.['cambios']).toBe(1);
    });

    it('producto desactivado: copia retirada, fuera de estado.productos, versión +1 y reconstrucción agendada', async () => {
      catalogo.agregar('p1', { activo: false });
      await consumirEv(ev('g1', 'editado'));
      expect(db3.dato(`${PUB}/producto__p1`)).toBeUndefined();
      expect(estadoPub()['productos']).toEqual(['p2']);
      expect(estadoPub()['version']).toBe(2);
      expect(db3.dato(`${PUB}/sitio`)?.['version']).toBe(2);
      expect(estadoPub()['precioVivoEn']).toBeDefined();
      expect(db3.dato(ESTADO)?.['cambios']).toBe(0);
    });

    it('último producto retirado: la reconstrucción procede, queda avisoSitio sin_productos y cuenta un cambio sin publicar', async () => {
      catalogo.productos.delete('p1');
      catalogo.agregar('p2', { activo: false });
      await consumirEv(ev('h1', 'editado'));
      expect(db3.dato(ESTADO)?.['avisoSitio']).toBeUndefined(); // queda p2 con foto: publicable
      await consumirEv(ev('h2', 'editado', 'p2'));
      expect(estadoPub()['productos']).toEqual([]);
      expect(estadoPub()['version']).toBe(3);
      expect(db3.dato(ESTADO)).toMatchObject({ cambios: 1, avisoSitio: { motivo: 'sin_productos', en: new Date(reloj.ahora()).toISOString() } });
      expect(estadoPub()['reconstruccion']).toMatchObject({ programadaPara: expect.any(Number) }); // el retiro agenda igual la reconstrucción
    });

    it('retiro que deja productos sin fotos ni carrusel propio: aviso sin_fotos; con carruseles propios, sin aviso', async () => {
      db3.poner(`tenants/${T}/medios/medio-0001`, { tipo: 'foto', ancho: 1, alto: 1, versiones: [] });
      db3.poner(`${PUB}/producto__p2`, { ...(db3.dato(`${PUB}/producto__p2`) ?? {}), medios: [] });
      catalogo.agregar('p1', { activo: false });
      await consumirEv(ev('k1', 'editado'));
      expect(db3.dato(ESTADO)).toMatchObject({ cambios: 1, avisoSitio: { motivo: 'sin_fotos' } });
      expect(estadoPub()['productos']).toEqual(['p2']);
    });

    it('un retiro con fotos restantes no deja aviso ni cuenta', async () => {
      catalogo.agregar('p1', { activo: false });
      await consumirEv(ev('k2', 'editado'));
      expect(db3.dato(ESTADO)?.['avisoSitio']).toBeUndefined();
      expect(db3.dato(ESTADO)?.['cambios']).toBe(0);
    });

    it('una publicación correcta limpia avisoSitio', async () => {
      catalogo.agregar('p1', { activo: false });
      catalogo.agregar('p2', { activo: false });
      await consumirEv(ev('l1', 'editado'));
      await consumirEv(ev('l2', 'editado', 'p2'));
      expect(db3.dato(ESTADO)?.['avisoSitio']).toBeDefined();
      catalogo.agregar('p1', { activo: true });
      await publicarSitio({ db: db3, catalogo, reloj, disparador: deps.disparador }, { tenantId: T, actor: adm });
      expect(db3.dato(ESTADO)?.['avisoSitio']).toBeUndefined();
      expect(db3.dato(ESTADO)?.['cambios']).toBe(0);
    });

    it('reactivar un producto retirado NO lo republica: cuenta como cambio sin publicar hasta que alguien publique', async () => {
      catalogo.agregar('p1', { activo: false });
      await consumirEv(ev('m1', 'editado'));
      expect(estadoPub()['productos']).toEqual(['p2']);
      const version = estadoPub()['version'];
      catalogo.agregar('p1', { activo: true });
      await consumirEv(ev('m2', 'editado'));
      expect(estadoPub()['productos']).toEqual(['p2']);
      expect(db3.dato(`${PUB}/producto__p1`)).toBeUndefined();
      expect(estadoPub()['version']).toBe(version);
      expect(db3.dato(ESTADO)?.['cambios']).toBe(1);
    });

    it('producto sin copia publicada: se comporta como antes (cuenta, respetando el corte)', async () => {
      catalogo.agregar('p3', { precioUSD: { bo: 1, ar: 1 } });
      await consumirEv(ev('i1', 'creado', 'p3', '2026-11-12T13:00:00.000Z'));
      expect(db3.dato(ESTADO)?.['cambios']).toBe(1);
      expect(estadoPub()['version']).toBe(1);
      await consumirEv(ev('i2', 'creado', 'p3', '2026-11-12T11:00:00.000Z')); // anterior al corte
      expect(db3.dato(ESTADO)?.['cambios']).toBe(1);
    });

    it('carrera con publicarSitio: la subida de versión no se pierde (el consumo reintenta)', async () => {
      catalogo.agregar('p1', { precioUSD: { bo: 99, ar: 120 } });
      let cambiado = false;
      const leer = catalogo.leerProductoEnTransaccion.bind(catalogo);
      catalogo.leerProductoEnTransaccion = async (tx, t, id) => {
        const r = await leer(tx, t, id);
        if (!cambiado) { // alguien publica entre la lectura y el commit del consumo
          cambiado = true;
          await publicarSitio({ db: db3, catalogo, reloj, disparador: deps.disparador }, { tenantId: T, actor: adm });
        }
        return r;
      };
      await consumirEv(ev('j1'));
      expect(db3.reintentos).toBeGreaterThan(0);
      // La publicación concurrente ya trajo el precio 99 (versión 2); el reintento ve que coincide y no sube otra versión.
      expect(estadoPub()['version']).toBe(2);
      expect(db3.dato(`${PUB}/producto__p1`)?.['precioUSD']).toEqual({ bo: 99, ar: 120 });
      expect(db3.dato(`${PUB}/sitio`)?.['version']).toBe(2);
    });
  });
});
