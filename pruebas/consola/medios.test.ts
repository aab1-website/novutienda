import { beforeEach, describe, expect, it } from 'vitest';
import {
  borrarMedio, contieneMetadatos, detectarArchivo, ErrorConsola, finalizarSubida, LIMITES_CONSOLA, limpiarSubidas, nombreVersion,
  planificarProcesamiento, reservarSubida, type DepsMedios,
} from '@plataforma/consola';
import { rutaContador } from '@plataforma/nucleo';
import {
  actor, AlmacenDoble, AVIF, CatalogoDoble, ConsultaDoble, EXE, HEIC, JPG, JPG_CON_EXIF, JPG_LIMPIO, MOV, MP4, nuevaDb, PNG, ProcesadorSimulado,
  RelojFijo, T, WEBM, WEBP,
} from './dobles.js';

const MIB = 1024 * 1024;

describe('detección de tipo por bytes', () => {
  it('reconoce JPG, PNG, WebP, HEIC, MP4, MOV y WebM', () => {
    expect(detectarArchivo(JPG)).toEqual({ tipo: 'foto', formato: 'jpg' });
    expect(detectarArchivo(PNG)).toEqual({ tipo: 'foto', formato: 'png' });
    expect(detectarArchivo(WEBP)).toEqual({ tipo: 'foto', formato: 'webp' });
    expect(detectarArchivo(HEIC)).toEqual({ tipo: 'foto', formato: 'heic' });
    expect(detectarArchivo(MP4)).toEqual({ tipo: 'video', formato: 'mp4' });
    expect(detectarArchivo(MOV)).toEqual({ tipo: 'video', formato: 'mov' });
    expect(detectarArchivo(WEBM)).toEqual({ tipo: 'video', formato: 'webm' });
  });
  it('rechaza ejecutables, AVIF y archivos vacíos o truncados', () => {
    expect(detectarArchivo(EXE)).toBeUndefined();
    expect(detectarArchivo(AVIF)).toBeUndefined();
    expect(detectarArchivo(new Uint8Array())).toBeUndefined();
    expect(detectarArchivo(new Uint8Array([0xff, 0xd8]))).toBeUndefined();
    expect(detectarArchivo(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]))).toBeUndefined(); // Matroska sin «webm»
  });
});

describe('metadatos', () => {
  it('detecta EXIF en JPEG y no en uno limpio', () => {
    expect(contieneMetadatos(JPG_CON_EXIF)).toBe(true);
    expect(contieneMetadatos(JPG_LIMPIO)).toBe(false);
  });
  it('detecta EXIF y XMP en PNG y WebP, y el elemento Exif de un contenedor ISO', () => {
    const t = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
    const png = new Uint8Array([0x89, ...t('PNG'), 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 2, ...t('eXIf'), 0, 0, 0, 0, 0, 0]);
    expect(contieneMetadatos(png)).toBe(true);
    const webp = new Uint8Array([...t('RIFF'), 0, 0, 0, 0, ...t('WEBP'), ...t('VP8 '), 4, 0, 0, 0, 1, 2, 3, 4, ...t('EXIF'), 2, 0, 0, 0, 9, 9]);
    expect(contieneMetadatos(webp)).toBe(true);
    const limpio = new Uint8Array([...t('RIFF'), 0, 0, 0, 0, ...t('WEBP'), ...t('VP8 '), 4, 0, 0, 0, 1, 2, 3, 4]);
    expect(contieneMetadatos(limpio)).toBe(false);
    expect(contieneMetadatos(new Uint8Array([0, 0, 0, 20, ...t('ftypavif'), ...t('mif1'), ...t('Exif')]))).toBe(true);
  });
});

