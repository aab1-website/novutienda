import { beforeEach, describe, expect, it } from 'vitest';
import {
  borrarMedio, cupoPortadaDelPlan, finalizarSubida, guardarCarrusel, ID_PORTADA, limpiarSubidas, planificarProcesamiento, reservarSubida, rutaPublicaMedio,
  validarCarrusel, type DepsMedios,
} from '@novutienda/consola';
import { PLANES } from '@novutienda/nucleo';
import { actor, AlmacenDoble, CatalogoDoble, ConsultaDoble, JPG, nuevaDb, ProcesadorSimulado, RelojFijo, T, tenantOk } from './dobles.js';

const adm = actor('adm');
const sup = actor('sup');

describe('fotos propias de la portada (_portada)', () => {
  let db: ReturnType<typeof nuevaDb>;
  let almacen: AlmacenDoble;
  let catalogo: CatalogoDoble;
  let deps: DepsMedios;
  let n = 0;
  const uso = (): { bytes: number; productos: Record<string, { fotos: number; videos: number }> } => (db.dato(`tenants/${T}/uso/medios`) ?? { bytes: 0, productos: {} }) as never;

  async function subir(quien = adm): Promise<string> {
    n += 1;
    const subidaId = `portada-${String(n).padStart(4, '0')}`;
    const r = await reservarSubida(deps, { tenantId: T, actor: quien, subidaId, productoId: ID_PORTADA, tipo: 'portada', bytes: JPG.length });
    almacen.subir(r.rutaOriginal, JPG);
    await finalizarSubida(deps, { tenantId: T, actor: adm, subidaId });
    return subidaId;
  }

  beforeEach(() => {
    db = nuevaDb();
    almacen = new AlmacenDoble();
    const proc = new ProcesadorSimulado(almacen);
    proc.info = { ancho: 1600, alto: 900 };
    catalogo = new CatalogoDoble(db);
    deps = { db, almacen, procesador: proc, catalogo, reloj: new RelojFijo() };
  });

  describe('plan', () => {
    it('el cupo es 8 en base, multimercado y pruebas, y un plan desconocido cae a base', () => {
      for (const p of ['base', 'multimercado', 'pruebas'] as const) expect(PLANES[p].fotosPortada).toBe(8);
      expect(cupoPortadaDelPlan('base')).toBe(8);
      expect(cupoPortadaDelPlan('inventado')).toBe(8);
    });
    it('se procesa como una foto', () => {
      expect(planificarProcesamiento('portada', 1600, 900).items).toEqual(planificarProcesamiento('foto', 1600, 900).items);
    });
  });

  describe('reservarSubida', () => {
    it('adm reserva sin verificar producto: el original va a _portada y se cuenta como foto de _portada', async () => {
      const r = await reservarSubida(deps, { tenantId: T, actor: adm, subidaId: 'subida-0001', productoId: ID_PORTADA, tipo: 'portada', bytes: JPG.length });
      expect(r.rutaOriginal).toBe(`tenants/${T}/privado/originales/_portada/subida-0001`);
      expect(catalogo.txExistencia).toHaveLength(0);
      expect(uso().productos[ID_PORTADA]).toEqual({ fotos: 1, videos: 0 });
      expect(db.dato(`tenants/${T}/subidas/subida-0001`)).toMatchObject({ tipo: 'portada', productoId: '_portada', por: 'u-adm', estado: 'reservada' });
    });
    it('sup y caj son rechazados antes de reservar', async () => {
      for (const rol of ['sup', 'caj'] as const) {
        await expect(reservarSubida(deps, { tenantId: T, actor: actor(rol), subidaId: 'subida-0002', productoId: ID_PORTADA, tipo: 'portada', bytes: 10 })).rejects.toMatchObject({ codigo: 'no-autorizado' });
      }
      expect(uso().bytes).toBe(0);
    });
    it('el destino es fijo: ni un producto usa _portada ni la portada apunta a un producto', async () => {
      const e = { tenantId: T, actor: adm, subidaId: 'subida-0003', bytes: 100 };
      await expect(reservarSubida(deps, { ...e, productoId: ID_PORTADA, tipo: 'foto' })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
      await expect(reservarSubida(deps, { ...e, productoId: ID_PORTADA, tipo: 'video' })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
      await expect(reservarSubida(deps, { ...e, productoId: '_negocio', tipo: 'portada' })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
      await expect(reservarSubida(deps, { ...e, productoId: 'cam-1', tipo: 'portada' })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
      expect(uso().bytes).toBe(0);
    });
    it('tope de 15 MB, como una foto', async () => {
      await expect(reservarSubida(deps, { tenantId: T, actor: adm, subidaId: 'subida-0004', productoId: ID_PORTADA, tipo: 'portada', bytes: 15 * 1024 * 1024 + 1 })).rejects.toMatchObject({ codigo: 'limite' });
    });
    it('el cupo sale del plan: la novena foto se rechaza y borrar una devuelve el lugar', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 8; i += 1) ids.push(await subir());
      expect(uso().productos[ID_PORTADA]?.fotos).toBe(8);
      await expect(subir()).rejects.toMatchObject({ codigo: 'limite' });
      await borrarMedio(deps, { tenantId: T, actor: adm, medioId: ids[0] as string });
      expect(uso().productos[ID_PORTADA]?.fotos).toBe(7);
      await expect(subir()).resolves.toBeDefined();
    });
    it('un plan desconocido en el tenant usa el cupo de base', async () => {
      db.poner(`tenants/${T}`, { ...tenantOk, plan: 'otro' });
      await expect(reservarSubida(deps, { tenantId: T, actor: adm, subidaId: 'subida-0005', productoId: ID_PORTADA, tipo: 'portada', bytes: 10 })).resolves.toBeDefined();
    });
    it('las fotos de portada no gastan el tope de 5 fotos de un producto ni al revés', async () => {
      catalogo.agregar('cam-1');
      for (let i = 0; i < 5; i += 1) {
        const id = `subida-p${String(i)}000`;
        const r = await reservarSubida(deps, { tenantId: T, actor: adm, subidaId: id, productoId: 'cam-1', tipo: 'foto', bytes: 10 });
        almacen.subir(r.rutaOriginal, JPG);
      }
      await expect(reservarSubida(deps, { tenantId: T, actor: adm, subidaId: 'subida-ok01', productoId: ID_PORTADA, tipo: 'portada', bytes: 10 })).resolves.toBeDefined();
    });
  });

  describe('finalizarSubida', () => {
    it('publica las versiones de imagen en _portada y deja un medio foto de _portada', async () => {
      const id = await subir();
      const m = db.dato(`tenants/${T}/medios/${id}`) as { tipo: string; productoId: string; versiones: { clase: string; ruta: string }[] };
      expect(m).toMatchObject({ tipo: 'foto', productoId: '_portada' });
      expect(m.versiones.length).toBeGreaterThan(0);
      for (const v of m.versiones) {
        expect(v.clase).toBe('imagen');
        expect(v.ruta.startsWith(rutaPublicaMedio(T, ID_PORTADA, ''))).toBe(true);
      }
    });
    it('rechaza lo que no es una foto por sus bytes y libera el cupo', async () => {
      const r = await reservarSubida(deps, { tenantId: T, actor: adm, subidaId: 'subida-exe1', productoId: ID_PORTADA, tipo: 'portada', bytes: 16 });
      almacen.subir(r.rutaOriginal, new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
      await expect(finalizarSubida(deps, { tenantId: T, actor: adm, subidaId: 'subida-exe1' })).rejects.toMatchObject({ codigo: 'tipo-no-permitido' });
      expect(uso().productos[ID_PORTADA]?.fotos ?? 0).toBe(0);
    });
    it('un sup no puede finalizarla ni borrarla', async () => {
      const id = await subir();
      await expect(borrarMedio(deps, { tenantId: T, actor: sup, medioId: id })).rejects.toMatchObject({ codigo: 'no-autorizado' });
      const r = await reservarSubida(deps, { tenantId: T, actor: adm, subidaId: 'subida-sup1', productoId: ID_PORTADA, tipo: 'portada', bytes: JPG.length });
      almacen.subir(r.rutaOriginal, JPG);
      await expect(finalizarSubida(deps, { tenantId: T, actor: sup, subidaId: 'subida-sup1' })).rejects.toMatchObject({ codigo: 'no-autorizado' });
    });
    it('una reserva vencida devuelve el cupo', async () => {
      await reservarSubida(deps, { tenantId: T, actor: adm, subidaId: 'subida-venc', productoId: ID_PORTADA, tipo: 'portada', bytes: 10 });
      (deps.reloj as RelojFijo).ms += 7 * 3600_000;
      await limpiarSubidas({ ...deps, consulta: new ConsultaDoble(db) }, T);
      expect(uso().productos[ID_PORTADA]?.fotos ?? 0).toBe(0);
    });
  });

  describe('carrusel', () => {
    const ds = () => ({ db, catalogo, reloj: deps.reloj });
    it('validarCarrusel acepta el medio de una subida de portada', () => {
      expect(validarCarrusel({ plantilla: 'bosque', items: [{ medioId: 'portada-0001', alt: 'Local' }] }).ok).toBe(true);
    });
    it('guardarCarrusel acepta fotos de _portada dentro del cupo del plan', async () => {
      const id = await subir();
      await guardarCarrusel(ds(), { tenantId: T, actor: adm, carrusel: { plantilla: 'bosque', items: [{ medioId: id, alt: 'Local' }] } });
      expect(db.dato(`tenants/${T}/carruseles/bosque`)).toMatchObject({ items: [{ medioId: id }] });
    });
    it('guardarCarrusel rechaza con `limite` más fotos propias que el cupo del plan del tenant', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) ids.push(await subir());
      const topes = PLANES.base as { fotosPortada: number };
      const original = topes.fotosPortada;
      topes.fotosPortada = 2; // plan con cupo menor inyectado (p. ej. uno bajado tras haber subido fotos)
      try {
        await expect(guardarCarrusel(ds(), { tenantId: T, actor: adm, carrusel: { plantilla: 'bosque', items: ids.map((medioId) => ({ medioId, alt: 'x' })) } }))
          .rejects.toMatchObject({ codigo: 'limite' });
        expect(db.dato(`tenants/${T}/carruseles/bosque`)).toBeUndefined();
        await expect(guardarCarrusel(ds(), { tenantId: T, actor: adm, carrusel: { plantilla: 'bosque', items: ids.slice(0, 2).map((medioId) => ({ medioId, alt: 'x' })) } }))
          .resolves.toBeUndefined();
      } finally {
        topes.fotosPortada = original;
      }
    });
    it('un medio de portada en un carrusel guardado se borra y el servidor lo quita del carrusel', async () => {
      const id = await subir();
      await guardarCarrusel(ds(), { tenantId: T, actor: adm, carrusel: { plantilla: 'bosque', items: [{ medioId: id, alt: 'Local' }] } });
      await borrarMedio(deps, { tenantId: T, actor: adm, medioId: id });
      expect(db.dato(`tenants/${T}/medios/${id}`)).toBeUndefined();
      expect(db.dato(`tenants/${T}/carruseles/bosque`)).toMatchObject({ plantilla: 'bosque', items: [] });
    });
  });
});
