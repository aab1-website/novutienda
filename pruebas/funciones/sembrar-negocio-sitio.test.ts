// Siembra de `sitio/negocio` (`plataforma/operador/negocio-sitio.ts` y `scripts/sembrar-negocio-sitio.mjs`).
// Parte 1: lógica con dobles en memoria. Parte 2: el script real contra el emulador (solo con `pnpm test:funciones`).
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { TransaccionIdentidad } from '@novutienda/nucleo';
import { evaluarNegocioSitio } from '../../plataforma/registro.js';
import { sembrarNegocioSitio, type BaseDatosSiembra, type TransaccionSiembra } from '../../plataforma/operador/negocio-sitio.js';
import { DobleDb } from '../limites/doble-db.js';
import { accion, crearUsuario, hayEmulador, herramientas, sembrarTenant, unico, type Herramientas } from './ayudas.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

const IGNORADAS = { mercados: ['bo'], mercadoInicial: 'bo', logo: 'x.png', whatsappTienda: '59170000000' };
const negocio = (): Record<string, unknown> => ({
  nombre: 'Tienda Ejemplo', lema: 'Lema de ejemplo', telefono: '22223333', correo: 'hola@ejemplo.test', direccion: 'Calle Falsa 123', horario: 'Lunes a viernes',
  enlacesPermitidos: ['ejemplo.test'],
  portada: { insignia: 'Nuevo', titulo: ['Uno', 'Dos', 'Tres'], texto: 'Texto de portada', textoBotonCatalogo: 'Ver', textoBotonConsulta: 'Consultar' },
  beneficios: [{ icono: 'escudo', titulo: { texto: 'Garantía', confirmada: true }, descripcion: 'Descripción' }],
  identidad: {
    etiqueta: 'Nosotros', titulo: 'Quiénes somos', texto: 'Texto', foto: null, cifra: null,
    valores: [{ icono: 'check', titulo: 'Valor', texto: 'Texto del valor' }], sello: { texto: 'Sello', confirmada: false },
  },
  textoPrivacidad: ['Párrafo uno'],
  categorias: { camaras: { nombre: 'Cámaras', icono: 'cuadricula' } },
  destacados: ['cam-1'],
});

const T1 = 'tienda-x';
const RUTA = `tenants/${T1}/sitio/negocio`;
const reloj = { ahora: () => Date.parse('2026-11-23T12:00:00Z') };

function montaje() {
  const doble = new DobleDb();
  const db: BaseDatosSiembra = {
    runTransaction: (fn) =>
      doble.runTransaction((tx: TransaccionIdentidad) =>
        fn({
          get: tx.get.bind(tx) as unknown as TransaccionSiembra['get'],
          set: (ruta, datos) => tx.set(ruta, { ...datos }),
          create: tx.create.bind(tx),
          nuevoId: tx.nuevoId.bind(tx),
          marcaTiempoServidor: tx.marcaTiempoServidor.bind(tx),
        }),
      ),
  };
  const correr = (crudo: unknown, aplicar: boolean, tenant = T1) => sembrarNegocioSitio({ db, reloj, evaluar: evaluarNegocioSitio }, { tenant, crudo, aplicar });
  return { doble, correr };
}

describe('sembrarNegocioSitio', () => {
  it('en seco no escribe ni audita', async () => {
    const m = montaje();
    expect(await m.correr({ ...negocio(), ...IGNORADAS }, false)).toMatchObject({ estado: 'listo', aplicado: false });
    expect(m.doble.dato(RUTA)).toBeUndefined();
    expect(m.doble.coleccion(`tenants/${T1}/auditoria`)).toEqual([]);
  });

  it('con aplicar crea la versión 1, sin las 4 claves ignoradas, y audita solo nombres de campo', async () => {
    const m = montaje();
    const r = await m.correr({ ...negocio(), ...IGNORADAS }, true);
    expect(r).toMatchObject({ estado: 'listo', aplicado: true });
    const d = m.doble.dato(RUTA) ?? {};
    expect(d).toMatchObject({ version: 1, por: 'siembra', actualizadoEn: '2026-11-23T12:00:00.000Z', nombre: 'Tienda Ejemplo' });
    for (const k of Object.keys(IGNORADAS)) expect(d).not.toHaveProperty(k);
    const aud = m.doble.coleccion(`tenants/${T1}/auditoria`);
    expect(aud).toEqual([expect.objectContaining({ accion: 'sitio.negocio.sembrar', uid: 'operador', ruta: RUTA })]);
    const resumen = JSON.stringify(aud);
    expect(resumen).not.toContain('Tienda Ejemplo');
    expect(resumen).not.toContain('Calle Falsa');
    expect(m.doble.dato(`tenants/${T1}/publicado/negocio`)).toBeUndefined();
  });

  it('una segunda corrida devuelve ya-existe y no escribe', async () => {
    const m = montaje();
    await m.correr(negocio(), true);
    const antes = JSON.stringify(m.doble.dato(RUTA));
    expect(await m.correr({ ...negocio(), nombre: 'Otro' }, true)).toEqual({ estado: 'ya-existe' });
    expect(JSON.stringify(m.doble.dato(RUTA))).toBe(antes);
    expect(m.doble.coleccion(`tenants/${T1}/auditoria`)).toHaveLength(1);
  });

  it('un JSON inválido devuelve solo rutas, sin valores, y no escribe', async () => {
    const m = montaje();
    const r = await m.correr({ ...negocio(), nombre: 'VALOR-SECRETO-'.repeat(20), clave_rara: 'otro-valor' }, true);
    expect(r.estado).toBe('invalido');
    expect(JSON.stringify(r)).not.toContain('VALOR-SECRETO');
    expect(JSON.stringify(r)).not.toContain('otro-valor');
    expect(m.doble.dato(RUTA)).toBeUndefined();
  });

  it('los datos que cumplen heredado pero no estricto se siembran con aviso por ruta', async () => {
    const m = montaje();
    const r = await m.correr({ ...negocio(), correo: 'sin-forma' }, false);
    expect(r).toMatchObject({ estado: 'listo', avisos: ['correo'] });
  });

  it('rechaza un tenant inválido', async () => {
    await expect(montaje().correr(negocio(), true, 'a/b')).rejects.toThrow(/identificador/);
  });
});

