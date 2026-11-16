import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  crearRegistro,
  ErrorRegistro,
  manifiestoNucleo,
  modulosEfectivos,
  NO_ENCENDIBLES,
  validarEncendido,
  validarClaim,
  validarSobre,
  type ColeccionManifiesto,
  type ManifiestoModulo,
} from '@novutienda/nucleo';
import { horarioDe } from '../plataforma/coordinador/encendido.js';
import { manifiestoPlataforma } from '../plataforma/operador/manifiesto.js';
import { manifiestosEnOrden, registroPlataforma } from '../plataforma/registro.js';
import { COLECCION_LIMITES } from '../plataforma/conectores/firebase/limite-tasa.js';
import { FOTO_MENU_L2, TITULO_RECIBOS_CAJ } from './fotos/menu-l2.js';
import { FOTO_PERMISOS_L2 } from './fotos/permisos-l2.js';
import { tablasCompuestas } from './funciones/tablas.js';
import { COLECCION_TOKENS } from '../plataforma/funciones/servidor/http/novuchat.js';

const mod = (id: string, dependeDe: string[] = [], rutas: string[] = []): ManifiestoModulo => ({
  id,
  version: '1.0.0',
  dependeDe,
  submodulos: [],
  colecciones: rutas.map((ruta) => ({ ruta, lectura: ['adm'], escritura: 'servidor' })),
  emite: [],
  consume: [],
});

/**
 * Invariante estática del bus (L3-5, D3 = A): si el módulo C consume un evento, todo módulo que lo emite tiene a C
 * en su cierre de `dependeDe` y `requiere`; así un emisor encendido implica a su consumidor encendido.
 * Devuelve las violaciones como texto (vacío = se cumple).
 */
function violacionesDelBus(manifiestos: readonly ManifiestoModulo[]): string[] {
  const porId = new Map(manifiestos.map((m) => [m.id, m]));
  const cierre = (id: string): Set<string> => {
    const visto = new Set<string>();
    const pila = [id];
    while (pila.length > 0) {
      const m = porId.get(pila.pop() as string);
      for (const d of [...(m?.dependeDe ?? []), ...(m?.requiere ?? [])]) {
        if (!visto.has(d)) {
          visto.add(d);
          pila.push(d);
        }
      }
    }
    return visto;
  };
  const fallas: string[] = [];
  for (const c of manifiestos) {
    for (const evento of c.consume) {
      for (const emisor of manifiestos.filter((m) => m.emite.includes(evento))) {
        if (emisor.id !== c.id && !cierre(emisor.id).has(c.id)) fallas.push(`${emisor.id} emite ${evento}, que consume ${c.id}, y no lo tiene en dependeDe/requiere`);
      }
    }
  }
  return fallas;
}

describe('invariante estática del bus (L3-5)', () => {
  it('con los manifiestos reales, todo emisor de un evento tiene al consumidor en su cierre', () => {
    expect(violacionesDelBus(registroPlataforma.listar())).toEqual([]);
  });

  it('los emisores reales de lo que consumen Recibos e Inventarios (pos) los tienen en su cierre', () => {
    const pos = registroPlataforma.listar().find((m) => m.id === 'pos');
    expect(pos?.dependeDe).toContain('recibos');
    expect(pos?.requiere).toContain('inventarios');
  });

  it('detecta un manifiesto roto: un emisor que no declara a su consumidor', () => {
    const emisor = { ...mod('emisor', ['nucleo']), emite: ['x.hecho'] };
    const consumidor = { ...mod('consumidor', ['nucleo']), consume: ['x.hecho'] };
    expect(violacionesDelBus([mod('nucleo'), emisor, consumidor])).toEqual([
      'emisor emite x.hecho, que consume consumidor, y no lo tiene en dependeDe/requiere',
    ]);
    // Corregido (por dependeDe o por requiere, también transitivo) deja de fallar.
    expect(violacionesDelBus([mod('nucleo'), { ...emisor, dependeDe: ['nucleo', 'consumidor'] }, consumidor])).toEqual([]);
    expect(violacionesDelBus([mod('nucleo'), { ...emisor, requiere: ['consumidor'] }, consumidor])).toEqual([]);
    const puente = mod('puente', ['consumidor']);
    expect(violacionesDelBus([mod('nucleo'), { ...emisor, dependeDe: ['puente'] }, puente, consumidor])).toEqual([]);
  });
});

