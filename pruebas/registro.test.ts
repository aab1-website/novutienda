import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  crearRegistro,
  ErrorRegistro,
  manifiestoNucleo,
  validarClaim,
  validarSobre,
  type ColeccionManifiesto,
  type ManifiestoModulo,
} from '@novutienda/nucleo';
import { manifiestosEnOrden, registroPlataforma } from '../plataforma/registro.js';

const mod = (id: string, dependeDe: string[] = [], rutas: string[] = []): ManifiestoModulo => ({
  id,
  version: '1.0.0',
  dependeDe,
  submodulos: [],
  colecciones: rutas.map((ruta) => ({ ruta, lectura: ['adm'], escritura: 'servidor' })),
  emite: [],
  consume: [],
});

describe('registro de módulos', () => {
  it('el núcleo y los cinco módulos están registrados; el núcleo tiene sus siete colecciones', () => {
    expect(registroPlataforma.listar().map((m) => m.id).sort()).toEqual(['consola', 'inventarios', 'nucleo', 'panel', 'pos', 'recibos', 'website']);
    expect(manifiestoNucleo.colecciones.map((c) => c.ruta)).toEqual(['miembros', 'auditoria', 'eventos', 'procesados', 'contadores', 'cotizaciones', 'config']);
    const aud = manifiestoNucleo.colecciones.find((c) => c.ruta === 'auditoria');
    expect(aud?.lectura).toEqual(['sup', 'adm']);
    expect(manifiestoNucleo.colecciones.every((c) => c.escritura === 'servidor')).toBe(true);
  });

  it('ordena topológicamente', () => {
    const r = crearRegistro<ManifiestoModulo>();
    r.registrar(mod('pos', ['inventarios', 'nucleo']));
    r.registrar(mod('inventarios', ['nucleo']));
    r.registrar(mod('nucleo'));
    const orden = r.ordenTopologico();
    expect(orden.indexOf('nucleo')).toBeLessThan(orden.indexOf('inventarios'));
    expect(orden.indexOf('inventarios')).toBeLessThan(orden.indexOf('pos'));
  });

  it('falla en ciclos y en dependencias ausentes', () => {
    const ciclo = crearRegistro<ManifiestoModulo>();
    ciclo.registrar(mod('a', ['b']));
    ciclo.registrar(mod('b', ['a']));
    expect(() => ciclo.ordenTopologico()).toThrow(/Ciclo/);

    const ausente = crearRegistro<ManifiestoModulo>();
    ausente.registrar(mod('a', ['zzz']));
    expect(() => ausente.ordenTopologico()).toThrow(/ausente/);
  });

  it('falla con rutas duplicadas, módulos repetidos y manifiestos inválidos', () => {
    const r = crearRegistro<ManifiestoModulo>();
    r.registrar(mod('a', [], ['x', 'y']));
    expect(() => r.registrar(mod('b', [], ['y']))).toThrow(/duplicada/);
    expect(() => r.registrar(mod('c', [], ['z', 'z']))).toThrow(/duplicada/);
    expect(() => r.registrar(mod('a'))).toThrow(/ya registrado/);
    expect(() => r.registrar({ ...mod('d'), version: '1.0' })).toThrow(ErrorRegistro);
    expect(() => r.registrar(mod('Mala'))).toThrow(/Id/);
    expect(() => r.registrar(mod('e', ['e']))).toThrow(/sí mismo/);
    expect(() => r.registrar(mod('f', [], ['/abs']))).toThrow(/Ruta inválida/);
    expect(() => r.registrar({ ...mod('g'), colecciones: [{ ruta: 'g', lectura: ['xxx' as never], escritura: 'servidor' }] })).toThrow(/Rol/);
    expect(() => r.registrar({ ...mod('h'), colecciones: [{ ruta: 'h', lectura: [], escritura: ['xxx' as never] }] })).toThrow(/Rol/);
    expect(() => r.registrar({ ...mod('i'), colecciones: [{ ruta: 'i', lectura: [], escritura: ['adm'], limite: 'otro' as never }] })).toThrow(/Límite/);
    expect(r.rutas()).toEqual(['x', 'y']);
  });

  it('tipos.ts y registro.ts no tienen ninguna importación', () => {
    for (const f of ['tipos.ts', 'registro.ts']) {
      const codigo = readFileSync(fileURLToPath(new URL(`../paquetes/nucleo/src/registro/${f}`, import.meta.url)), 'utf8');
      expect(codigo, f).not.toMatch(/^\s*import\b/m);
      expect(codigo, f).not.toMatch(/\bimport\s*\(/);
      expect(codigo, f).not.toMatch(/\brequire\s*\(/);
      expect(codigo, f).not.toMatch(/^\s*export\s+.*\bfrom\b/m);
    }
  });
});

describe('contratos congelados', () => {
  it('valida el claim', () => {
    expect(validarClaim({ pl: { t: { casa: 'adm' }, p: true, v: 1 } }).ok).toBe(true);
    expect(validarClaim({ pl: { t: { casa: 'adm' }, v: 1 } }).ok).toBe(true);
    expect(validarClaim({}).ok).toBe(false);
    expect(validarClaim({ pl: { t: { casa: 'root' }, v: 1 } }).ok).toBe(false);
    expect(validarClaim({ pl: { t: {}, p: false, v: 1 } }).ok).toBe(false);
    expect(validarClaim({ pl: { t: {}, v: 0 } }).ok).toBe(false);
    expect(validarClaim({ pl: { t: {}, v: 1, z: 1 } }).ok).toBe(false);
    expect(validarClaim({ pl: { t: '', v: 1 } }).ok).toBe(false);
    expect(validarClaim({ pl: { t: { '': 'adm' }, v: 1 } }).ok).toBe(false);
  });

  it('rechaza un claim de 1000 bytes o más', () => {
    const t = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`tenant-numero-${i}`, 'caj']));
    expect(validarClaim({ pl: { t, v: 1 } }).ok).toBe(false);
  });

  it('valida el sobre de eventos', () => {
    const base = {
      id: 'e1', tipo: 'x.y', version: 1, tenantId: 't', origen: 'nucleo',
      ocurridoEn: '2026-11-04T10:00:00Z', claveIdempotencia: 'k', datos: {},
    };
    expect(validarSobre(base).ok).toBe(true);
    expect(validarSobre({ ...base, version: 2 }).ok).toBe(false);
    expect(validarSobre({ ...base, id: '' }).ok).toBe(false);
    expect(validarSobre({ ...base, ocurridoEn: 'ayer' }).ok).toBe(false);
    expect(validarSobre({ ...base, datos: undefined }).ok).toBe(false);
    expect(validarSobre(null).ok).toBe(false);
  });
});