describe.skipIf(!hayEmulador)('scripts/sembrar-negocio-sitio.mjs contra el emulador', () => {
  const script = resolve(import.meta.dirname, '../../scripts/sembrar-negocio-sitio.mjs');
  const A = 'siembra-neg';
  let h: Herramientas;
  const emu = Object.fromEntries(Object.entries(process.env).filter(([k]) => /EMULATOR_HOST$/.test(k))) as Record<string, string>;
  const correr = (entrada: string, extra: string[] = [], tenant = A) => {
    const r = spawnSync(process.execPath, [script, tenant, '--proyecto', 'demo-pruebas', ...extra], {
      env: { PATH: process.env['PATH'] ?? '', GOOGLE_CLOUD_PROJECT: 'demo-pruebas', NOVUTIENDA_AMBIENTE: 'emulador', ...emu },
      input: entrada,
      encoding: 'utf8',
      cwd: resolve(import.meta.dirname, '../..'),
    });
    return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
  };
  const doc = () => h.firestore.doc(`tenants/${A}/sitio/negocio`).get();

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, A, {});
  });

  it('en seco no escribe; --aplicar crea la versión 1 y audita; la segunda corrida da ya-existe (código 2)', async () => {
    const json = JSON.stringify({ ...negocio(), ...IGNORADAS });
    const seco = correr(json);
    expect(seco.codigo, seco.salida).toBe(0);
    expect((await doc()).exists).toBe(false);

    const ap = correr(json, ['--aplicar']);
    expect(ap.codigo, ap.salida).toBe(0);
    expect(ap.salida).not.toContain('Tienda Ejemplo');
    const d = (await doc()).data() ?? {};
    expect(d).toMatchObject({ version: 1, por: 'siembra', nombre: 'Tienda Ejemplo' });
    for (const k of Object.keys(IGNORADAS)) expect(d).not.toHaveProperty(k);
    const aud = await h.firestore.collection(`tenants/${A}/auditoria`).where('accion', '==', 'sitio.negocio.sembrar').get();
    expect(aud.size).toBe(1);
    expect((await h.firestore.doc(`tenants/${A}/publicado/negocio`).get()).exists).toBe(false);

    const otra = correr(json, ['--aplicar']);
    expect(otra.codigo).toBe(2);
    expect(otra.salida).toMatch(/ya-existe/);

    // La consola lo lee como versión 1 (callable real).
    const adm = await crearUsuario(h, { rol: 'adm', tenant: A });
    const r = await accion('consola', 'leerNegocioSitio', {}, adm.token, A);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.resultado).toMatchObject({ version: 1, negocio: { nombre: 'Tienda Ejemplo' } });
  });

  it('un JSON inválido sale con código 1 sin valores; JSON roto también', async () => {
    const B = unico('sn').slice(0, 20);
    await sembrarTenant(h, B, {});
    const r = correr(JSON.stringify({ ...negocio(), nombre: 'VALOR-SECRETO', clave_rara: 'otro-valor' }), ['--aplicar'], B);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/nombre|clave_rara|negocio/);
    expect(r.salida).not.toContain('VALOR-SECRETO');
    expect(r.salida).not.toContain('otro-valor');
    const roto = correr('{"nombre": "VALOR-SECRETO"', [], B);
    expect(roto.codigo).toBe(1);
    expect(roto.salida).not.toContain('VALOR-SECRETO');
    expect((await h.firestore.doc(`tenants/${B}/sitio/negocio`).get()).exists).toBe(false);
  });

  it('rechaza producción y entradas mayores de 256 KB', () => {
    const r = spawnSync(process.execPath, [script, A, '--proyecto', 'proyecto-stg'], {
      env: { PATH: process.env['PATH'] ?? '', GOOGLE_CLOUD_PROJECT: 'proyecto-stg', NOVUTIENDA_AMBIENTE: 'staging', GCP_PROJECT_ID_STAGING: 'proyecto-stg', GCP_PROJECT_ID_PROD: 'proyecto-stg' },
      input: '{}', encoding: 'utf8',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/producción/);
    const grande = correr(JSON.stringify({ x: 'a'.repeat(300 * 1024) }));
    expect(grande.codigo).toBe(1);
    expect(grande.salida).toMatch(/256 KB/);
  });
});
