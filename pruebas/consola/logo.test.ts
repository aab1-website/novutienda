import { beforeEach, describe, expect, it } from 'vitest';
import {
  finalizarSubida, ID_NEGOCIO, leerLogo, LIMITES_CONSOLA, limpiarSubidas, planificarProcesamiento, quitarLogo, reservarSubida, type DepsMedios,
} from '@novutienda/consola';
import {
  actor, AlmacenDoble, AVIF, CatalogoDoble, ConsultaDoble, EXE, HEIC, JPG, MP4, nuevaDb, PNG, ProcesadorSimulado, RelojFijo, T, WEBP,
} from './dobles.js';

const MIB = 1024 * 1024;
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('logo del negocio por archivo', () => {
  let db: ReturnType<typeof nuevaDb>;
  let almacen: AlmacenDoble;
  let proc: ProcesadorSimulado;
  let catalogo: CatalogoDoble;
  let deps: DepsMedios;
  const adm = actor('adm');
  let n = 0;
  const id = (): string => `logo-${String((n += 1)).padStart(5, '0')}`;
  const uso = (): { bytes: number; productos: Record<string, unknown> } => (db.dato(`tenants/${T}/uso/medios`) ?? { bytes: 0, productos: {} }) as never;

  async function reservarLogo(bytes: Uint8Array, quien = adm, declarados = bytes.length) {
    const subidaId = id();
    const r = await reservarSubida(deps, { tenantId: T, actor: quien, subidaId, productoId: ID_NEGOCIO, tipo: 'logo', bytes: declarados });
    almacen.subir(r.rutaOriginal, bytes);
    return { subidaId, r };
  }
  /** Contenido distinto por logo, para que el hash de las versiones no coincida. */
  const png = (marca: number): Uint8Array => { const b = new Uint8Array(PNG); b[100] = marca; return b; };

  beforeEach(() => {
    db = nuevaDb();
    almacen = new AlmacenDoble();
    proc = new ProcesadorSimulado(almacen);
    proc.info = { ancho: 1200, alto: 800 };
    catalogo = new CatalogoDoble(db);
    catalogo.agregar('cam-1');
    deps = { db, almacen, procesador: proc, catalogo, reloj: new RelojFijo() };
  });

  describe('reservarSubida', () => {
    it('adm reserva sin verificar producto: el original va a _negocio y solo cuenta bytes', async () => {
      const { r } = await reservarLogo(PNG);
      expect(r.rutaOriginal).toBe(`tenants/${T}/privado/originales/_negocio/${r.subidaId}`);
      expect(catalogo.txExistencia).toHaveLength(0);
      expect(uso()).toEqual({ bytes: PNG.length, productos: {} });
      expect(db.dato(`tenants/${T}/subidas/${r.subidaId}`)).toMatchObject({ tipo: 'logo', productoId: '_negocio', por: 'u-adm', estado: 'reservada' });
    });
    it('sup y caj son rechazados antes de reservar', async () => {
      for (const rol of ['sup', 'caj'] as const) {
        await expect(reservarLogo(PNG, actor(rol))).rejects.toMatchObject({ codigo: 'no-autorizado' });
      }
      expect(uso().bytes).toBe(0);
    });
    it('un producto no puede usar _negocio y el logo no puede apuntar a un producto', async () => {
      const e = { tenantId: T, actor: adm, subidaId: 'subida-abcd', bytes: 100 };
      await expect(reservarSubida(deps, { ...e, productoId: ID_NEGOCIO, tipo: 'foto' })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
      await expect(reservarSubida(deps, { ...e, productoId: ID_NEGOCIO, tipo: 'video' })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
      await expect(reservarSubida(deps, { ...e, productoId: 'cam-1', tipo: 'logo' })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
      expect(uso().bytes).toBe(0);
    });
    it('tope de 2 MiB', async () => {
      await expect(reservarSubida(deps, { tenantId: T, actor: adm, subidaId: 'subida-grnd', productoId: ID_NEGOCIO, tipo: 'logo', bytes: 2 * MIB + 1 }))
        .rejects.toMatchObject({ codigo: 'limite' });
      await expect(reservarSubida(deps, { tenantId: T, actor: adm, subidaId: 'subida-justo', productoId: ID_NEGOCIO, tipo: 'logo', bytes: 2 * MIB })).resolves.toBeDefined();
    });
    it('respeta la cuota de medios', async () => {
      db.poner(`tenants/${T}/uso/medios`, { bytes: LIMITES_CONSOLA.cuotaOriginalesBytes - 10, productos: {} });
      await expect(reservarLogo(PNG)).rejects.toMatchObject({ codigo: 'cuota-excedida' });
    });
  });

  describe('finalizarSubida', () => {
    it('procesa PNG y WebP, publica en _negocio y guarda sitio/logo', async () => {
      const { subidaId } = await reservarLogo(png(1));
      const m = await finalizarSubida(deps, { tenantId: T, actor: adm, subidaId });
      expect(m.tipo).toBe('logo');
      expect(m.versiones.map((v) => `${v.formato}${String(v.lado)}`).sort()).toEqual(['png512', 'webp512']);
      for (const v of m.versiones) {
        expect(v.ruta.startsWith(`tenants/${T}/publico/medios/_negocio/`)).toBe(true);
        expect(almacen.objetos.has(v.ruta)).toBe(true);
      }
      const doc = db.dato(`tenants/${T}/sitio/logo`) as { medioId: string; versiones: { formato: string; ruta: string }[] };
      expect(doc.medioId).toBe(subidaId);
      expect(doc.versiones.map((v) => v.formato).sort()).toEqual(['png', 'webp']);
      expect(db.dato(`tenants/${T}/uso/medios`)).toMatchObject({ productos: {} });
    });
    it('un supervisor no finaliza un logo', async () => {
      const { subidaId } = await reservarLogo(png(2));
      await expect(finalizarSubida(deps, { tenantId: T, actor: actor('sup'), subidaId })).rejects.toMatchObject({ codigo: 'no-autorizado' });
      expect(db.dato(`tenants/${T}/sitio/logo`)).toBeUndefined();
    });
    it.each([['SVG', SVG], ['HEIC', HEIC], ['AVIF', AVIF], ['video MP4', MP4], ['ejecutable', EXE]])('rechaza %s por sus bytes y libera la cuota', async (_n, bytes) => {
      const { subidaId, r } = await reservarLogo(bytes);
      await expect(finalizarSubida(deps, { tenantId: T, actor: adm, subidaId })).rejects.toMatchObject({ codigo: 'tipo-no-permitido' });
      expect(almacen.objetos.has(r.rutaOriginal)).toBe(false);
      expect(uso().bytes).toBe(0);
      expect(db.dato(`tenants/${T}/sitio/logo`)).toBeUndefined();
    });
    it('un archivo que finge ser imagen (extensión y tipo declarado de imagen, bytes de otro formato) se rechaza', async () => {
      const { subidaId } = await reservarLogo(new TextEncoder().encode('MZ-no-soy-una-imagen.png'));
      await expect(finalizarSubida(deps, { tenantId: T, actor: adm, subidaId })).rejects.toMatchObject({ codigo: 'tipo-no-permitido' });
    });
    it('rechaza lo que pesa más de lo reservado o más de 2 MiB al llegar', async () => {
      const subidaId = id();
      const r = await reservarSubida(deps, { tenantId: T, actor: adm, subidaId, productoId: ID_NEGOCIO, tipo: 'logo', bytes: 1000 });
      almacen.subir(r.rutaOriginal, new Uint8Array(2 * MIB + 1).fill(7));
      await expect(finalizarSubida(deps, { tenantId: T, actor: adm, subidaId })).rejects.toMatchObject({ codigo: 'limite' });
      expect(uso().bytes).toBe(0);
    });
    it('admite JPG y WebP', async () => {
      for (const bytes of [JPG, WEBP]) {
        const { subidaId } = await reservarLogo(bytes);
        await expect(finalizarSubida(deps, { tenantId: T, actor: adm, subidaId })).resolves.toMatchObject({ tipo: 'logo' });
      }
    });
    it('rechaza versiones con metadatos', async () => {
      proc.dejarMetadatos = true;
      const { subidaId } = await reservarLogo(png(3));
      await expect(finalizarSubida(deps, { tenantId: T, actor: adm, subidaId })).rejects.toMatchObject({ codigo: 'procesamiento' });
      expect(db.dato(`tenants/${T}/sitio/logo`)).toBeUndefined();
    });
    it('subir otro logo reemplaza al anterior: borra sus objetos y libera su cuota, sin tocar fotos de productos', async () => {
      catalogo.agregar('cam-2');
      const foto = id();
      const rf = await reservarSubida(deps, { tenantId: T, actor: adm, subidaId: foto, productoId: 'cam-1', tipo: 'foto', bytes: JPG.length });
      almacen.subir(rf.rutaOriginal, JPG);
      const mFoto = await finalizarSubida(deps, { tenantId: T, actor: adm, subidaId: foto });

      const a = await reservarLogo(png(4));
      const ma = await finalizarSubida(deps, { tenantId: T, actor: adm, subidaId: a.subidaId });
      const b = await reservarLogo(png(5));
      proc.info = { ancho: 300, alto: 300 };
      const mb = await finalizarSubida(deps, { tenantId: T, actor: adm, subidaId: b.subidaId });

      expect(db.dato(`tenants/${T}/sitio/logo`)).toMatchObject({ medioId: b.subidaId });
      expect(db.dato(`tenants/${T}/medios/${a.subidaId}`)).toBeUndefined();
      expect(almacen.objetos.has(a.r.rutaOriginal)).toBe(false);
      for (const v of ma.versiones) if (!mb.versiones.some((x) => x.ruta === v.ruta)) expect(almacen.objetos.has(v.ruta)).toBe(false);
      for (const v of mb.versiones) expect(almacen.objetos.has(v.ruta)).toBe(true);
      expect(mb.versiones.map((v) => v.lado)).toEqual([300, 300]);
      // La foto del producto sigue intacta.
      expect(db.dato(`tenants/${T}/medios/${foto}`)).toBeDefined();
      for (const v of mFoto.versiones) expect(almacen.objetos.has(v.ruta)).toBe(true);
      expect(uso().bytes).toBe(JPG.length + PNG.length);
    });
    it('un logo idéntico al vigente no borra sus propias versiones', async () => {
      const a = await reservarLogo(png(6));
      await finalizarSubida(deps, { tenantId: T, actor: adm, subidaId: a.subidaId });
      const b = await reservarLogo(png(6));
      const mb = await finalizarSubida(deps, { tenantId: T, actor: adm, subidaId: b.subidaId });
      for (const v of mb.versiones) expect(almacen.objetos.has(v.ruta)).toBe(true);
    });
    it('una reserva de logo vencida se libera con la limpieza', async () => {
      await reservarLogo(png(7));
      (deps.reloj as RelojFijo).ms += LIMITES_CONSOLA.vigenciaReservaMs + 1000;
      const r = await limpiarSubidas({ ...deps, consulta: new ConsultaDoble(db) }, T);
      expect(r.vencidas).toBe(1);
      expect(uso().bytes).toBe(0);
    });
  });

  describe('plan de procesamiento', () => {
    it('lado mayor de 512 como máximo, PNG y WebP, sin metadatos', () => {
      const p = planificarProcesamiento('logo', 2000, 1000);
      expect(p.items.map((i) => `${i.clase}:${i.formato}:${String(i.lado)}`)).toEqual(['logo:png:512', 'logo:webp:512']);
      expect(p.quitarMetadatos).toBe(true);
      expect(planificarProcesamiento('logo', 300, 900).items.every((i) => i.lado === 512)).toBe(true);
    });
    it('nunca amplía', () => {
      expect(planificarProcesamiento('logo', 200, 100).items.every((i) => i.lado === 200)).toBe(true);
    });
  });

  describe('leerLogo y quitarLogo', () => {
    it('leerLogo devuelve null sin logo, y el vigente para sup y adm; caj no lo ve', async () => {
      await expect(leerLogo(deps, { tenantId: T, actor: actor('sup') })).resolves.toBeNull();
      const { subidaId } = await reservarLogo(png(8));
      await finalizarSubida(deps, { tenantId: T, actor: adm, subidaId });
      for (const rol of ['sup', 'adm'] as const) {
        await expect(leerLogo(deps, { tenantId: T, actor: actor(rol) })).resolves.toMatchObject({ medioId: subidaId });
      }
      await expect(leerLogo(deps, { tenantId: T, actor: actor('caj') })).rejects.toMatchObject({ codigo: 'no-autorizado' });
    });
    it('quitarLogo (solo adm) borra referencia, medio y objetos, y libera la cuota; es idempotente', async () => {
      const { subidaId, r } = await reservarLogo(png(9));
      const m = await finalizarSubida(deps, { tenantId: T, actor: adm, subidaId });
      await expect(quitarLogo(deps, { tenantId: T, actor: actor('sup') })).rejects.toMatchObject({ codigo: 'no-autorizado' });
      await expect(quitarLogo(deps, { tenantId: T, actor: adm })).resolves.toEqual({ quitado: true });
      expect(db.dato(`tenants/${T}/sitio/logo`)).toBeUndefined();
      expect(db.dato(`tenants/${T}/medios/${subidaId}`)).toBeUndefined();
      expect(almacen.objetos.has(r.rutaOriginal)).toBe(false);
      for (const v of m.versiones) expect(almacen.objetos.has(v.ruta)).toBe(false);
      expect(uso().bytes).toBe(0);
      await expect(leerLogo(deps, { tenantId: T, actor: adm })).resolves.toBeNull();
      await expect(quitarLogo(deps, { tenantId: T, actor: adm })).resolves.toEqual({ quitado: false });
    });
  });
});
