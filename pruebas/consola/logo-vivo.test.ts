import { beforeEach, describe, expect, it } from 'vitest';
import {
  finalizarSubida, guardarConfigSitio, guardarFicha, ID_NEGOCIO, LIMITES_CONSOLA, limpiarSubidas, publicarSitio, quitarLogo, reservarSubida, type DepsMedios,
} from '@novutienda/consola';
import { actor, AlmacenDoble, CatalogoDoble, ConsultaDoble, DisparadorDoble, JPG, nuevaDb, PNG, ProcesadorSimulado, RelojFijo, T } from './dobles.js';

const adm = actor('adm');
const PREFIJO = `tenants/${T}/publico/medios/_negocio/`;

describe('logo del negocio en lo publicado (logo vivo)', () => {
  let db: ReturnType<typeof nuevaDb>;
  let almacen: AlmacenDoble;
  let proc: ProcesadorSimulado;
  let catalogo: CatalogoDoble;
  let reloj: RelojFijo;
  let disparador: DisparadorDoble;
  let n = 0;
  const deps = (): DepsMedios => ({ db, almacen, procesador: proc, catalogo, reloj, disparador });
  const ds = () => ({ db, catalogo, reloj });
  const dp = () => ({ db, catalogo, reloj, disparador });
  const sitio = (): Record<string, unknown> | undefined => db.dato(`tenants/${T}/publicado/sitio`);
  const cambios = (): unknown => db.dato(`tenants/${T}/sitio/estado`)?.['cambios'];
  const png = (marca: number): Uint8Array => { const b = new Uint8Array(PNG); b[100] = marca; return b; };

  async function subirLogo(bytes: Uint8Array): Promise<string> {
    n += 1;
    const subidaId = `logov-${String(n).padStart(5, '0')}`;
    const r = await reservarSubida(deps(), { tenantId: T, actor: adm, subidaId, productoId: ID_NEGOCIO, tipo: 'logo', bytes: bytes.length });
    almacen.subir(r.rutaOriginal, bytes);
    await finalizarSubida(deps(), { tenantId: T, actor: adm, subidaId });
    return subidaId;
  }
  async function publicable(): Promise<void> {
    n += 1;
    const subidaId = `medio-${String(n).padStart(5, '0')}`;
    const r = await reservarSubida(deps(), { tenantId: T, actor: adm, subidaId, productoId: 'cam-1', tipo: 'foto', bytes: JPG.length });
    almacen.subir(r.rutaOriginal, JPG);
    await finalizarSubida(deps(), { tenantId: T, actor: adm, subidaId });
    await guardarConfigSitio(ds(), { tenantId: T, actor: adm, config: { plantillaActiva: 'ambar', whatsappNovuchat: '59100000000', medicion: {} } });
    await guardarFicha(ds(), {
      tenantId: T, actor: adm, productoId: 'cam-1',
      ficha: { slug: 'camara-uno', descripcion: 'D', garantia: '12 meses', medios: [{ medioId: subidaId, alt: 'Frente' }], seo: { titulo: 'T', descripcion: 'D' }, estado: 'publicado' },
    });
  }

  beforeEach(() => {
    db = nuevaDb();
    almacen = new AlmacenDoble();
    proc = new ProcesadorSimulado(almacen);
    proc.info = { ancho: 1200, alto: 800 };
    catalogo = new CatalogoDoble(db);
    catalogo.agregar('cam-1', { marca: 'Acme', sku: 'SKU-1', garantiaMeses: 12, stockTotal: 5 });
    reloj = new RelojFijo();
    disparador = new DisparadorDoble();
  });

  describe('al publicar', () => {
    it('con logo subido escribe publicado/sitio.logo con las dos versiones y sin datos internos', async () => {
      await publicable();
      await subirLogo(png(1));
      await publicarSitio(dp(), { tenantId: T, actor: adm });
      const logo = sitio()?.['logo'] as { ancho: number; alto: number; versiones: Record<string, unknown>[] };
      expect(logo.ancho).toBe(1200);
      expect(logo.alto).toBe(800);
      expect(logo.versiones.map((v) => v['formato']).sort()).toEqual(['png', 'webp']);
      for (const v of logo.versiones) {
        expect(Object.keys(v).sort()).toEqual(['formato', 'lado', 'ruta']);
        expect(String(v['ruta']).startsWith(PREFIJO)).toBe(true);
      }
      expect(JSON.stringify(logo)).not.toContain('/privado/');
    });
    it('sin logo no escribe el campo, y si el logo se quitó antes de publicar de nuevo, desaparece', async () => {
      await publicable();
      await publicarSitio(dp(), { tenantId: T, actor: adm });
      expect(sitio()).not.toHaveProperty('logo');
      await subirLogo(png(1));
      db.poner(`tenants/${T}/publicado/sitio`, { ...sitio(), logo: { ancho: 1, alto: 1, versiones: [] } }); // restos
      db.poner(`tenants/${T}/sitio/logo`, undefined);
      await publicarSitio(dp(), { tenantId: T, actor: adm });
      expect(sitio()).not.toHaveProperty('logo');
    });
    it('una ruta fuera de la carpeta del logo no se publica; sin versiones válidas no hay logo', async () => {
      await publicable();
      const v = (ruta: string) => ({ formato: 'webp', lado: 512, ruta, bytes: 10 });
      db.poner(`tenants/${T}/sitio/logo`, {
        medioId: 'x', ancho: 10, alto: 10, actualizadoEn: '',
        versiones: [
          v(`${PREFIJO}ok.webp`), v(`tenants/otro/publico/medios/_negocio/a.webp`), v(`tenants/${T}/privado/originales/_negocio/a`),
          v(`${PREFIJO}../../privado/a.webp`), v(`${PREFIJO}sub/a.webp`),
        ],
      });
      await publicarSitio(dp(), { tenantId: T, actor: adm });
      expect((sitio()?.['logo'] as { versiones: { ruta: string }[] }).versiones.map((x) => x.ruta)).toEqual([`${PREFIJO}ok.webp`]);
      db.poner(`tenants/${T}/sitio/logo`, { medioId: 'x', ancho: 10, alto: 10, actualizadoEn: '', versiones: [v(`tenants/otro/publico/medios/_negocio/a.webp`)] });
      await publicarSitio(dp(), { tenantId: T, actor: adm });
      expect(sitio()).not.toHaveProperty('logo');
    });
  });

  describe('logo vivo', () => {
    it('subir un logo con el sitio publicado actualiza lo publicado, sube la versión y agenda, sin sumar cambios', async () => {
      await publicable();
      await publicarSitio(dp(), { tenantId: T, actor: adm });
      expect(disparador.eventos).toHaveLength(1);
      const antes = cambios();
      const estadoAntes = db.dato(`tenants/${T}/publicado/estado`) as Record<string, unknown>;
      reloj.ms += 11 * 60_000; // la ventana anterior ya venció
      await subirLogo(png(1));
      expect(sitio()).toMatchObject({ version: 2, logo: { ancho: 1200, alto: 800 } });
      expect(db.dato(`tenants/${T}/publicado/estado`)).toMatchObject({ version: 2, publicadoEn: estadoAntes['publicadoEn'] });
      expect(cambios()).toBe(antes);
      // La hora anterior estaba vencida: quien reconstruye es el temporizador (no se agenda otra); el logo no suma cambios.
      expect(sitio()?.['plantillaActiva']).toBe('ambar');
    });
    it('agenda la reconstrucción cuando no hay ninguna pendiente y no suma cambios', async () => {
      await publicable();
      await publicarSitio(dp(), { tenantId: T, actor: adm });
      db.poner(`tenants/${T}/publicado/estado`, { ...db.dato(`tenants/${T}/publicado/estado`), reconstruccion: { programadaPara: null, ultima: 1 } });
      disparador.eventos.length = 0;
      const antes = cambios();
      await subirLogo(png(1));
      expect(disparador.eventos).toEqual([`programar:${String(reloj.ms + 600_000)}`]);
      expect(cambios()).toBe(antes);
      expect(sitio()?.['logo']).toBeDefined();
    });
    it('quitar el logo lo quita de lo publicado, sube la versión y no suma cambios', async () => {
      await publicable();
      await subirLogo(png(1));
      await publicarSitio(dp(), { tenantId: T, actor: adm });
      expect(sitio()?.['logo']).toBeDefined();
      db.poner(`tenants/${T}/publicado/estado`, { ...db.dato(`tenants/${T}/publicado/estado`), reconstruccion: { programadaPara: null, ultima: 1 } });
      disparador.eventos.length = 0;
      const antes = cambios();
      await quitarLogo(deps(), { tenantId: T, actor: adm });
      expect(sitio()).not.toHaveProperty('logo');
      expect(sitio()?.['version']).toBe(2);
      expect(db.dato(`tenants/${T}/publicado/estado`)?.['version']).toBe(2);
      expect(disparador.eventos).toHaveLength(1);
      expect(cambios()).toBe(antes);
    });
    it('sin nada publicado no toca lo publicado, no agenda y sí cuenta como cambio sin publicar', async () => {
      await publicable();
      const antes = Number(cambios());
      await subirLogo(png(1));
      expect(sitio()).toBeUndefined();
      expect(db.dato(`tenants/${T}/publicado/estado`)).toBeUndefined();
      expect(disparador.eventos).toEqual([]);
      expect(Number(cambios())).toBe(antes + 1);
      await quitarLogo(deps(), { tenantId: T, actor: adm });
      expect(disparador.eventos).toEqual([]);
      expect(Number(cambios())).toBe(antes + 2);
    });
    it('reemplazo: lo publicado apunta al logo nuevo y nunca a un archivo ya borrado', async () => {
      await publicable();
      await subirLogo(png(1));
      await publicarSitio(dp(), { tenantId: T, actor: adm });
      const viejas = (sitio()?.['logo'] as { versiones: { ruta: string }[] }).versiones.map((v) => v.ruta);
      for (const r of viejas) expect(almacen.objetos.has(r)).toBe(true);
      await subirLogo(png(2));
      const nuevas = (sitio()?.['logo'] as { versiones: { ruta: string }[] }).versiones.map((v) => v.ruta);
      for (const r of nuevas) expect(almacen.objetos.has(r)).toBe(true);
      // Las versiones públicas del anterior siguen existiendo (el sitio construido puede usarlas) hasta las 24 horas.
      for (const r of viejas) expect(almacen.objetos.has(r)).toBe(true);
      reloj.ms += LIMITES_CONSOLA.esperaBorradoLogoMs - 1;
      await limpiarSubidas({ ...deps(), consulta: new ConsultaDoble(db) }, T);
      for (const r of viejas) expect(almacen.objetos.has(r)).toBe(true);
      reloj.ms += 1;
      await limpiarSubidas({ ...deps(), consulta: new ConsultaDoble(db) }, T);
      for (const r of viejas.filter((x) => !nuevas.includes(x))) expect(almacen.objetos.has(r)).toBe(false); // lo compartido por hash se conserva
      expect((db.dato(`tenants/${T}/sitio/logo`) as { versiones: { ruta: string }[] }).versiones.map((v) => v.ruta)).toEqual(nuevas);
    });
    it('quitar: las públicas esperan 24 h y después se borran; lo publicado ya no las usa', async () => {
      await publicable();
      await subirLogo(png(1));
      await publicarSitio(dp(), { tenantId: T, actor: adm });
      const viejas = (sitio()?.['logo'] as { versiones: { ruta: string }[] }).versiones.map((v) => v.ruta);
      await quitarLogo(deps(), { tenantId: T, actor: adm });
      expect(sitio()).not.toHaveProperty('logo');
      for (const r of viejas) expect(almacen.objetos.has(r)).toBe(true);
      reloj.ms += LIMITES_CONSOLA.esperaBorradoLogoMs;
      await limpiarSubidas({ ...deps(), consulta: new ConsultaDoble(db) }, T);
      for (const r of viejas) expect(almacen.objetos.has(r)).toBe(false);
    });
    it('dos reemplazos seguidos no dejan huérfanos, y la limpieza no toca los del logo vigente', async () => {
      await publicable();
      await subirLogo(png(1));
      await publicarSitio(dp(), { tenantId: T, actor: adm });
      const rutasDe = (): string[] => (sitio()?.['logo'] as { versiones: { ruta: string }[] }).versiones.map((v) => v.ruta);
      const a = rutasDe();
      await subirLogo(png(2));
      const b = rutasDe();
      await subirLogo(png(3));
      const c = rutasDe();
      reloj.ms += LIMITES_CONSOLA.esperaBorradoLogoMs;
      await limpiarSubidas({ ...deps(), consulta: new ConsultaDoble(db) }, T);
      for (const r of [...a, ...b].filter((x) => !c.includes(x))) expect(almacen.objetos.has(r)).toBe(false);
      for (const r of c) expect(almacen.objetos.has(r)).toBe(true);
      const logoPrefijo = [...almacen.objetos.keys()].filter((r) => r.startsWith(PREFIJO));
      expect(logoPrefijo.sort()).toEqual([...c].sort());
      expect(db.coleccion(`tenants/${T}/subidas`).filter((x) => x['estado'] === 'borrando')).toHaveLength(0);
    });
    it('A, luego B, luego A otra vez: la limpieza diferida de A no borra el logo vigente', async () => {
      await publicable();
      await subirLogo(png(1));
      await publicarSitio(dp(), { tenantId: T, actor: adm });
      await subirLogo(png(2));
      await subirLogo(png(1));
      const vigente = (sitio()?.['logo'] as { versiones: { ruta: string }[] }).versiones.map((v) => v.ruta);
      reloj.ms += LIMITES_CONSOLA.esperaBorradoLogoMs;
      await limpiarSubidas({ ...deps(), consulta: new ConsultaDoble(db) }, T);
      for (const r of vigente) expect(almacen.objetos.has(r)).toBe(true);
    });
    it('si falla el borrado del logo anterior, lo publicado ya apunta al nuevo (y el anterior queda para limpiarSubidas)', async () => {
      await publicable();
      await subirLogo(png(1));
      await publicarSitio(dp(), { tenantId: T, actor: adm });
      const original = almacen.borrar.bind(almacen);
      almacen.borrar = async () => { throw new Error('caído'); };
      await subirLogo(png(2));
      almacen.borrar = original;
      const publicadas = (sitio()?.['logo'] as { versiones: { ruta: string }[] }).versiones.map((v) => v.ruta);
      expect(publicadas).toEqual((db.dato(`tenants/${T}/sitio/logo`) as { versiones: { ruta: string }[] }).versiones.map((v) => v.ruta));
      for (const r of publicadas) expect(almacen.objetos.has(r)).toBe(true);
    });
    it('si el disparador falla, lo publicado igual quedó actualizado y la subida no falla', async () => {
      await publicable();
      await publicarSitio(dp(), { tenantId: T, actor: adm });
      db.poner(`tenants/${T}/publicado/estado`, { ...db.dato(`tenants/${T}/publicado/estado`), reconstruccion: { programadaPara: null, ultima: 1 } });
      disparador.programar = async () => { throw new Error('caído'); };
      await expect(subirLogo(png(1))).resolves.toBeDefined();
      expect(sitio()?.['logo']).toBeDefined();
    });
  });
});
