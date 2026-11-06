// Matriz negativa de `storage.rules` (generado desde el registro) contra el emulador de Storage.
// Casos: pruebas/reglas/matriz-almacenamiento.ts (puro). Aquí solo se ejecutan, y se comprueba con mutantes
// que la matriz detecta cada ampliación de permisos.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteObject, getBytes, listAll, ref, updateMetadata, uploadBytes } from 'firebase/storage';
import { manifiestosEnOrden } from '../../plataforma/registro.js';
import { construirCasosAlmacenamiento, type CasoAlmacenamiento } from '../reglas/matriz-almacenamiento.js';
import { hayEmulador, PROYECTO } from './ayudas.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const [hostFs = '127.0.0.1', puertoFs = '8241'] = (process.env['FIRESTORE_EMULATOR_HOST'] ?? '127.0.0.1:8241').split(':');
const [hostSt = '127.0.0.1', puertoSt = '8243'] = (process.env['FIREBASE_STORAGE_EMULATOR_HOST'] ?? '127.0.0.1:8243').split(':');

const REGLAS_FIRESTORE = readFileSync('firestore.rules', 'utf8');
const REGLAS_STORAGE = readFileSync('storage.rules', 'utf8');
const bytes = (n: number): Uint8Array => new Uint8Array(n).fill(0xff);
const T = 'A';

type Ctx = ReturnType<RulesTestEnvironment['authenticatedContext']>;

const padre = (ruta: string): string => ruta.split('/').slice(0, -1).join('/');
const hermana = (ruta: string): string => `${padre(ruta)}/nuevo-${ruta.split('/').at(-1) ?? 'x'}`;
const completa = (t: string, ruta: string): string => `tenants/${t}/${ruta}`;

async function abrir(reglasStorage: string): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROYECTO,
    firestore: { rules: REGLAS_FIRESTORE, host: hostFs, port: Number(puertoFs) },
    storage: { rules: reglasStorage, host: hostSt, port: Number(puertoSt) },
  });
}

async function sembrarObjeto(env: RulesTestEnvironment, ruta: string): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), ruta), bytes(16), { contentType: 'image/jpeg' });
  });
}

async function reservar(env: RulesTestEnvironment, id: string, por: string, producto = 'p1'): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`tenants/${T}/subidas/${id}`).set({
      id, productoId: producto, tipo: 'foto', bytes: 1024 * 1024, estado: 'reservada', por, venceEn: Date.now() + 3_600_000,
    });
  });
}

async function sembrarTodo(env: RulesTestEnvironment, casos: readonly CasoAlmacenamiento[]): Promise<void> {
  await env.clearStorage();
  for (const ruta of new Set(casos.map((c) => completa(c.tenant, c.ruta)))) await sembrarObjeto(env, ruta);
}

function contexto(env: RulesTestEnvironment, c: CasoAlmacenamiento, indice: number): Ctx {
  const { token } = c.persona.sujeto;
  return (token === null ? env.unauthenticatedContext() : env.authenticatedContext(`u-persona-${indice}`, token)) as Ctx;
}

async function ejecutar(ctx: Ctx, c: CasoAlmacenamiento): Promise<boolean> {
  const st = ctx.storage();
  const ruta = completa(c.tenant, c.ruta);
  try {
    switch (c.operacion) {
      case 'get': await assertSucceeds(getBytes(ref(st, ruta))); break;
      case 'list': await assertSucceeds(listAll(ref(st, padre(ruta)))); break;
      case 'create': await assertSucceeds(uploadBytes(ref(st, hermana(ruta)), bytes(16), { contentType: 'image/jpeg' })); break;
      case 'update': await assertSucceeds(updateMetadata(ref(st, ruta), { customMetadata: { a: 'b' } })); break;
      case 'delete': await assertSucceeds(deleteObject(ref(st, ruta))); break;
    }
    return true;
  } catch {
    return false;
  }
}

async function correrMatriz(env: RulesTestEnvironment, casos: readonly CasoAlmacenamiento[]): Promise<string[]> {
  const fallos: string[] = [];
  await sembrarTodo(env, casos);
  const personas = [...new Set(casos.map((c) => c.persona))];
  for (const c of casos) {
    const permitido = await ejecutar(contexto(env, c, personas.indexOf(c.persona)), c);
    if (permitido !== c.esperado) {
      fallos.push(`${c.descripcion} [${c.ruta}]: esperado ${c.esperado ? 'permitido' : 'denegado'}, fue ${permitido ? 'permitido' : 'denegado'}`);
    }
    if (permitido && c.operacion === 'delete') await sembrarObjeto(env, completa(c.tenant, c.ruta));
  }
  return fallos;
}

const sesion = (rol: string): Record<string, unknown> => ({
  email_verified: true, firebase: { sign_in_provider: 'password' }, pl: { t: { [T]: rol }, v: 1 },
});
const subir = (ctx: Ctx, ruta: string): Promise<unknown> => uploadBytes(ref(ctx.storage(), ruta), bytes(1024), { contentType: 'image/jpeg' });