describe('plan de procesamiento', () => {
  it('foto grande: 4 anchos en AVIF y WebP', () => {
    const p = planificarProcesamiento('foto', 4000, 3000);
    expect(p.items).toHaveLength(8);
    expect(new Set(p.items.map((i) => i.lado))).toEqual(new Set([480, 960, 1600, 2400]));
    expect(new Set(p.items.map((i) => i.formato))).toEqual(new Set(['avif', 'webp']));
    expect(p.quitarMetadatos).toBe(true);
  });
  it('nunca amplía: una foto de 1000 px no genera 1600 ni 2400', () => {
    expect(new Set(planificarProcesamiento('foto', 1000, 700).items.map((i) => i.lado))).toEqual(new Set([480, 960]));
    expect(new Set(planificarProcesamiento('foto', 300, 300).items.map((i) => i.lado))).toEqual(new Set([300]));
  });
  it('video: 720p y 1080p más póster; el vertical cuenta por su lado corto', () => {
    const p = planificarProcesamiento('video', 1920, 1080);
    expect(p.items.map((i) => `${i.clase}${String(i.lado)}`)).toEqual(['video720', 'video1080', 'poster1280']);
    expect(planificarProcesamiento('video', 1080, 1920).items.filter((i) => i.clase === 'video')).toHaveLength(2);
    expect(planificarProcesamiento('video', 640, 480).items.map((i) => i.lado)).toEqual([480, 640]);
  });
  it('los nombres llevan el hash de contenido', () => {
    const h = 'a'.repeat(64);
    expect(nombreVersion(h, { clase: 'imagen', lado: 480, formato: 'webp' })).toBe(`${'a'.repeat(32)}-imagen480.webp`);
    expect(() => nombreVersion('xyz', { clase: 'imagen', lado: 480, formato: 'webp' })).toThrow();
  });
  it('rechaza dimensiones inválidas', () => {
    expect(() => planificarProcesamiento('foto', 0, 10)).toThrow(RangeError);
  });
});

