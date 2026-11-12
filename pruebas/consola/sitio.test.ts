import { beforeEach, describe, expect, it } from 'vitest';
import {
  decidirReconstruccion, eliminarSeccion, ejecutarReconstruccion,
  finalizarSubida, guardarCarrusel, guardarConfigSitio, guardarFicha, guardarSeccion, LIMITES_CONSOLA, obtenerTablero, ordenarSecciones,
  preciosDelDia, proyectarDisponibilidad, publicarSitio, reservarSubida, calcularDisponibilidadPublica, construirPublicado,
  type DepsMedios,
} from '@novutienda/consola';
import { rutaContador, type AlmacenCotizaciones, type CopiaCotizacion, type Redondeo } from '@novutienda/nucleo';
import { actor, AlmacenDoble, CatalogoDoble, DisparadorDoble, JPG, MP4, nuevaDb, ProcesadorSimulado, RelojFijo, T } from './dobles.js';

const adm = actor('adm');
const sup = actor('sup');

const ficha = (slug: string, medios: { medioId: string; alt: string }[] = [], estado = 'publicado') => ({
  slug, descripcion: 'Descripción', garantia: '12 meses', medios, seo: { titulo: 'T', descripcion: 'D' }, estado,
});

describe('servicios de la consola', () => {
  let db: ReturnType<typeof nuevaDb>;
  let catalogo: CatalogoDoble;
  let almacen: AlmacenDoble;
  let proc: ProcesadorSimulado;
  let reloj: RelojFijo;
  let disparador: DisparadorDoble;
  let n = 0;

  const deps = (): DepsMedios => ({ db, almacen, procesador: proc, catalogo, reloj });
  /** Sube y procesa un medio de verdad. */
  async function medio(producto: string, tipo: 'foto' | 'video' = 'foto'): Promise<string> {
    n += 1;
    const subidaId = `medio-${String(n).padStart(4, '0')}`;
    const bytes = tipo === 'foto' ? JPG : MP4;
    const r = await reservarSubida(deps(), { tenantId: T, actor: adm, subidaId, productoId: producto, tipo, bytes: bytes.length });
    almacen.subir(r.rutaOriginal, bytes);
    if (tipo === 'video') proc.info = { ancho: 1920, alto: 1080, duracionSeg: 20 };
    await finalizarSubida(deps(), { tenantId: T, actor: adm, subidaId });
    return subidaId;
  }

  beforeEach(() => {
    db = nuevaDb();
    catalogo = new CatalogoDoble(db);
    catalogo.agregar('cam-1', { marca: 'Acme', sku: 'SKU-1', garantiaMeses: 12, stockTotal: 5 });
    catalogo.agregar('cam-2');
    almacen = new AlmacenDoble();
    proc = new ProcesadorSimulado(almacen);
    reloj = new RelojFijo();
    disparador = new DisparadorDoble();
  });

  const ds = () => ({ db, catalogo, reloj });

  describe('fichas', () => {
    it('guarda la ficha, el índice de slugs, el cambio sin publicar y la auditoría', async () => {
      const m = await medio('cam-1');
      await guardarFicha(ds(), { tenantId: T, actor: sup, productoId: 'cam-1', ficha: ficha('camara-uno', [{ medioId: m, alt: 'Frente' }]) });
      expect(db.dato(`tenants/${T}/fichasWeb/cam-1`)).toMatchObject({ slug: 'camara-uno', productoId: 'cam-1', version: 1, por: 'u-sup' });
      expect(db.dato(`tenants/${T}/sitio/slugs`)).toEqual({ mapa: { 'camara-uno': 'cam-1' } });
      expect(db.coleccion(`tenants/${T}/auditoria`).some((a) => a['accion'] === 'ficha.guardar')).toBe(true);
      await guardarFicha(ds(), { tenantId: T, actor: adm, productoId: 'cam-1', ficha: ficha('camara-nueva') });
      expect(db.dato(`tenants/${T}/sitio/slugs`)).toEqual({ mapa: { 'camara-nueva': 'cam-1' } }); // el slug anterior se libera
      expect(db.dato(`tenants/${T}/fichasWeb/cam-1`)).toMatchObject({ version: 2 });
    });
    it('el slug es único entre productos', async () => {
      await guardarFicha(ds(), { tenantId: T, actor: adm, productoId: 'cam-1', ficha: ficha('mismo') });
      await expect(guardarFicha(ds(), { tenantId: T, actor: adm, productoId: 'cam-2', ficha: ficha('mismo') })).rejects.toMatchObject({ codigo: 'conflicto' });
    });
    it('dos productos que piden el mismo slug a la vez: gana uno', async () => {
      const r = await Promise.allSettled([
        guardarFicha(ds(), { tenantId: T, actor: adm, productoId: 'cam-1', ficha: ficha('carrera') }),
        guardarFicha(ds(), { tenantId: T, actor: adm, productoId: 'cam-2', ficha: ficha('carrera') }),
      ]);
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    });
    it('rechaza otro tenant, cajero, producto inexistente, medio ajeno o inexistente y datos inválidos', async () => {
      const m2 = await medio('cam-2');
      const e = { tenantId: T, productoId: 'cam-1', ficha: ficha('x-1') };
      await expect(guardarFicha(ds(), { ...e, actor: actor('adm', 'otro') })).rejects.toMatchObject({ codigo: 'no-autorizado' });
      await expect(guardarFicha(ds(), { ...e, actor: actor('caj') })).rejects.toMatchObject({ codigo: 'no-autorizado' });
      await expect(guardarFicha(ds(), { ...e, actor: adm, productoId: 'nada-1' })).rejects.toMatchObject({ codigo: 'no-encontrado' });
      await expect(guardarFicha(ds(), { ...e, actor: adm, ficha: ficha('x-1', [{ medioId: m2, alt: 'a' }]) })).rejects.toMatchObject({ codigo: 'conflicto' });
      await expect(guardarFicha(ds(), { ...e, actor: adm, ficha: ficha('x-1', [{ medioId: 'medio-9999', alt: 'a' }]) })).rejects.toMatchObject({ codigo: 'no-encontrado' });
      await expect(guardarFicha(ds(), { ...e, actor: adm, ficha: { ...ficha('x-1'), slug: 'MAL SLUG' } })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
      expect(db.dato(`tenants/${T}/fichasWeb/cam-1`)).toBeUndefined();
    });
    it('la consola no crea fichas de productos inexistentes: nada queda escrito', async () => {
      await expect(guardarFicha(ds(), { tenantId: T, actor: adm, productoId: 'fantasma-1', ficha: ficha('fantasma') })).rejects.toMatchObject({ codigo: 'no-encontrado' });
      expect(db.dato(`tenants/${T}/fichasWeb/fantasma-1`)).toBeUndefined();
      expect(db.coleccion(`tenants/${T}/auditoria`).filter((a) => a['accion'] === 'ficha.guardar')).toHaveLength(0);
      expect(catalogo.productos.has('fantasma-1')).toBe(false);
    });
    it('la existencia del producto se lee con la transacción de la escritura y un producto inexistente no escribe nada', async () => {
      const txs: unknown[] = [];
      const original = db.runTransaction.bind(db);
      db.runTransaction = ((fn: Parameters<typeof original>[0]) => original((tx) => { txs.push(tx); return fn(tx); })) as typeof db.runTransaction;
      catalogo.txExistencia.length = 0;
      await guardarFicha(ds(), { tenantId: T, actor: adm, productoId: 'cam-1', ficha: ficha('con-tx') });
      expect(catalogo.txExistencia.length).toBeGreaterThan(0);
      for (const tx of catalogo.txExistencia) expect(txs).toContain(tx);
      catalogo.txExistencia.length = 0;
      await expect(guardarFicha(ds(), { tenantId: T, actor: adm, productoId: 'fantasma-2', ficha: ficha('fantasma2') })).rejects.toMatchObject({ codigo: 'no-encontrado' });
      expect(db.dato(`tenants/${T}/fichasWeb/fantasma-2`)).toBeUndefined();
      expect(db.dato(`tenants/${T}/sitio/slugs`)?.['mapa']).not.toHaveProperty('fantasma2');
      for (const tx of catalogo.txExistencia) expect(txs).toContain(tx);
    });
    it('reservarSubida también comprueba el producto con su transacción', async () => {
      catalogo.txExistencia.length = 0;
      await expect(reservarSubida(deps(), { tenantId: T, actor: adm, subidaId: 'medio-8888', productoId: 'fantasma-3', tipo: 'foto', bytes: 10 })).rejects.toMatchObject({ codigo: 'no-encontrado' });
      expect(catalogo.txExistencia).toHaveLength(1);
      expect(db.dato(`tenants/${T}/subidas/medio-8888`)).toBeUndefined();
    });
    it('no admite más de 5 fotos ni más de 1 video en la ficha', async () => {
      const fotos: string[] = [];
      for (let i = 0; i < 5; i += 1) fotos.push(await medio('cam-1'));
      const v1 = await medio('cam-1', 'video');
      // 6 medios (5 fotos + 1 video) es válido
      await guardarFicha(ds(), { tenantId: T, actor: adm, productoId: 'cam-1', ficha: ficha('seis', [...fotos, v1].map((medioId) => ({ medioId, alt: 'a' }))) });
      // forzar un estado imposible en medios para probar la defensa de la ficha: 2 videos
      db.poner(`tenants/${T}/medios/video-dos`, { id: 'video-dos', productoId: 'cam-1', tipo: 'video' });
      await expect(guardarFicha(ds(), { tenantId: T, actor: adm, productoId: 'cam-1', ficha: ficha('seis', [v1, 'video-dos'].map((medioId) => ({ medioId, alt: 'a' }))) })).rejects.toMatchObject({ codigo: 'limite' });
    });
  });

  describe('secciones', () => {
    const sec = (id: string) => ({ id, titulo: id.slice(0, 20), visible: true, bloques: [{ tipo: 'texto', parrafos: ['Hola'] }] });
    it('permite 5 y rechaza la sexta; editar una existente sí se puede', async () => {
      for (const id of ['uno', 'dos', 'tres', 'cuatro', 'cinco']) await guardarSeccion(ds(), { tenantId: T, actor: adm, seccion: sec(id) });
      await expect(guardarSeccion(ds(), { tenantId: T, actor: adm, seccion: sec('seis') })).rejects.toMatchObject({ codigo: 'limite' });
      await expect(guardarSeccion(ds(), { tenantId: T, actor: adm, seccion: { ...sec('uno'), titulo: 'Editada' } })).resolves.toBeUndefined();
      expect(db.dato(`tenants/${T}/sitio/indice`)).toEqual({ secciones: ['uno', 'dos', 'tres', 'cuatro', 'cinco'] });
      expect(db.dato(`tenants/${T}/secciones/seis`)).toBeUndefined();
    });
    it('al eliminar una, vuelve a caber otra; ordenar exige una permutación exacta', async () => {
      for (const id of ['uno', 'dos']) await guardarSeccion(ds(), { tenantId: T, actor: adm, seccion: sec(id) });
      await ordenarSecciones(ds(), { tenantId: T, actor: adm, orden: ['dos', 'uno'] });
      expect(db.dato(`tenants/${T}/sitio/indice`)).toEqual({ secciones: ['dos', 'uno'] });
      await expect(ordenarSecciones(ds(), { tenantId: T, actor: adm, orden: ['dos'] })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
      await expect(ordenarSecciones(ds(), { tenantId: T, actor: adm, orden: ['dos', 'dos'] })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
      await eliminarSeccion(ds(), { tenantId: T, actor: adm, seccionId: 'dos' });
      expect(db.dato(`tenants/${T}/secciones/dos`)).toBeUndefined();
      await expect(eliminarSeccion(ds(), { tenantId: T, actor: adm, seccionId: 'dos' })).rejects.toMatchObject({ codigo: 'no-encontrado' });
    });
    it('rechaza enlaces fuera de la lista blanca, medios inexistentes, y a sup y a otro tenant', async () => {
      const mala = { ...sec('uno'), bloques: [{ tipo: 'enlaces', items: [{ texto: 'x', url: 'javascript:alert(1)' }] }] };
      await expect(guardarSeccion(ds(), { tenantId: T, actor: adm, seccion: mala })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
      const conImagen = { ...sec('uno'), bloques: [{ tipo: 'imagen', medioId: 'medio-9999', alt: 'x' }] };
      await expect(guardarSeccion(ds(), { tenantId: T, actor: adm, seccion: conImagen })).rejects.toMatchObject({ codigo: 'no-encontrado' });
      await expect(guardarSeccion(ds(), { tenantId: T, actor: sup, seccion: sec('uno') })).rejects.toMatchObject({ codigo: 'no-autorizado' });
      await expect(guardarSeccion(ds(), { tenantId: T, actor: actor('adm', 'otro'), seccion: sec('uno') })).rejects.toMatchObject({ codigo: 'no-autorizado' });
    });
  });

  describe('configuración y carruseles', () => {
    it('guarda la configuración (solo adm) y el carrusel con fotos existentes', async () => {
      const cfg = { plantillaActiva: 'bosque', whatsappNovuchat: '59100000000', medicion: {} };
      await guardarConfigSitio(ds(), { tenantId: T, actor: adm, config: cfg });
      expect(db.dato(`tenants/${T}/sitio/config`)).toEqual(cfg);
      await expect(guardarConfigSitio(ds(), { tenantId: T, actor: sup, config: cfg })).rejects.toMatchObject({ codigo: 'no-autorizado' });
      await expect(guardarConfigSitio(ds(), { tenantId: T, actor: adm, config: { ...cfg, plantillaActiva: 'fea' } })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
      const m = await medio('cam-1');
      await guardarCarrusel(ds(), { tenantId: T, actor: adm, carrusel: { plantilla: 'bosque', items: [{ medioId: m, alt: 'a' }] } });
      expect(db.dato(`tenants/${T}/carruseles/bosque`)).toBeDefined();
      await expect(guardarCarrusel(ds(), { tenantId: T, actor: adm, carrusel: { plantilla: 'bosque', items: [{ medioId: 'medio-9999', alt: 'a' }] } })).rejects.toMatchObject({ codigo: 'no-encontrado' });
    });
  });

  describe('publicar', () => {
    const dp = () => ({ db, catalogo, reloj, disparador });
    const configurar = (): Promise<void> => guardarConfigSitio(ds(), { tenantId: T, actor: adm, config: { plantillaActiva: 'ambar', whatsappNovuchat: '59100000000', medicion: {} } });

    it('exige configuración del sitio y rol adm', async () => {
      await expect(publicarSitio(dp(), { tenantId: T, actor: adm })).rejects.toMatchObject({ codigo: 'estado' });
      await configurar();
      await expect(publicarSitio(dp(), { tenantId: T, actor: sup })).rejects.toMatchObject({ codigo: 'no-autorizado' });
      await expect(publicarSitio(dp(), { tenantId: T, actor: actor('adm', 'otro') })).rejects.toMatchObject({ codigo: 'no-autorizado' });
    });

    it('arma la copia publicada solo con datos públicos, pone en cero los cambios y agenda a 10 minutos', async () => {
      const m = await medio('cam-1');
      await configurar();
      await guardarFicha(ds(), { tenantId: T, actor: adm, productoId: 'cam-1', ficha: ficha('camara-uno', [{ medioId: m, alt: 'Frente' }]) });
      await guardarFicha(ds(), { tenantId: T, actor: adm, productoId: 'cam-2', ficha: ficha('camara-dos', [], 'borrador') });
      expect(db.dato(`tenants/${T}/sitio/estado`)?.['cambios']).toBeGreaterThan(0);

      const r = await publicarSitio(dp(), { tenantId: T, actor: adm });
      expect(r).toMatchObject({ version: 1, productos: 1, decision: { accion: 'programar', para: reloj.ms + 600_000 } });
      expect(disparador.eventos).toEqual([`programar:${String(reloj.ms + 600_000)}`]);
      const pub = db.dato(`tenants/${T}/publicado/producto__cam-1`) as Record<string, unknown>;
      expect(pub).toMatchObject({ id: 'cam-1', slug: 'camara-uno', nombre: 'Producto cam-1', marca: 'Acme', precioUSD: { bo: 10, ar: 12 } });
      expect(db.dato(`tenants/${T}/publicado/producto__cam-2`)).toBeUndefined(); // borrador
      const texto = JSON.stringify(pub);
      expect(texto).not.toContain('SKU-1');
      expect(texto).not.toContain('stockTotal');
      expect(texto).not.toContain('/privado/');
      expect(texto).not.toContain('u-adm');
      expect(db.dato(`tenants/${T}/sitio/estado`)).toMatchObject({ cambios: 0 });
      expect(db.dato(`tenants/${T}/publicado/estado`)).toMatchObject({ version: 1, productos: ['cam-1'] });
      expect(db.dato(`tenants/${T}/publicado/sitio`)).toMatchObject({ plantillaActiva: 'ambar', version: 1 });
      expect(db.coleccion(`tenants/${T}/auditoria`).some((a) => a['accion'] === 'sitio.publicar')).toBe(true);
    });

    it('agrupa: una segunda publicación dentro de la ventana no agenda otra; vencida, reconstruye', async () => {
      await configurar();
      await publicarSitio(dp(), { tenantId: T, actor: adm });
      reloj.ms += 3 * 60_000;
      const r2 = await publicarSitio(dp(), { tenantId: T, actor: adm });
      expect(r2.decision.accion).toBe('esperar');
      expect(disparador.eventos).toHaveLength(1);
      expect(r2.version).toBe(2);
      reloj.ms += 8 * 60_000; // pasó la hora agendada sin que el temporizador corriera
      const r3 = await publicarSitio(dp(), { tenantId: T, actor: adm });
      expect(r3.decision.accion).toBe('reconstruir');
      expect(disparador.eventos.at(-1)).toBe('reconstruir:3:publicacion');
    });

    it('retira de la copia lo que ya no está publicado (oculto o desactivado)', async () => {
      await configurar();
      await guardarFicha(ds(), { tenantId: T, actor: adm, productoId: 'cam-1', ficha: ficha('camara-uno') });
      await publicarSitio(dp(), { tenantId: T, actor: adm });
      expect(db.dato(`tenants/${T}/publicado/producto__cam-1`)).toBeDefined();
      await guardarFicha(ds(), { tenantId: T, actor: adm, productoId: 'cam-1', ficha: ficha('camara-uno', [], 'oculto') });
      await publicarSitio(dp(), { tenantId: T, actor: adm });
      expect(db.dato(`tenants/${T}/publicado/producto__cam-1`)).toBeUndefined();
    });

    it('publica secciones visibles y carruseles con sus medios resueltos', async () => {
      const m = await medio('cam-1');
      await configurar();
      await guardarSeccion(ds(), { tenantId: T, actor: adm, seccion: { id: 'nosotros', titulo: 'Nosotros', visible: true, bloques: [{ tipo: 'imagen', medioId: m, alt: 'Local' }, { tipo: 'enlaces', items: [{ texto: 'WhatsApp', url: 'https://wa.me/59100000000' }] }] } });
      await guardarSeccion(ds(), { tenantId: T, actor: adm, seccion: { id: 'oculta', titulo: 'Oculta', visible: false, bloques: [] } });
      await guardarCarrusel(ds(), { tenantId: T, actor: adm, carrusel: { plantilla: 'ambar', items: [{ medioId: m, alt: 'Portada', enlace: '/catalogo' }] } });
      const r = await publicarSitio(dp(), { tenantId: T, actor: adm });
      expect(r.advertencias).toEqual([]);
      const s = db.dato(`tenants/${T}/publicado/seccion__nosotros`) as { bloques: { tipo: string; medio?: { alt: string; versiones: unknown[] } }[] };
      expect(s.bloques[0]?.medio?.alt).toBe('Local');
      expect(s.bloques[0]?.medio?.versiones).toHaveLength(8);
      expect(db.dato(`tenants/${T}/publicado/seccion__oculta`)).toBeUndefined();
      expect(db.dato(`tenants/${T}/publicado/carrusel__ambar`)).toMatchObject({ items: [{ alt: 'Portada', enlace: '/catalogo' }] });
    });

    it('construirPublicado omite medios inexistentes con una advertencia', () => {
      const p = construirPublicado({
        productos: [{ id: 'a-1', nombre: 'A', categoria: 'c', activo: true, disponible: true, precioUSD: { bo: 0, ar: 0 } }],
        fichas: new Map([['a-1', { productoId: 'a-1', ...ficha('a-uno', [{ medioId: 'perdido-1', alt: 'x' }]) } as never]]),
        medios: new Map(), config: { plantillaActiva: 'cielo', whatsappNovuchat: '59100000000', medicion: {} }, secciones: [], carruseles: [],
      });
      expect(p.productos[0]?.medios).toEqual([]);
      expect(p.advertencias[0]).toContain('perdido-1');
      expect(p.productos[0]?.precioUSD).toEqual({ bo: 0, ar: 0 }); // precio 0 = a consultar, se publica tal cual
    });

    it('el temporizador y la corrida diaria reconstruyen una sola vez', async () => {
      await configurar();
      await publicarSitio(dp(), { tenantId: T, actor: adm });
      const dd = { db, reloj, disparador };
      expect(await ejecutarReconstruccion(dd, { tenantId: T, evento: 'temporizador' })).toMatchObject({ accion: 'esperar' });
      reloj.ms += 11 * 60_000;
      expect(await ejecutarReconstruccion(dd, { tenantId: T, evento: 'temporizador' })).toEqual({ accion: 'reconstruir' });
      expect(await ejecutarReconstruccion(dd, { tenantId: T, evento: 'temporizador' })).toEqual({ accion: 'nada' });
      expect(await ejecutarReconstruccion(dd, { tenantId: T, evento: 'diaria' })).toEqual({ accion: 'reconstruir' });
      expect(disparador.eventos.slice(1)).toEqual(['reconstruir:1:publicacion', 'reconstruir:1:diaria']);
    });

    it('la corrida diaria sin nada publicado no hace nada', async () => {
      expect(await ejecutarReconstruccion({ db, reloj, disparador }, { tenantId: T, evento: 'diaria' })).toEqual({ accion: 'nada' });
      expect(disparador.eventos).toEqual([]);
    });
  });

  describe('decidirReconstruccion (función pura)', () => {
    const ahora = 1_000_000;
    it.each([
      [{ hayPublicacion: true, programadaPara: null }, 'publicacion', { accion: 'programar', para: ahora + 600_000 }],
      [{ hayPublicacion: true, programadaPara: ahora + 1 }, 'publicacion', { accion: 'esperar', para: ahora + 1 }],
      [{ hayPublicacion: true, programadaPara: ahora }, 'publicacion', { accion: 'reconstruir' }],
      [{ hayPublicacion: true, programadaPara: null }, 'temporizador', { accion: 'nada' }],
      [{ hayPublicacion: true, programadaPara: ahora + 5 }, 'temporizador', { accion: 'esperar', para: ahora + 5 }],
      [{ hayPublicacion: true, programadaPara: ahora - 5 }, 'temporizador', { accion: 'reconstruir' }],
      [{ hayPublicacion: true, programadaPara: ahora + 99 }, 'diaria', { accion: 'reconstruir' }],
      [{ hayPublicacion: false, programadaPara: null }, 'diaria', { accion: 'nada' }],
    ] as const)('%j + %s', (estado, evento, esperado) => {
      expect(decidirReconstruccion(estado, ahora, evento)).toEqual(esperado);
    });
    it('usa una ventana de 10 minutos', () => {
      expect(LIMITES_CONSOLA.ventanaReconstruccionMs).toBe(600_000);
    });
  });

  describe('disponibilidad pública', () => {
    it('solo disponible/agotado, sin cantidades, y sin recalcular la regla: usa la del catálogo', () => {
      const r = proyectarDisponibilidad([
        { id: 'a', disponible: true },
        { id: 'b', disponible: false },
      ]);
      expect(r).toEqual({ a: { disponible: true }, b: { disponible: false } });
      expect(JSON.stringify(r)).not.toMatch(/\d/);
    });
    it('se calcula desde el puerto', async () => {
      catalogo.agregar('cam-3', { disponible: false });
      expect(await calcularDisponibilidadPublica(catalogo, T)).toEqual({ 'cam-1': { disponible: true }, 'cam-2': { disponible: true }, 'cam-3': { disponible: false } });
    });
  });

  describe('tablero y precios del día', () => {
    const cot = (valor: number, fecha: string, par: string, fuente = 'BCB') => ({ cotizacionId: `id-${par}`, valor, fecha, fuente, par });
    const almacenCot = (docs: Record<string, unknown>): AlmacenCotizaciones => ({
      leer: (ruta: string) => Promise.resolve((docs[ruta] ?? null) as never),
      transaccion: () => Promise.reject(new Error('no usada')),
    });

    it('resume cambios, cotización vigente por mercado y uso frente a los topes', async () => {
      await configurar();
      db.poner(rutaContador(T), { productos: 37, usuarios: 2 });
      db.poner(`tenants/${T}/uso/medios`, { bytes: 5 * 1024 ** 3, productos: {} });
      const t = await obtenerTablero(
        { db, reloj, cotizaciones: almacenCot({ [`tenants/${T}/cotizaciones/BO`]: cot(6.96, '2026-11-04', 'BOB/USD') }) },
        { tenantId: T, actor: sup },
      );
      expect(t.cambiosSinPublicar).toBe(1);
      expect(t.cotizaciones[0]).toMatchObject({ mercado: 'BO', estado: 'vigente', valor: 6.96, fecha: '2026-11-04' });
      expect(t.cotizaciones[1]).toMatchObject({ mercado: 'AR', estado: 'sin_cotizacion' });
      expect(t.uso).toEqual({
        productos: { usados: 37, tope: 200 }, usuarios: { usados: 2, tope: 3 }, originalesBytes: { usados: 5 * 1024 ** 3, tope: 10 * 1024 ** 3 },
      });
      await expect(obtenerTablero({ db, reloj, cotizaciones: almacenCot({}) }, { tenantId: T, actor: actor('caj') })).rejects.toMatchObject({ codigo: 'no-autorizado' });
    });

    const redondeo: Redondeo = { BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' }, ARS: { tipo: 'multiplo', multiplo: 100, modo: 'arriba' } };
    const copia = (par: 'BOB/USD' | 'ARS/USD', valor: number): CopiaCotizacion => ({ cotizacionId: 'x', par, valor, fecha: '2026-11-04', fuente: 'BCB', estado: 'vigente' });

    it('calcula el Bs/ARS del día con precioFinal y distingue sin precio y sin cotización', () => {
      const p = preciosDelDia({ bo: 10, ar: 10.5 }, { BO: copia('BOB/USD', 12.06), AR: copia('ARS/USD', 1520) }, redondeo);
      expect(p.BO).toEqual({ tipo: 'precio', moneda: 'BOB', monto: 120.6, centavos: 12060 });
      expect(p.AR).toMatchObject({ tipo: 'precio', moneda: 'ARS', monto: 16000 });
      expect(preciosDelDia({ bo: 0, ar: 5 }, { BO: copia('BOB/USD', 12.06) }, redondeo)).toEqual({ BO: { tipo: 'sin_precio' }, AR: { tipo: 'sin_cotizacion' } });
    });

    async function configurar(): Promise<void> {
      await guardarConfigSitio(ds(), { tenantId: T, actor: adm, config: { plantillaActiva: 'ambar', whatsappNovuchat: '59100000000', medicion: {} } });
    }
  });
});
