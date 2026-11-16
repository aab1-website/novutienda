// Puerto «logo del negocio» (coordinador → Recibos), sin emulador: Firestore en memoria y lector de módulos simulado.
import { describe, expect, it } from 'vitest';
import type { BaseDatosIdentidad } from '@novutienda/nucleo';
import { crearLogoDelNegocio } from '../../plataforma/coordinador/logo-negocio.js';

const T = 'tienda-uno';
const P = `tenants/${T}/publico/medios/_negocio`;
const docLogo = (versiones: readonly { formato: string; lado: number; ruta: string }[]) => ({
  medioId: 'm1', ancho: 512, alto: 512, actualizadoEn: '2026-11-16T10:00:00.000Z', versiones: versiones.map((v) => ({ ...v, bytes: 100 })),
});
const png = { formato: 'png', lado: 512, ruta: `${P}/abc-512.png` };
const webp = { formato: 'webp', lado: 512, ruta: `${P}/abc-512.webp` };

function db(docs: Record<string, unknown>): BaseDatosIdentidad {
  return {
    runTransaction: async (fn) => fn({ get: async (ruta: string) => ({ exists: ruta in docs, data: () => docs[ruta] }) } as never),
  };
}
const con = (docs: Record<string, unknown>, opts: { modulos?: readonly string[] | undefined; base?: string } = {}) =>
  crearLogoDelNegocio({
    db: db(docs), baseMedios: opts.base ?? 'https://medios.ejemplo.test',
    modulosDelTenant: async () => ('modulos' in opts ? (opts.modulos as never) : ['consola', 'recibos'] as never),
  });
const RUTA_DOC = `tenants/${T}/sitio/logo`;

describe('puerto logoDelNegocio', () => {
  it('con logo: base pública + ruta de la versión PNG', async () => {
    expect(await con({ [RUTA_DOC]: docLogo([webp, png]) })(T)).toBe(`https://medios.ejemplo.test/${png.ruta}`);
  });
  it('sin PNG usa la versión WebP', async () => {
    expect(await con({ [RUTA_DOC]: docLogo([webp]) })(T)).toBe(`https://medios.ejemplo.test/${webp.ruta}`);
  });
  it('sin logo subido: null', async () => {
    expect(await con({})(T)).toBeNull();
  });
  it('módulo consola apagado (o tenant sin módulos): null, sin leer el logo', async () => {
    const docs = { [RUTA_DOC]: docLogo([png]) };
    expect(await con(docs, { modulos: ['recibos'] })(T)).toBeNull();
    expect(await con(docs, { modulos: undefined })(T)).toBeNull();
  });
  it('ruta fuera del prefijo del logo del negocio: null', async () => {
    for (const ruta of [`tenants/otro/publico/medios/_negocio/x.png`, `${`tenants/${T}/publico/medios/p1`}/x.png`, `${P}/../p1/x.png`, `${P}/`, 'x.png', `${P}/a%2e.png`, `${P}/a.png?x=1`, `${P}/a.png#f`, `${P}/a\\b.png`, `${P}/sub/a.png`, `${P}/a b.png`]) {
      expect(await con({ [RUTA_DOC]: docLogo([{ formato: 'png', lado: 512, ruta }]) })(T)).toBeNull();
    }
  });
  it('la base de medios con o sin barra final da la misma URL; base vacía: null', async () => {
    const docs = { [RUTA_DOC]: docLogo([png]) };
    const esperado = `https://medios.ejemplo.test/${png.ruta}`;
    expect(await con(docs, { base: 'https://medios.ejemplo.test/' })(T)).toBe(esperado);
    expect(await con(docs, { base: 'https://medios.ejemplo.test//' })(T)).toBe(esperado);
    expect(await con(docs, { base: '' })(T)).toBeNull();
  });
  it('si la lectura falla: null y aviso sin datos personales, nunca lanza', async () => {
    const avisos: unknown[][] = [];
    const roto = crearLogoDelNegocio({
      db: { runTransaction: async () => { throw new Error('boom'); } }, baseMedios: 'https://m.test', modulosDelTenant: async () => ['consola'],
      avisar: (...a) => avisos.push(a),
    });
    expect(await roto(T)).toBeNull();
    expect(avisos).toHaveLength(1);
    const falla = crearLogoDelNegocio({ db: db({}), baseMedios: 'https://m.test', modulosDelTenant: async () => { throw new Error('x'); } });
    expect(await falla(T)).toBeNull();
  });
  it('tenant inválido: null', async () => {
    expect(await con({})('../x')).toBeNull();
  });
});