describe('registro de módulos', () => {
  it('el núcleo, los módulos y plataforma están registrados; el núcleo tiene sus nueve colecciones (L1-b)', () => {
    // L1-b: se suma `plataforma` (8 ids) y el núcleo declara `alertas` y `limitesTasa` (9 colecciones).
    expect(registroPlataforma.listar().map((m) => m.id).sort()).toEqual(['consola', 'inventarios', 'nucleo', 'panel', 'plataforma', 'pos', 'recibos', 'website']);
    expect(manifiestoNucleo.colecciones.map((c) => c.ruta)).toEqual(['miembros', 'auditoria', 'eventos', 'procesados', 'contadores', 'cotizaciones', 'config', 'alertas', 'limitesTasa']);
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
    expect(() => copiaReal().registrar(extra({ ruta: 'tenants' }))).toThrow(ErrorRegistro); // solo plataforma la declara
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

  it('las colecciones de raíz declaradas son solo limitesTasa (nucleo), dominios, novuchatTokens y tenants (plataforma)', () => {
    const raices = registroPlataforma
      .listar()
      .flatMap((m) => m.colecciones.filter((c) => c.ambito === 'raiz').map((c) => `${m.id}:${c.ruta}`))
      .sort();
    expect(raices).toEqual(['nucleo:limitesTasa', 'plataforma:dominios', 'plataforma:novuchatTokens', 'plataforma:tenants']);
  });

  it('todo collectionGroup de firestore.indexes.json tiene dueño en el registro', () => {
    const idx = JSON.parse(
      readFileSync(fileURLToPath(new URL('../firestore.indexes.json', import.meta.url)), 'utf8'),
    ) as { indexes?: { collectionGroup: string }[]; fieldOverrides?: { collectionGroup: string }[] };
    const grupos = new Set([...(idx.indexes ?? []), ...(idx.fieldOverrides ?? [])].map((x) => x.collectionGroup));
    const ultimos = new Set(registroPlataforma.rutas().map((r) => r.split('/').pop()));
    const sinDueno = [...grupos].filter((g) => !ultimos.has(g));
    expect(sinDueno).toEqual([]);
  });
});

describe('L1-b: constantes de código alineadas con el manifiesto', () => {
  const raiz = (m: ManifiestoModulo) => m.colecciones.filter((c) => c.ambito === 'raiz').map((c) => c.ruta);

  it('COLECCION_LIMITES es la raíz declarada por nucleo', () => {
    expect(raiz(manifiestoNucleo)).toEqual([COLECCION_LIMITES]);
  });

  it('COLECCION_TOKENS es la raíz declarada por plataforma', () => {
    expect(raiz(manifiestoPlataforma)).toEqual([COLECCION_TOKENS, 'dominios', 'tenants']);
  });

  it('plataforma depende solo de nucleo y se ordena después', () => {
    expect(manifiestoPlataforma.dependeDe).toEqual(['nucleo']);
    const orden = registroPlataforma.ordenTopologico();
    expect(orden.indexOf('nucleo')).toBeGreaterThanOrEqual(0);
    expect(orden.indexOf('plataforma')).toBeGreaterThan(orden.indexOf('nucleo'));
  });
});

describe('L3-1: rutasHttp del manifiesto (sin efecto)', () => {
  const l3 = (id: string, extra: Record<string, unknown> = {}): ManifiestoModulo =>
    ({ ...mod(id), ...extra }) as ManifiestoModulo;
  const rechaza = (extra: Record<string, unknown>, id = 'x') => () =>
    crearRegistro<ManifiestoModulo>().registrar(l3(id, extra));

  it('sin rutasHttp el agregador devuelve []', () => {
    const r = crearRegistro<ManifiestoModulo>();
    r.registrar(mod('a'));
    expect(r.rutasHttp()).toEqual([]);
  });

  it('anota el módulo dueño en cada ruta', () => {
    const r = crearRegistro<ManifiestoModulo>();
    r.registrar(l3('a', { rutasHttp: [{ ruta: '/api/a/v1', prefijo: true }, { ruta: '/api/a-uno' }] }));
    r.registrar(l3('b', { rutasHttp: [{ ruta: '/api/b' }] }));
    expect(r.rutasHttp().map((x) => [x.ruta, x.modulo])).toEqual([['/api/a/v1', 'a'], ['/api/a-uno', 'a'], ['/api/b', 'b']]);
  });

  it('rechaza rutas mal formadas o con barra final', () => {
    for (const ruta of ['/otra/x', '/api/', '/api', '/api/A', '/api/x/', '/api/x y', 'api/x', '/api/x?q=1', '/api//x', '/api/a//b']) {
      expect(rechaza({ rutasHttp: [{ ruta }] }), ruta).toThrow(ErrorRegistro);
    }
    expect(rechaza({ rutasHttp: [{ ruta: '/api/x', prefijo: 'si' }] })).toThrow(/prefijo/);
    expect(rechaza({ rutasHttp: 'x' })).toThrow(/lista/);
  });

  it('rechaza rutasHttp fuera de la zona modulo', () => {
    const una = { rutasHttp: [{ ruta: '/api/x' }] };
    expect(rechaza({ zona: 'central', ...una }, 'panel')).toThrow(/rutasHttp/);
    expect(rechaza({ zona: 'nucleo', ...una }, 'nucleo')).toThrow(/rutasHttp/);
    expect(rechaza(una, 'plataforma')).toThrow(/rutasHttp/);
  });

  it('rechaza rutas repetidas dentro de un módulo', () => {
    expect(rechaza({ rutasHttp: [{ ruta: '/api/x' }, { ruta: '/api/x', prefijo: true }] })).toThrow(/duplicada/);
  });

  it('rutas repetidas entre módulos: registrar no falla, rutasHttp() lanza nombrando ambos', () => {
    const r = crearRegistro<ManifiestoModulo>();
    r.registrar(l3('a', { rutasHttp: [{ ruta: '/api/x' }] }));
    expect(() => r.registrar(l3('b', { rutasHttp: [{ ruta: '/api/x' }] }))).not.toThrow();
    expect(() => r.rutasHttp()).toThrow(/a y b/);
  });

  it('rechaza una ruta que cae bajo el prefijo de otro módulo, en cualquier orden de registro', () => {
    for (const orden of [['a', 'b'], ['b', 'a']] as const) {
      const r = crearRegistro<ManifiestoModulo>();
      const por = {
        a: l3('a', { rutasHttp: [{ ruta: '/api/sitio', prefijo: true }] }),
        b: l3('b', { rutasHttp: [{ ruta: '/api/sitio/v1/x' }] }),
      };
      for (const id of orden) r.registrar(por[id]);
      expect(() => r.rutasHttp()).toThrow(/cae bajo el prefijo/);
    }
  });

  it('una ruta exacta vecina del prefijo no choca', () => {
    const r = crearRegistro<ManifiestoModulo>();
    r.registrar(l3('a', { rutasHttp: [{ ruta: '/api/sitio', prefijo: true }] }));
    r.registrar(l3('b', { rutasHttp: [{ ruta: '/api/sitio-x' }] }));
    expect(r.rutasHttp()).toHaveLength(2);
  });
});

describe('L2-1: campos L2 del manifiesto (sin efecto)', () => {
  const pant = { id: 'inicio', titulo: 'Inicio', roles: ['adm'] as const, orden: 1 };
  const acc = { callable: 'ventas', nombre: 'crear', roles: ['caj'] as const };
  const prog = { id: 'cierre', horario: 'every day 02:00', zonaHoraria: 'America/La_Paz', porTenant: true };
  const l2 = (id: string, extra: Record<string, unknown> = {}): ManifiestoModulo =>
    ({ ...mod(id), ...extra }) as ManifiestoModulo;
  const rechaza = (extra: Record<string, unknown>) => () => crearRegistro<ManifiestoModulo>().registrar(l2('x', extra));

  it('sin campos L2 el manifiesto es válido y los agregadores devuelven []', () => {
    const r = crearRegistro<ManifiestoModulo>();
    r.registrar(mod('a'));
    expect(r.listar().map((m) => m.id)).toEqual(['a']);
    expect(r.acciones()).toEqual([]);
    expect(r.pantallas()).toEqual([]);
    expect(r.programadas()).toEqual([]);
  });

  it('cada agregador anota el módulo dueño en cada fila', () => {
    const r = crearRegistro<ManifiestoModulo>();
    r.registrar(l2('a', { pantallas: [pant], acciones: [acc], programadas: [prog] }));
    r.registrar(l2('b', { pantallas: [{ ...pant, id: 'otra' }], acciones: [{ ...acc, nombre: 'anular' }], programadas: [{ ...prog, id: 'otro' }] }));
    expect(r.pantallas().map((p) => [p.id, p.modulo])).toEqual([['inicio', 'a'], ['otra', 'b']]);
    expect(r.acciones().map((a) => [a.nombre, a.modulo])).toEqual([['crear', 'a'], ['anular', 'b']]);
    expect(r.programadas().map((p) => [p.id, p.modulo])).toEqual([['cierre', 'a'], ['otro', 'b']]);
  });

  it('rechaza zona inválida', () => {
    expect(rechaza({ zona: 'otra' })).toThrow(ErrorRegistro);
  });

  it('rechaza callable, nombre o id con guion', () => {
    expect(rechaza({ acciones: [{ ...acc, callable: 'mi-callable' }] })).toThrow(ErrorRegistro);
    expect(rechaza({ acciones: [{ ...acc, nombre: 'mi-nombre' }] })).toThrow(ErrorRegistro);
    expect(rechaza({ pantallas: [{ ...pant, id: 'mi-id' }] })).toThrow(ErrorRegistro);
    expect(rechaza({ programadas: [{ ...prog, id: 'mi-id' }] })).toThrow(ErrorRegistro);
  });

  it('rechaza roles desconocidos, también en tituloPorRol', () => {
    expect(rechaza({ pantallas: [{ ...pant, roles: ['root'] }] })).toThrow(/rol/i);
    expect(rechaza({ acciones: [{ ...acc, roles: ['root'] }] })).toThrow(/rol/i);
    expect(rechaza({ pantallas: [{ ...pant, tituloPorRol: { root: 'X' } }] })).toThrow(/tituloPorRol/);
  });

  it('rechaza orden negativo o decimal y horario vacío', () => {
    expect(rechaza({ pantallas: [{ ...pant, orden: -1 }] })).toThrow(/orden/);
    expect(rechaza({ pantallas: [{ ...pant, orden: 1.5 }] })).toThrow(/orden/);
    expect(rechaza({ programadas: [{ ...prog, horario: '' }] })).toThrow(/horario/);
  });

  it('rechaza requiere a sí mismo o repetido', () => {
    expect(rechaza({ requiere: ['x'] })).toThrow(/sí mismo/);
    expect(rechaza({ requiere: ['y', 'y'] })).toThrow(/repite/);
  });

  it('rechaza pantallas o acciones en el manifiesto nucleo', () => {
    const nuc = (extra: Record<string, unknown>) => () => crearRegistro<ManifiestoModulo>().registrar(l2('nucleo', { zona: 'nucleo', ...extra }));
    expect(nuc({ pantallas: [pant] })).toThrow(/no admite pantallas ni acciones/);
    expect(nuc({ acciones: [acc] })).toThrow(/no admite pantallas ni acciones/);
  });

  it('rechaza zona incoherente con el id (NO_ENCENDIBLES ↔ zona)', () => {
    expect(rechaza({ zona: 'nucleo' })).toThrow(/incoherente/);
    expect(() => crearRegistro<ManifiestoModulo>().registrar(l2('nucleo', { zona: 'modulo' }))).toThrow(/incoherente/);
  });

  it('rechaza duplicados dentro de un módulo', () => {
    expect(rechaza({ pantallas: [pant, pant] })).toThrow(/duplicado/);
    expect(rechaza({ acciones: [acc, acc] })).toThrow(/duplicada/);
    expect(rechaza({ programadas: [prog, prog] })).toThrow(/duplicado/);
  });

  it('duplicados entre módulos: registrar no falla, los agregadores lanzan nombrando ambos', () => {
    const r = crearRegistro<ManifiestoModulo>();
    r.registrar(l2('a', { pantallas: [pant], acciones: [acc], programadas: [prog] }));
    expect(() => r.registrar(l2('b', { pantallas: [pant], acciones: [acc], programadas: [prog] }))).not.toThrow();
    for (const f of [() => r.pantallas(), () => r.acciones(), () => r.programadas()]) {
      expect(f).toThrow(ErrorRegistro);
      expect(f).toThrow(/a y b/);
    }
  });

  it('rutas() y rutasAlmacenamiento() no cambian por añadir campos L2', () => {
    const sin = crearRegistro<ManifiestoModulo>();
    const con = crearRegistro<ManifiestoModulo>();
    sin.registrar(mod('a', [], ['x', 'y']));
    con.registrar(l2('a', { colecciones: mod('a', [], ['x', 'y']).colecciones, pantallas: [pant], acciones: [acc], programadas: [prog], requiere: ['otro'] }));
    expect(con.rutas()).toEqual(sin.rutas());
    expect(con.rutasAlmacenamiento()).toEqual(sin.rutasAlmacenamiento());
  });

  it('NO_ENCENDIBLES es nucleo, panel y plataforma', () => {
    expect([...NO_ENCENDIBLES]).toEqual(['nucleo', 'panel', 'plataforma']);
  });

  describe('con el registro real', () => {
    // Tablas compuestas como en servidor/index.ts: implementaciones de llamadas/*.ts + roles y propietario del registro (tablaDeCallable).
    const tablas = tablasCompuestas();
    const leer = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

    it('todo manifiesto del registro declara zona', () => {
      const sinZona = registroPlataforma.listar().filter((m) => m.zona === undefined).map((m) => m.id);
      expect(sinZona).toEqual([]);
    });

    it('NO_ENCENDIBLES es exactamente el conjunto de ids con zona distinta de modulo', () => {
      const noModulo = registroPlataforma.listar().filter((m) => m.zona !== 'modulo').map((m) => m.id);
      expect(new Set(noModulo)).toEqual(new Set(NO_ENCENDIBLES));
      expect(noModulo.length).toBe(NO_ENCENDIBLES.length);
    });

    const normal = (l: readonly { callable: string; nombre: string; roles: readonly string[]; propietario?: boolean | undefined }[]) =>
      l
        .map((a) => ({ callable: a.callable, nombre: a.nombre, roles: [...a.roles].sort(), propietario: a.propietario === true }))
        .sort((x, y) => `${x.callable}.${x.nombre}`.localeCompare(`${y.callable}.${y.nombre}`));

    // Foto de permisos congelada (pruebas/fotos/permisos-l2.ts): este caso es el que L2-3 NO debe tocar.
    it('las acciones del registro coinciden con la foto de permisos (callable, nombre, roles, propietario; ni de más ni de menos)', () => {
      expect(FOTO_PERMISOS_L2.length).toBe(86);
      expect(normal(registroPlataforma.acciones())).toEqual(normal(FOTO_PERMISOS_L2));
    });

    // L2-3: la fuente son las tablas compuestas con tablaDeCallable (los bordes ya no llevan roles); la comparación sigue siendo contra la foto.
    it('las tablas compuestas de los callables coinciden con la foto de permisos', () => {
      const tablasComoLista = Object.entries(tablas).flatMap(([callable, t]) =>
        Object.entries(t).map(([nombre, d]) => ({ callable, nombre, roles: d.roles, propietario: d.propietario })),
      );
      expect(normal(tablasComoLista)).toEqual(normal(FOTO_PERMISOS_L2));
    });

    it('las pantallas del registro coinciden con la foto del menú (orden por `orden`) y caj ve «Mis recibos»', () => {
      const pantallas = [...registroPlataforma.pantallas()].sort((a, b) => a.orden - b.orden);
      expect(pantallas.map((p) => ({ id: p.id, titulo: p.titulo, roles: [...p.roles] }))).toEqual(FOTO_MENU_L2);
      expect(new Set(pantallas.map((p) => p.orden)).size).toBe(pantallas.length);
      expect(pantallas.find((p) => p.id === 'recibos')?.tituloPorRol?.caj).toBe(TITULO_RECIBOS_CAJ);
    });

    // L2-3: index.ts ya no lleva el horario en texto: cada onSchedule lo toma del registro con horarioDe(<id>).
    it('cada onSchedule de servidor/index.ts toma su horario del registro (horarioDe) y son exactamente las programadas declaradas', () => {
      const codigo = leer('../plataforma/funciones/servidor/index.ts');
      const usadas = [...codigo.matchAll(/export const (\w+) = onSchedule\(\{ \.\.\.horarioDe\('(\w+)'\)/g)].map((x) => ({ exportada: x[1], id: x[2] }));
      expect(usadas.every((u) => u.exportada === u.id)).toBe(true);
      expect(usadas.map((u) => u.id).sort()).toEqual(registroPlataforma.programadas().map((p) => p.id).sort());
      expect(codigo).not.toMatch(/schedule:\s*'/);
      for (const p of registroPlataforma.programadas()) expect(horarioDe(p.id)).toEqual({ schedule: p.horario, timeZone: p.zonaHoraria });
    });

    // L3-2: las rutas que maneja router.ts (leídas del texto) son exactamente las declaradas por los módulos más la salud.
    it('las rutas de router.ts son exactamente registro.rutasHttp() más /healthz y /api/salud', () => {
      const codigo = leer('../plataforma/funciones/servidor/http/router.ts');
      const literales = [...codigo.matchAll(/'(\/(?:api\/[a-z0-9_/-]+|healthz))'/g)].map((x) => x[1] as string);
      // '/api/novuchat/' solo es la guarda del límite en memoria: sus rutas reales se listan una a una.
      const exactas = literales.filter((l) => !l.endsWith('/'));
      const prefijos = literales.filter((l) => l.endsWith('/') && l !== '/api/novuchat/').map((l) => l.slice(0, -1));
      const leidas = [...new Set([...exactas, ...prefijos])].sort();
      const declaradas = registroPlataforma.rutasHttp().map((r) => r.ruta);
      expect(leidas).toEqual([...declaradas, '/healthz', '/api/salud'].sort());
      expect(registroPlataforma.rutasHttp().filter((r) => r.prefijo === true).map((r) => r.ruta).sort()).toEqual(prefijos.sort());
      expect(registroPlataforma.rutasHttp().map((r) => [r.ruta, r.modulo]).sort()).toEqual([
        ['/api/contacto', 'website'], ['/api/cotizacion', 'website'], ['/api/disponibilidad', 'website'],
        ['/api/novuchat/v1/catalogo', 'consola'], ['/api/novuchat/v1/inventario', 'inventarios'],
        ['/api/novuchat/v1/pedidos/confirmar', 'inventarios'], ['/api/sitio/v1', 'consola'],
      ]);
    });

    it('pos (dependeDe nucleo y recibos) queda fuera sin recibos encendido', () => {
      expect(manifiestosEnOrden().find((m) => m.id === 'pos')?.dependeDe).toEqual(['nucleo', 'recibos']);
      expect(modulosEfectivos(manifiestosEnOrden(), ['pos'])).toEqual([]);
      const v = validarEncendido(manifiestosEnOrden(), ['pos']);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.errores).toContain('pos requiere recibos, que no está encendido');
    });

    it('nucleo, panel y plataforma no se pueden encender', () => {
      const v = validarEncendido(manifiestosEnOrden(), ['nucleo', 'panel', 'plataforma']);
      expect(v).toEqual({ ok: false, errores: ['nucleo no es encendible', 'panel no es encendible', 'plataforma no es encendible'] });
    });
  });
});