/** Comprobaciones directas de lo que la matriz no cubre (creación con reserva real, ruta fuera de módulos). Todas esperan «denegado». */
async function correrDirectas(env: RulesTestEnvironment): Promise<string[]> {
  const fallos: string[] = [];
  const debeFallar = async (nombre: string, op: Promise<unknown>): Promise<void> => {
    try {
      await assertFails(op);
    } catch {
      fallos.push(`${nombre}: esperado denegado, fue permitido`);
    }
  };
  await env.clearStorage();
  await reservar(env, 'd-caj', 'u-caj');
  await debeFallar('caj con reserva propia crea original', subir(env.authenticatedContext('u-caj', sesion('caj')), completa(T, 'privado/originales/p1/d-caj')));
  await reservar(env, 'd-ajena', 'u-otro');
  await debeFallar('sup con la reserva de otra persona crea original', subir(env.authenticatedContext('u-sup', sesion('sup')), completa(T, 'privado/originales/p1/d-ajena')));
  await reservar(env, 'd-existe', 'u-sup');
  await sembrarObjeto(env, completa(T, 'privado/originales/p1/d-existe'));
  await debeFallar('sup reemplaza un original existente', subir(env.authenticatedContext('u-sup', sesion('sup')), completa(T, 'privado/originales/p1/d-existe')));
  await debeFallar('adm escribe en publico', subir(env.authenticatedContext('u-adm', sesion('adm')), completa(T, 'publico/z/nuevo.jpg')));
  await debeFallar('anonimo escribe en publico', subir(env.unauthenticatedContext() as Ctx, completa(T, 'publico/z/nuevo2.jpg')));
  await debeFallar('adm escribe fuera de los módulos', subir(env.authenticatedContext('u-adm', sesion('adm')), 'cualquier/ruta.jpg'));
  await sembrarObjeto(env, 'cualquier/leer.jpg');
  await debeFallar('anonimo lee fuera de los módulos', getBytes(ref((env.unauthenticatedContext() as Ctx).storage(), 'cualquier/leer.jpg')));
  return fallos;
}

describe.skipIf(!hayEmulador)('matriz negativa de storage.rules (emulador)', () => {
  const casos = construirCasosAlmacenamiento(manifiestosEnOrden());
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await abrir(REGLAS_STORAGE);
  });
  afterAll(async () => {
    await env.cleanup();
  });

  it('tiene casos y cada ruta con lectura pública abre get/list', () => {
    expect(casos.length).toBeGreaterThan(0);
    const positivos = casos.filter((c) => c.esperado);
    expect(positivos.length).toBeGreaterThan(0);
    expect(positivos.every((c) => c.ruta.startsWith('publico/') && (c.operacion === 'get' || c.operacion === 'list'))).toBe(true);
    console.info(`[matriz-almacenamiento] casos=${casos.length} positivos=${positivos.length}`);
  });

  it('ejecuta todos los casos y coincide con lo esperado', async () => {
    const inicio = Date.now();
    const fallos = await correrMatriz(env, casos);
    console.info(`[matriz-almacenamiento] ejecutados=${casos.length} fallos=${fallos.length} ms=${Date.now() - inicio}`);
    expect(fallos).toEqual([]);
  });

  it('positivas: publico/x/y.jpg legible y listable por anónimo y por los tres roles', async () => {
    const lecturas = casos.filter((c) => c.esperado && c.ruta === 'publico/x/y.jpg');
    const nombres = new Set(lecturas.map((c) => c.persona.nombre));
    for (const n of ['sin autenticar', 'caj@A', 'sup@A', 'adm@A']) expect(nombres.has(n), n).toBe(true);
    await sembrarTodo(env, casos);
    const personas = [...new Set(casos.map((c) => c.persona))];
    for (const c of lecturas) expect(await ejecutar(contexto(env, c, personas.indexOf(c.persona)), c), c.descripcion).toBe(true);
  });

  it('las comprobaciones directas pasan con las reglas reales', async () => {
    expect(await correrDirectas(env)).toEqual([]);
  });

  describe('mutantes: cada ampliación de permisos es detectada', () => {
    const mutar = (reglas: string, de: string | RegExp, a: string): string => {
      const mutada = reglas.replace(de, a);
      expect(mutada).not.toBe(reglas);
      return mutada;
    };
    const mutantes: [string, () => string][] = [
      ['editor acepta caj', () => mutar(REGLAS_STORAGE, "in ['sup', 'adm']", "in ['caj', 'sup', 'adm']")],
      ['sin r.por == request.auth.uid', () => mutar(REGLAS_STORAGE, /\n\s*&& r\.por == request\.auth\.uid/, '')],
      ['sin resource == null', () => mutar(REGLAS_STORAGE, 'resource == null && ', '')],
      ['escritura abierta en publico', () => mutar(REGLAS_STORAGE, /(publico\/\{ruta=\*\*\} \{\s*allow read: if true;\s*allow write: if )false/, '$1true')],
      ['negación final abierta', () => {
        const i = REGLAS_STORAGE.lastIndexOf('allow read, write: if false;');
        expect(i).toBeGreaterThan(0);
        const mutada = `${REGLAS_STORAGE.slice(0, i)}allow read, write: if true;${REGLAS_STORAGE.slice(i + 'allow read, write: if false;'.length)}`;
        expect(mutada).not.toBe(REGLAS_STORAGE);
        return mutada;
      }],
    ];
    it.each(mutantes)('%s', async (_nombre, fabricar) => {
      const e = await abrir(fabricar());
      try {
        const fallos = [...(await correrMatriz(e, casos)), ...(await correrDirectas(e))];
        console.info(`[mutante] ${_nombre}: fallos detectados=${fallos.length}`);
        expect(fallos.length).toBeGreaterThan(0);
      } finally {
        await e.cleanup();
      }
    });
  });
});