describe('pipeline de medios', () => {
  let db: ReturnType<typeof nuevaDb>;
  let almacen: AlmacenDoble;
  let proc: ProcesadorSimulado;
  let catalogo: CatalogoDoble;
  let reloj: RelojFijo;
  let deps: DepsMedios;
  const adm = actor('adm');
  let n = 0;
  const id = (): string => `subida-${String((n += 1)).padStart(4, '0')}`;
  const uso = (): { bytes: number; productos: Record<string, { fotos: number; videos: number }> } =>
    (db.dato(`tenants/${T}/uso/medios`) ?? { bytes: 0, productos: {} }) as never;

  /** Reserva, sube bytes reales y finaliza. */
  async function subir(tipo: 'foto' | 'video', bytes: Uint8Array, opciones: { producto?: string; declarados?: number; actorU?: ReturnType<typeof actor> } = {}) {
    const subidaId = id();
    const r = await reservarSubida(deps, {
      tenantId: T, actor: opciones.actorU ?? adm, subidaId, productoId: opciones.producto ?? 'cam-1', tipo, bytes: opciones.declarados ?? bytes.length,
    });
    almacen.subir(r.rutaOriginal, bytes);
    return { subidaId, r };
  }

  beforeEach(() => {
    db = nuevaDb();
    almacen = new AlmacenDoble();
    proc = new ProcesadorSimulado(almacen);
    catalogo = new CatalogoDoble(db);
    catalogo.agregar('cam-1');
    catalogo.agregar('cam-2');
    reloj = new RelojFijo();
    deps = { db, almacen, procesador: proc, catalogo, reloj };
  });

  describe('reservarSubida', () => {
    it('reserva y cuenta bytes y fotos del producto', async () => {
      const { r } = await subir('foto', JPG);
      expect(r.rutaOriginal).toBe(`tenants/${T}/privado/originales/cam-1/${r.subidaId}`);
      expect(uso()).toEqual({ bytes: JPG.length, productos: { 'cam-1': { fotos: 1, videos: 0 } } });
    });
    it('es idempotente con la misma subidaId y mismos datos, y falla si cambian', async () => {
      const entrada = { tenantId: T, actor: adm, subidaId: 'subida-xxxx', productoId: 'cam-1', tipo: 'foto' as const, bytes: 1000 };
      const a = await reservarSubida(deps, entrada);
      const b = await reservarSubida(deps, entrada);
      expect(b).toEqual(a);
      expect(uso().bytes).toBe(1000);
      await expect(reservarSubida(deps, { ...entrada, bytes: 2000 })).rejects.toMatchObject({ codigo: 'conflicto' });
    });
    it('rechaza a un cajero, a un actor de otro tenant y a un sin sesión', async () => {
      const e = { tenantId: T, subidaId: 'subida-yyyy', productoId: 'cam-1', tipo: 'foto' as const, bytes: 10 };
      await expect(reservarSubida(deps, { ...e, actor: actor('caj') })).rejects.toMatchObject({ codigo: 'no-autorizado' });
      await expect(reservarSubida(deps, { ...e, actor: actor('adm', 'otro-tenant') })).rejects.toMatchObject({ codigo: 'no-autorizado' });
      await expect(reservarSubida(deps, { ...e, actor: { uid: 'x', claims: {} } })).rejects.toMatchObject({ codigo: 'no-autorizado' });
      await expect(reservarSubida(deps, { ...e, actor: { uid: 'x', claims: { firebase: { sign_in_provider: 'anonymous' }, pl: { t: { [T]: 'adm' }, v: 1 } } } })).rejects.toMatchObject({ codigo: 'no-autorizado' });
      expect(uso().bytes).toBe(0);
    });
    it('un supervisor sí puede subir', async () => {
      await expect(subir('foto', JPG, { actorU: actor('sup') })).resolves.toBeDefined();
    });
    it('rechaza la sexta foto', async () => {
      for (let i = 0; i < 5; i += 1) await subir('foto', JPG);
      await expect(subir('foto', JPG)).rejects.toMatchObject({ codigo: 'limite' });
      expect(uso().productos['cam-1']?.fotos).toBe(5);
      await expect(subir('foto', JPG, { producto: 'cam-2' })).resolves.toBeDefined(); // el tope es por producto
    });
    it('rechaza el segundo video', async () => {
      await subir('video', MP4);
      await expect(subir('video', MP4)).rejects.toMatchObject({ codigo: 'limite' });
    });
    it('rechaza una foto de más de 15 MB y un video de más de 200 MB, y acepta justo el límite', async () => {
      const e = { tenantId: T, actor: adm, productoId: 'cam-1' };
      await expect(reservarSubida(deps, { ...e, subidaId: id(), tipo: 'foto', bytes: 15 * MIB + 1 })).rejects.toMatchObject({ codigo: 'limite' });
      await expect(reservarSubida(deps, { ...e, subidaId: id(), tipo: 'video', bytes: 200 * MIB + 1 })).rejects.toMatchObject({ codigo: 'limite' });
      await expect(reservarSubida(deps, { ...e, subidaId: id(), tipo: 'foto', bytes: 15 * MIB })).resolves.toBeDefined();
      await expect(reservarSubida(deps, { ...e, subidaId: id(), tipo: 'video', bytes: 200 * MIB })).resolves.toBeDefined();
    });
    it('cuota al límite: justo 10 GB entra, un byte más no', async () => {
      db.poner(`tenants/${T}/uso/medios`, { bytes: LIMITES_CONSOLA.cuotaOriginalesBytes - 1000, productos: {} });
      const e = { tenantId: T, actor: adm, productoId: 'cam-1', tipo: 'foto' as const };
      await expect(reservarSubida(deps, { ...e, subidaId: id(), bytes: 1001 })).rejects.toMatchObject({ codigo: 'cuota-excedida' });
      await expect(reservarSubida(deps, { ...e, subidaId: id(), bytes: 1000 })).resolves.toBeDefined();
      await expect(reservarSubida(deps, { ...e, subidaId: id(), bytes: 1 })).rejects.toMatchObject({ codigo: 'cuota-excedida' });
      expect(uso().bytes).toBe(LIMITES_CONSOLA.cuotaOriginalesBytes);
    });
    it('dos reservas concurrentes con una sola plaza: gana una', async () => {
      db.poner(`tenants/${T}/uso/medios`, { bytes: 0, productos: { 'cam-1': { fotos: 4, videos: 0 } } });
      const r = await Promise.allSettled([subir('foto', JPG), subir('foto', JPG)]);
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      expect(uso().productos['cam-1']?.fotos).toBe(5);
      expect(db.reintentos).toBeGreaterThan(0);
    });
    it('rechaza un producto inexistente, ids y tamaños inválidos', async () => {
      const e = { tenantId: T, actor: adm, subidaId: id(), productoId: 'no-existe', tipo: 'foto' as const, bytes: 10 };
      await expect(reservarSubida(deps, e)).rejects.toMatchObject({ codigo: 'no-encontrado' });
      await expect(reservarSubida(deps, { ...e, productoId: '../x' })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
      await expect(reservarSubida(deps, { ...e, subidaId: 'a/b' })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
      await expect(reservarSubida(deps, { ...e, productoId: 'cam-1', bytes: 0 })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
      await expect(reservarSubida(deps, { ...e, productoId: 'cam-1', tipo: 'audio' as never })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
      await expect(reservarSubida(deps, { ...e, tenantId: '../t' })).rejects.toBeInstanceOf(ErrorConsola);
    });
    it('un contador dañado no se interpreta como cero', async () => {
      db.poner(`tenants/${T}/uso/medios`, { bytes: -5, productos: {} });
      await expect(subir('foto', JPG)).rejects.toMatchObject({ codigo: 'contador-corrupto' });
    });
  });

  describe('finalizarSubida', () => {
    it('procesa una foto: 8 versiones públicas con hash, original privado, sin EXIF', async () => {
      const { subidaId, r } = await subir('foto', JPG);
      const m = await finalizarSubida(deps, { tenantId: T, actor: adm, subidaId });
      expect(m.versiones).toHaveLength(8);
      for (const v of m.versiones) {
        expect(v.ruta).toMatch(new RegExp(`^tenants/${T}/publico/medios/cam-1/[a-f0-9]{32}-imagen\\d+\\.(avif|webp)$`));
        expect(contieneMetadatos(almacen.objetos.get(v.ruta) as Uint8Array)).toBe(false);
      }
      expect(almacen.objetos.has(r.rutaOriginal)).toBe(true); // el original se conserva
      expect(r.rutaOriginal).toContain('/privado/');
      expect([...almacen.objetos.keys()].filter((k) => k.includes('/procesando/'))).toEqual([]); // temporales limpios
      expect(db.dato(`tenants/${T}/medios/${subidaId}`)).toMatchObject({ productoId: 'cam-1', tipo: 'foto', formatoOriginal: 'jpg' });
      expect(db.dato(`tenants/${T}/subidas/${subidaId}`)).toMatchObject({ estado: 'procesada' });
      expect(db.dato(`tenants/${T}/sitio/estado`)).toMatchObject({ cambios: 1 });
      expect(db.coleccion(`tenants/${T}/auditoria`).some((a) => a['accion'] === 'medio.subir')).toBe(true);
    });
    it('es idempotente: finalizar dos veces devuelve el mismo medio', async () => {
      const { subidaId } = await subir('foto', JPG);
      const a = await finalizarSubida(deps, { tenantId: T, actor: adm, subidaId });
      const b = await finalizarSubida(deps, { tenantId: T, actor: adm, subidaId });
      expect(b).toEqual(a);
      expect(uso().productos['cam-1']?.fotos).toBe(1);
    });
    it('video: 720p y 1080p con póster', async () => {
      proc.info = { ancho: 1920, alto: 1080, duracionSeg: 30 };
      const { subidaId } = await subir('video', MP4);
      const m = await finalizarSubida(deps, { tenantId: T, actor: adm, subidaId });
      expect(m.versiones.map((v) => `${v.clase}${String(v.lado)}`)).toEqual(['video720', 'video1080', 'poster1280']);
      expect(m.duracionSeg).toBe(30);
    });
    it('tipo falsificado: un ejecutable declarado como foto se rechaza, se borra y libera la cuota', async () => {
      const { subidaId, r } = await subir('foto', EXE);
      await expect(finalizarSubida(deps, { tenantId: T, actor: adm, subidaId })).rejects.toMatchObject({ codigo: 'tipo-no-permitido' });
      expect(almacen.objetos.has(r.rutaOriginal)).toBe(false);
      expect(uso()).toEqual({ bytes: 0, productos: {} });
      expect(db.dato(`tenants/${T}/subidas/${subidaId}`)).toMatchObject({ estado: 'rechazada' });
      expect(db.dato(`tenants/${T}/medios/${subidaId}`)).toBeUndefined();
    });
    it('tipo falsificado: un video subido como foto (y al revés) se rechaza', async () => {
      const a = await subir('foto', MP4);
      await expect(finalizarSubida(deps, { tenantId: T, actor: adm, subidaId: a.subidaId })).rejects.toMatchObject({ codigo: 'tipo-no-permitido' });
      const b = await subir('video', JPG);
      await expect(finalizarSubida(deps, { tenantId: T, actor: adm, subidaId: b.subidaId })).rejects.toMatchObject({ codigo: 'tipo-no-permitido' });
    });
    it('el archivo real mayor a lo reservado se rechaza (no se confía en el tamaño declarado)', async () => {
      const { subidaId } = await subir('foto', JPG, { declarados: 10 });
      await expect(finalizarSubida(deps, { tenantId: T, actor: adm, subidaId })).rejects.toMatchObject({ codigo: 'limite' });
      expect(uso().bytes).toBe(0);
    });
    it('video de 61 s o más se rechaza; 60 s entra', async () => {
      proc.info = { ancho: 1920, alto: 1080, duracionSeg: 61 };
      const a = await subir('video', MP4);
      await expect(finalizarSubida(deps, { tenantId: T, actor: adm, subidaId: a.subidaId })).rejects.toMatchObject({ codigo: 'limite' });
      expect(uso().productos['cam-1']).toBeUndefined();
      proc.info = { ancho: 1920, alto: 1080, duracionSeg: 60 };
      const b = await subir('video', MP4);
      await expect(finalizarSubida(deps, { tenantId: T, actor: adm, subidaId: b.subidaId })).resolves.toBeDefined();
    });
    it('video sin duración legible se rechaza', async () => {
      proc.info = { ancho: 1920, alto: 1080 };
      const a = await subir('video', MP4);
      await expect(finalizarSubida(deps, { tenantId: T, actor: adm, subidaId: a.subidaId })).rejects.toMatchObject({ codigo: 'procesamiento' });
    });
    it('imagen bomba (demasiados píxeles) se rechaza', async () => {
      proc.info = { ancho: 40_000, alto: 40_000 };
      const { subidaId } = await subir('foto', JPG);
      await expect(finalizarSubida(deps, { tenantId: T, actor: adm, subidaId })).rejects.toMatchObject({ codigo: 'limite' });
      expect(uso().bytes).toBe(0);
    });
    it('si el procesador deja EXIF/GPS en una versión, se rechaza todo y se limpia lo publicado', async () => {
      proc.dejarMetadatos = true;
      const { subidaId, r } = await subir('foto', JPG);
      await expect(finalizarSubida(deps, { tenantId: T, actor: adm, subidaId })).rejects.toMatchObject({ codigo: 'procesamiento' });
      expect([...almacen.objetos.keys()].filter((k) => k.includes('/publico/'))).toEqual([]);
      expect(almacen.objetos.has(r.rutaOriginal)).toBe(false);
      expect(uso().bytes).toBe(0);
    });
    it('si el procesador falla, omite versiones del plan o escribe fuera de su carpeta, se rechaza', async () => {
      for (const ajuste of [(): void => { proc.lanza = true; }, (): void => { proc.omitirUna = true; }, (): void => { proc.escribirFuera = true; }]) {
        proc.lanza = proc.omitirUna = proc.escribirFuera = false;
        ajuste();
        const { subidaId } = await subir('foto', JPG);
        await expect(finalizarSubida(deps, { tenantId: T, actor: adm, subidaId })).rejects.toMatchObject({ codigo: 'procesamiento' });
      }
      expect(uso()).toEqual({ bytes: 0, productos: {} });
    });
    it('la cuota refleja el tamaño real si es menor que lo reservado', async () => {
      const { subidaId } = await subir('foto', JPG, { declarados: JPG.length + 500 });
      await finalizarSubida(deps, { tenantId: T, actor: adm, subidaId });
      expect(uso().bytes).toBe(JPG.length);
    });
    it('no finaliza si el archivo no llegó, si venció la reserva ni a nombre de otro tenant', async () => {
      const r = await reservarSubida(deps, { tenantId: T, actor: adm, subidaId: 'subida-zzzz', productoId: 'cam-1', tipo: 'foto', bytes: 10 });
      await expect(finalizarSubida(deps, { tenantId: T, actor: adm, subidaId: 'subida-zzzz' })).rejects.toMatchObject({ codigo: 'no-encontrado' });
      almacen.subir(r.rutaOriginal, JPG);
      await expect(finalizarSubida(deps, { tenantId: T, actor: actor('adm', 'otro'), subidaId: 'subida-zzzz' })).rejects.toMatchObject({ codigo: 'no-autorizado' });
      await expect(finalizarSubida(deps, { tenantId: T, actor: actor('caj'), subidaId: 'subida-zzzz' })).rejects.toMatchObject({ codigo: 'no-autorizado' });
      reloj.ms += LIMITES_CONSOLA.vigenciaReservaMs + 1;
      await expect(finalizarSubida(deps, { tenantId: T, actor: adm, subidaId: 'subida-zzzz' })).rejects.toMatchObject({ codigo: 'estado' });
      await expect(finalizarSubida(deps, { tenantId: T, actor: adm, subidaId: 'subida-nada' })).rejects.toMatchObject({ codigo: 'no-encontrado' });
    });
    it('un archivo vacío se rechaza', async () => {
      const { subidaId } = await subir('foto', new Uint8Array(), { declarados: 5 });
      await expect(finalizarSubida(deps, { tenantId: T, actor: adm, subidaId })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
    });
  });

  describe('borrarMedio', () => {
    it('libera la cuota y el contador, borra original y versiones y lo quita de la ficha', async () => {
      const { subidaId, r } = await subir('foto', JPG);
      const m = await finalizarSubida(deps, { tenantId: T, actor: adm, subidaId });
      db.poner(`tenants/${T}/fichasWeb/cam-1`, { slug: 'x', medios: [{ medioId: subidaId, alt: 'a' }, { medioId: 'otro-medio', alt: 'b' }] });
      await borrarMedio(deps, { tenantId: T, actor: actor('sup'), medioId: subidaId });
      expect(uso()).toEqual({ bytes: 0, productos: {} });
      expect(almacen.objetos.has(r.rutaOriginal)).toBe(false);
      for (const v of m.versiones) expect(almacen.objetos.has(v.ruta)).toBe(false);
      expect(db.dato(`tenants/${T}/medios/${subidaId}`)).toBeUndefined();
      expect(db.dato(`tenants/${T}/subidas/${subidaId}`)).toBeUndefined();
      expect(db.dato(`tenants/${T}/fichasWeb/cam-1`)?.['medios']).toEqual([{ medioId: 'otro-medio', alt: 'b' }]);
      // tras borrar, vuelve a caber una sexta foto
      for (let i = 0; i < 5; i += 1) await subir('foto', JPG);
    });
    it('no borra un medio que usa una sección ni uno inexistente, ni a un cajero', async () => {
      const { subidaId } = await subir('foto', JPG);
      await finalizarSubida(deps, { tenantId: T, actor: adm, subidaId });
      db.poner(`tenants/${T}/sitio/indice`, { secciones: ['nosotros'] });
      db.poner(`tenants/${T}/secciones/nosotros`, { id: 'nosotros', titulo: 'Nosotros', visible: true, bloques: [{ tipo: 'imagen', medioId: subidaId, alt: 'x' }] });
      await expect(borrarMedio(deps, { tenantId: T, actor: adm, medioId: subidaId })).rejects.toMatchObject({ codigo: 'conflicto' });
      await expect(borrarMedio(deps, { tenantId: T, actor: adm, medioId: 'medio-nada' })).rejects.toMatchObject({ codigo: 'no-encontrado' });
      await expect(borrarMedio(deps, { tenantId: T, actor: actor('caj'), medioId: subidaId })).rejects.toMatchObject({ codigo: 'no-autorizado' });
      expect(uso().productos['cam-1']?.fotos).toBe(1);
    });
    it('si Storage falla al borrar, la cuota ya está libre y la limpieza reintenta', async () => {
      const { subidaId } = await subir('foto', JPG);
      const m = await finalizarSubida(deps, { tenantId: T, actor: adm, subidaId });
      almacen.fallaAlBorrar = true;
      await expect(borrarMedio(deps, { tenantId: T, actor: adm, medioId: subidaId })).rejects.toThrow('almacenamiento caído');
      expect(uso().bytes).toBe(0);
      expect(db.dato(`tenants/${T}/subidas/${subidaId}`)).toMatchObject({ estado: 'borrando' });
      almacen.fallaAlBorrar = false;
      const res = await limpiarSubidas({ ...deps, consulta: new ConsultaDoble(db) }, T);
      expect(res.reintentadas).toBe(1);
      expect(almacen.objetos.has(m.versiones[0]?.ruta as string)).toBe(false);
      expect(db.dato(`tenants/${T}/subidas/${subidaId}`)).toBeUndefined();
    });
  });

  describe('limpiarSubidas', () => {
    it('libera las reservas vencidas y deja las vigentes', async () => {
      const vieja = await subir('foto', JPG);
      reloj.ms += LIMITES_CONSOLA.vigenciaReservaMs + 1;
      const nueva = await subir('foto', JPG, { producto: 'cam-2' });
      const res = await limpiarSubidas({ ...deps, consulta: new ConsultaDoble(db) }, T);
      expect(res.vencidas).toBe(1);
      expect(almacen.objetos.has(vieja.r.rutaOriginal)).toBe(false);
      expect(almacen.objetos.has(nueva.r.rutaOriginal)).toBe(true);
      expect(db.dato(`tenants/${T}/subidas/${vieja.subidaId}`)).toBeUndefined();
      expect(uso()).toEqual({ bytes: JPG.length, productos: { 'cam-2': { fotos: 1, videos: 0 } } });
    });
    it('es idempotente', async () => {
      await subir('foto', JPG);
      reloj.ms += LIMITES_CONSOLA.vigenciaReservaMs + 1;
      const d = { ...deps, consulta: new ConsultaDoble(db) };
      await limpiarSubidas(d, T);
      expect(await limpiarSubidas(d, T)).toEqual({ vencidas: 0, reintentadas: 0 });
      expect(uso().bytes).toBe(0);
    });
  });

  it('el contador de productos del núcleo es independiente del uso de medios', () => {
    expect(db.dato(rutaContador(T))).toBeUndefined();
  });
});
