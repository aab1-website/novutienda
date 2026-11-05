// Pruebas de reglas contra el emulador de Firestore (npm run test:rules).
// Sin emulador se omiten, salvo que REGLAS_EXIGIR_EMULADOR=1 (test:rules), caso
// en el que fallan: una suite omitida no puede pasar por verde en ese comando.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { manifiestosEnOrden } from '../../plataforma/registro.js';
import { generarReglas, type ManifiestoReglas } from '../../scripts/generar-reglas.mjs';
import { construirCasos, ejecutarMatriz, type Caso } from './matriz.js';

const host = process.env['FIRESTORE_EMULATOR_HOST'];
const exigir = process.env['REGLAS_EXIGIR_EMULADOR'] === '1';
const PROYECTO = 'demo-pruebas';

if (exigir && host === undefined) {
  describe('emulador', () => {
    it('está disponible', () => {
      throw new Error('REGLAS_EXIGIR_EMULADOR=1 pero FIRESTORE_EMULATOR_HOST no está definido');
    });
  });
}

const sintetico: ManifiestoReglas = {
  id: 'demo',
  colecciones: [
    { ruta: 'productos', lectura: ['caj', 'sup', 'adm'], escritura: ['sup', 'adm'] },
    { ruta: 'ajustes', lectura: ['sup'], escritura: ['adm'] },
    { ruta: 'ventas', lectura: ['sup'], escritura: 'servidor' },
  ],
};

async function entorno(reglas: string): Promise<RulesTestEnvironment> {
  const [h, p] = (host ?? '127.0.0.1:8241').split(':');
  return initializeTestEnvironment({
    projectId: PROYECTO,
    firestore: { rules: reglas, host: h ?? '127.0.0.1', port: Number(p) },
  });
}

describe.skipIf(host === undefined)('reglas de Firestore contra el emulador', () => {
  const manifiestos: readonly ManifiestoReglas[] = manifiestosEnOrden();
  const reglasReales = readFileSync('firestore.rules', 'utf8');
  let env: RulesTestEnvironment | undefined;

  async function con(reglas: string): Promise<RulesTestEnvironment> {
    if (env !== undefined) await env.cleanup();
    env = await entorno(reglas);
    return env;
  }

  afterAll(async () => {
    await env?.cleanup();
  });

  describe('firestore.rules real', () => {
    let casos: Caso[];
    beforeAll(async () => {
      casos = construirCasos(manifiestos);
      await con(reglasReales);
    });

    it('la matriz completa del registro se cumple', async () => {
      expect(casos.length).toBeGreaterThan(100);
      expect(await ejecutarMatriz(env!, casos)).toEqual([]);
    }, 300_000);

    it('nadie borra auditoria, ni con el rol más alto', async () => {
      const aud = construirCasos(manifiestos).filter((c) => c.ruta === 'auditoria' && c.operacion === 'delete');
      expect(aud.length).toBeGreaterThan(0);
      expect(aud.every((c) => !c.esperado)).toBe(true);
      expect(await ejecutarMatriz(env!, aud)).toEqual([]);
    });
  });

  describe('manifiesto sintético con escritura por roles (positivas de escritura)', () => {
    it('la matriz se cumple', async () => {
      const m = [sintetico];
      await con(generarReglas(m));
      const casos = construirCasos(m);
      expect(casos.some((c) => c.esperado && c.operacion === 'create')).toBe(true);
      expect(await ejecutarMatriz(env!, casos)).toEqual([]);
    }, 300_000);
  });

  describe('prueba de mutación: la suite detecta reglas ampliadas', () => {
    const mutantes: [string, (t: string) => string][] = [
      ['escritura abierta en una colección servidor', (t) => t.replace('allow write: if false;', 'allow write: if true;')],
      ['lectura abierta en una colección sin lectores', (t) => t.replace(/(eventos\/\{id\} \{\n\s+)allow read: if false;/, '$1allow read: if true;')],
      ['negación final reemplazada por permiso', (t) => t.replace(/(\{document=\*\*\} \{\n\s+)allow read, write: if false;/, '$1allow read, write: if true;')],
      ['proveedor ignorado', (t) => t.replace("&& proveedor() == 'password'", '')],
      ['correo verificado ignorado', (t) => t.replace("&& request.auth.token.get('email_verified', false) == true", '')],
      ['rol sin comprobar', (t) => t.replace('&& rolEn(tenantId) in roles', '&& rolEn(tenantId) != \'\'')],
    ];

    it.each(mutantes)('detecta: %s', async (_nombre, mutar) => {
      const mutada = mutar(reglasReales);
      expect(mutada).not.toBe(reglasReales);
      await con(mutada);
      const fallos = await ejecutarMatriz(env!, construirCasos(manifiestos), true);
      expect(fallos.length).toBeGreaterThan(0);
    }, 300_000);
  });
});