describe('colecciones de raíz con el registro real', () => {
  // Copia del registro real: registroPlataforma es global y no se debe mutar.
  const copiaReal = () => {
    const r = crearRegistro<ManifiestoModulo>();
    for (const m of manifiestosEnOrden()) r.registrar(m);
    return r;
  };
  const extra = (c: Partial<ColeccionManifiesto> & { ruta: string }): ManifiestoModulo => ({
    ...mod('extra'),
    colecciones: [{ ambito: 'raiz', lectura: [], escritura: 'servidor', ...c }],
  });

  it('rechaza raíces inválidas: dos segmentos, tenants, roles de lectura, escritura por roles y límite', () => {
    expect(() => copiaReal().registrar(extra({ ruta: 'a/b' }))).toThrow(ErrorRegistro);
    expect(() => copiaReal().registrar(extra({ ruta: 'tenants' }))).toThrow(ErrorRegistro);
    expect(() => copiaReal().registrar(extra({ ruta: 'rz', lectura: ['adm'] }))).toThrow(ErrorRegistro);
    expect(() => copiaReal().registrar(extra({ ruta: 'rz', escritura: ['adm'] }))).toThrow(ErrorRegistro);
    expect(() => copiaReal().registrar(extra({ ruta: 'rz', limite: 'usuarios' }))).toThrow(ErrorRegistro);
  });

  it('una raíz válida se registra y aparece en rutas() junto a las de tenant', () => {
    const r = copiaReal();
    r.registrar(extra({ ruta: 'raizprueba' }));
    const rutas = r.rutas();
    expect(rutas).toContain('raizprueba');
    expect(rutas).toContain('miembros');
  });

  it('hoy ningún manifiesto registrado declara ambito raiz', () => {
    // L1-b cambiará esta aserción a «solo nucleo y plataforma declaran ámbito raíz».
    const conRaiz = registroPlataforma
      .listar()
      .filter((m) => m.colecciones.some((c) => c.ambito === 'raiz'))
      .map((m) => m.id);
    expect(conRaiz).toEqual([]);
  });

  it('todo collectionGroup de firestore.indexes.json tiene dueño en el registro o está pendiente de L1-b', () => {
    // L1-b: declarar dueño.
    const pendientesL1b = ['alertas', 'reconstrucciones', 'novuchatTokens', 'limitesTasa'];
    const idx = JSON.parse(
      readFileSync(fileURLToPath(new URL('../firestore.indexes.json', import.meta.url)), 'utf8'),
    ) as { indexes?: { collectionGroup: string }[]; fieldOverrides?: { collectionGroup: string }[] };
    const grupos = new Set([...(idx.indexes ?? []), ...(idx.fieldOverrides ?? [])].map((x) => x.collectionGroup));
    const ultimos = new Set(registroPlataforma.rutas().map((r) => r.split('/').pop()));
    const sinDueno = [...grupos].filter((g) => !ultimos.has(g) && !pendientesL1b.includes(g));
    expect(sinDueno).toEqual([]);
  });
});
