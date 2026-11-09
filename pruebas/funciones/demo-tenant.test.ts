// Datos de demostración de un tenant (paso 5 del plan de carga a staging): fixtures de `scripts/demo/`, planificador
// `plataforma/operador/demo.ts` y alta del personal `plataforma/operador/personal.ts`.
// Sin emulador: validación de los fixtures con los validadores reales de cada módulo y planes puros.
// Con emulador: siembra completa por las callables (misma lógica que `scripts/demo-tenant.mjs`), catálogo de NovuChat y
// segunda pasada del planificador sin pasos.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { construirClaim, cargarManual } from '@novutienda/nucleo';
import { almacenCotizacionesDesde } from '../../plataforma/coordinador/index.js';
import { validarConfigSitio, validarFichaWeb } from '@novutienda/consola';
import { leerCsvProductos } from '@novutienda/inventarios';
import { validarPlantilla } from '@novutienda/recibos';
import { contenidoEjemplo } from '@novutienda/website';
import {
  planificarDemo, versionDeFixture, idsDeCatalogo, lotesDeCatalogo, MAX_FILAS_CSV, subidaIdDe, MAX_INTENTOS_FOTO, turnoIdDemo, uuidDeterminista, ventaIdDemo, VERSION_DEMO,
  type EstadoDemo, type FixtureDemo, type OpcionesDemo, type Paso, type PlanDemo,
} from '../../plataforma/operador/demo.js';
import {
  aplicarPersonal, generarContrasena, operadorDe, validarEntradaPersonal, type AlmacenCredenciales, type AuthOperador, type Credencial, type UsuarioAuth,
} from '../../plataforma/operador/personal.js';
import { accion, crearUsuario, hayEmulador, hoyLaPaz, herramientas, http, iniciarSesion, TENANT_TODO_ENCENDIDO, unico, type Herramientas } from './ayudas.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const DIR = join(process.cwd(), 'scripts/demo');
const csv = readFileSync(join(DIR, 'catalogo.csv'), 'utf8');
const fx = JSON.parse(readFileSync(join(DIR, 'demo.json'), 'utf8')) as FixtureDemo;
const personalJson: unknown = JSON.parse(readFileSync(join(DIR, 'personal.json'), 'utf8'));
const archivosFoto = readdirSync(join(DIR, 'fotos'));
const bytesFoto: Record<string, number> = Object.fromEntries(archivosFoto.map((a) => [a, statSync(join(DIR, 'fotos', a)).size]));
const OPC: OpcionesDemo = { fotos: true, ventas: true, bytesFoto };

const vacio: EstadoDemo = {
  cuentas: { sup: { uid: 'u-sup', rolActual: null }, caj: { uid: 'u-caj', rolActual: null } },
  ubicaciones: [], productos: [], series: {}, plantilla: null, configSitio: null, fichas: {}, medios: {},
  tablero: { versionPublicada: 0, cambiosSinPublicar: 0 }, turnos: [], ventas: [],
};

describe('fixtures de demostración (sin emulador)', () => {
  it('el CSV pasa leerCsvProductos como carga inicial y no pasa de 50 filas', () => {
    const filas = leerCsvProductos(csv, true);
    expect(filas.length).toBeGreaterThanOrEqual(10);
    expect(filas.length).toBeLessThanOrEqual(50);
    expect(idsDeCatalogo(csv)).toEqual(filas.map((f) => f.producto.id));
  });

  it('cada ficha pasa validarFichaWeb (con medios de la forma que arma el planificador)', () => {
    const ids = new Set(idsDeCatalogo(csv));
    for (const f of fx.fichas) {
      expect(ids.has(f.productoId)).toBe(true);
      const medios = f.fotos.map((foto, i) => ({ medioId: subidaIdDe(f.productoId, i + 1), alt: foto.alt }));
      const r = validarFichaWeb({ ...f.ficha, medios });
      expect(r.ok, `${f.productoId}: ${JSON.stringify(r)}`).toBe(true);
      for (const foto of f.fotos) expect(archivosFoto).toContain(foto.archivo);
    }
    expect(new Set(fx.fichas.map((f) => f.ficha.slug)).size).toBe(fx.fichas.length);
  });

  it('la configuración del sitio pasa validarConfigSitio y la plantilla de recibo validarPlantilla', () => {
    expect(validarConfigSitio(fx.sitio.config).ok).toBe(true);
    expect(() => validarPlantilla(fx.recibos.plantilla)).not.toThrow();
  });

  it('ids, slug, marca y precio coinciden con el espejo del sitio (ejemplo.ts)', () => {
    const filas = new Map(leerCsvProductos(csv, true).map((f) => [f.producto.id, f.producto]));
    for (const f of fx.fichas) {
      const espejo = contenidoEjemplo.productos.find((p) => p.id === f.productoId);
      expect(espejo, f.productoId).toBeDefined();
      const p = filas.get(f.productoId);
      expect(f.ficha.slug).toBe(espejo?.slug);
      expect(p?.marca).toBe(espejo?.marca);
      // El espejo guarda dólares; el catálogo, centavos.
      expect(p?.precioUSD.bo).toBe((espejo?.precioUsd.BO ?? -1) * 100);
      expect(p?.precioUSD.ar).toBe((espejo?.precioUsd.AR ?? -1) * 100);
    }
    expect(fx.fichas.map((f) => f.productoId).sort()).toEqual(contenidoEjemplo.productos.map((p) => p.id).sort());
  });

  it('solo un producto queda bajo su mínimo; ejemplo-tv-65 sin precio y agotado en tienda', () => {
    const filas = leerCsvProductos(csv, true);
    const bajos = filas.filter((f) => {
      const total = f.stock.reduce((s, x) => s + x.cantidad, 0) + fx.series.filter((g) => g.productoId === f.producto.id).reduce((s, g) => s + g.series.length, 0);
      return f.producto.minimo !== undefined && total <= f.producto.minimo;
    });
    expect(bajos.map((f) => f.producto.id)).toEqual(['accesorio-cable-hdmi-2m']);
    const tv = filas.find((f) => f.producto.id === 'ejemplo-tv-65');
    expect(tv?.producto.precioUSD).toEqual({ bo: 0, ar: 0 });
    expect(fx.series.some((g) => g.productoId === 'ejemplo-tv-65')).toBe(false);
    expect(tv?.stock).toEqual([]);
  });

  it('las ventas de muestra usan productos del catálogo y series declaradas', () => {
    const ids = new Set(idsDeCatalogo(csv));
    const series = new Set(fx.series.flatMap((g) => g.series));
    for (const v of fx.pos.ventas) {
      const lineas = (v.carrito['lineas'] ?? []) as { productoId: string; series?: string[] }[];
      for (const l of lineas) {
        expect(ids.has(l.productoId)).toBe(true);
        for (const s of l.series ?? []) expect(series.has(s)).toBe(true);
      }
    }
  });

  it('sin datos reales: correos @example.com, sin dominios ni NIT, fotos PNG de hasta 50 KB', () => {
    const textos = [csv, readFileSync(join(DIR, 'demo.json'), 'utf8'), readFileSync(join(DIR, 'personal.json'), 'utf8')].join('\n');
    for (const c of textos.match(/[^\s"',<>@]+@[^\s"',<>]+/g) ?? []) expect(c).toMatch(/@example\.com$/);
    for (const u of textos.match(/https?:\/\/[^\s"',<>]+/g) ?? []) expect(u).toMatch(/^https?:\/\/([^/]*\.)?(example\.(com|org|net)|ejemplo\.invalid)(\/|$)/);
    expect(textos).not.toMatch(/"nit"|\bNIT[:\s]+\d/i);
    expect(JSON.stringify(fx.recibos.plantilla)).not.toMatch(/"nit"/);
    expect(archivosFoto.length).toBeGreaterThanOrEqual(6);
    for (const a of archivosFoto) {
      const b = readFileSync(join(DIR, 'fotos', a));
      expect(b.length, a).toBeLessThanOrEqual(50 * 1024);
      expect([...b.subarray(0, 8)], a).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
    // Teléfonos: solo los ficticios de ceros.
    for (const t of textos.match(/\+?\d[\d ]{7,}\d/g) ?? []) expect(t.replace(/\D/g, '')).toMatch(/^(591)?0{8}|^59100000001$/);
  });
});

describe('planificador de la demostración (puro)', () => {
  const plan = (estado: EstadoDemo = vacio): PlanDemo => planificarDemo(csv, fx, estado, OPC);
  const operaciones = (p: readonly Paso[]): string[] =>
    p.flatMap((x) => (x.tipo === 'llamada' && typeof x.datos['operacionId'] === 'string' ? [x.datos['operacionId']] : []));

  it('es estable y determinista: dos corridas dan el mismo plan y los operacionId son demo-v1-…', () => {
    const a = plan();
    const b = plan();
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.bloqueos).toEqual([]);
    const ops = operaciones(a.pasos);
    expect(ops.length).toBeGreaterThanOrEqual(5);
    for (const o of ops) expect(o.startsWith(`${VERSION_DEMO}-`)).toBe(true);
    expect(new Set(ops).size).toBe(ops.length);
    expect(VERSION_DEMO).toBe('demo-v1');
    expect(ventaIdDemo('v1')).toBe(ventaIdDemo('v1'));
    expect(ventaIdDemo('v1')).not.toBe(ventaIdDemo('v2'));
    expect(turnoIdDemo()).toBe(uuidDeterminista('turno-1'));
    expect(turnoIdDemo()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('el plan completo respeta el orden de etapas y termina publicando antes de las ventas', () => {
    const etapas = [...new Set(plan().pasos.map((p) => p.etapa))];
    expect(etapas).toEqual(['roles', 'almacenes', 'catalogo', 'series', 'traspaso', 'recibos', 'sitio', 'fotos', 'fichas', 'publicacion', 'ventas']);
    const pasos = plan().pasos;
    expect(pasos.filter((p) => p.etapa === 'fotos')).toHaveLength(fx.fichas.reduce((n, f) => n + f.fotos.length, 0));
    expect(pasos.filter((p) => p.etapa === 'ventas').map((p) => (p.tipo === 'llamada' ? p.accion : ''))).toEqual(['abrirTurno', 'confirmarVenta', 'confirmarVenta', 'confirmarVenta', 'cerrarTurno']);
  });

  it('sin cuentas no se escribe: bloqueos; sin fotos ni ventas, esas etapas no aparecen', () => {
    const sinCaj = plan({ ...vacio, cuentas: { sup: vacio.cuentas.sup, caj: null } });
    expect(sinCaj.bloqueos.length).toBeGreaterThan(0);
    const corto = planificarDemo(csv, fx, vacio, { ...OPC, fotos: false, ventas: false });
    const etapas = new Set(corto.pasos.map((p) => p.etapa));
    expect(etapas.has('fotos')).toBe(false);
    expect(etapas.has('ventas')).toBe(false);
  });

  it('el estado ya al día no genera pasos (idempotencia del plan)', () => {
    const ids = idsDeCatalogo(csv);
    const series: Record<string, string> = {};
    for (const g of fx.series) for (const s of g.series) series[s] = g.ubicacionId;
    for (const s of fx.traspaso.lineas.flatMap((l) => l.series)) series[s] = fx.traspaso.destinoId;
    const medios: Record<string, string[]> = {};
    const fichas: Record<string, Record<string, unknown>> = {};
    for (const f of fx.fichas) {
      medios[f.productoId] = f.fotos.map((_, i) => subidaIdDe(f.productoId, i + 1));
      fichas[f.productoId] = { ...f.ficha, medios: f.fotos.map((foto, i) => ({ medioId: subidaIdDe(f.productoId, i + 1), alt: foto.alt })) };
    }
    const alDia: EstadoDemo = {
      cuentas: { sup: { uid: 'u-sup', rolActual: 'sup' }, caj: { uid: 'u-caj', rolActual: 'caj' } },
      ubicaciones: fx.almacenes.map((a) => a.id), productos: ids, series, plantilla: fx.recibos.plantilla, configSitio: fx.sitio.config,
      fichas, medios, tablero: { versionPublicada: 1, cambiosSinPublicar: 0 },
      turnos: [{ turnoId: turnoIdDemo(), estado: 'cerrado' }], ventas: fx.pos.ventas.map((v) => ventaIdDemo(v.clave)),
    };
    const p = plan(alDia);
    expect(p.pasos).toEqual([]);
    expect(p.bloqueos).toEqual([]);
  });

  it('un catálogo existente solo en parte bloquea; otro turno abierto bloquea las ventas', () => {
    const parcial = plan({ ...vacio, productos: [idsDeCatalogo(csv)[0] as string] });
    expect(parcial.bloqueos.length).toBeGreaterThan(0);
    const otro = plan({ ...vacio, turnos: [{ turnoId: 'otro', estado: 'abierto' }] });
    expect(otro.bloqueos.length).toBeGreaterThan(0);
  });

  it('las diferencias no traen correos ni identificadores', () => {
    for (const d of plan().diferencias) expect(d).not.toMatch(/@|u-sup|u-caj/);
  });
});

describe('fixtures externos: 41 productos, lotes y retiro (puro)', () => {
  const N = 41;
  const cab = csv.split(/\r?\n/)[0] as string;
  const idsExt = Array.from({ length: N }, (_, i) => `ext-prod-${String(i + 1).padStart(2, '0')}`);
  const csvExt = `${[cab, ...idsExt.map((id) => `${id},Producto ${id},cat,,SKU-${id},false,,,100,100,,true,true,2,,`)].join('\r\n')}\r\n`;
  // 14 fotos por ficha (más de 12) en un producto; el resto con una.
  const fxExt: FixtureDemo = {
    ...fx,
    series: [], traspaso: { origenId: 'tienda', destinoId: 'tienda', lineas: [] }, pos: { ...fx.pos, ventas: [] },
    fichas: idsExt.map((id, i) => ({
      productoId: id,
      ficha: { slug: `slug-${id}`, descripcion: 'd', garantia: 'g', estado: 'publicada', seo: {} },
      fotos: Array.from({ length: i === 0 ? 14 : 1 }, (_, k) => ({ archivo: `${id}-${String(k)}.jpg`, alt: 'a' })),
    })),
  };
  const bytes = Object.fromEntries(fxExt.fichas.flatMap((f) => f.fotos.map((x) => [x.archivo, 2_000_000])));
  const opc: OpcionesDemo = { fotos: true, ventas: false, bytesFoto: bytes };
  const base: EstadoDemo = { ...vacio, ubicaciones: fx.almacenes.map((a) => a.id) };

  it('el CSV de 41 filas se parte en lotes de ≤50 con operacionId deterministas, sin perder ni repetir filas', () => {
    expect(MAX_FILAS_CSV).toBe(50);
    const l = lotesDeCatalogo(csvExt);
    expect(l).toHaveLength(1);
    const csv120 = `${[cab, ...Array.from({ length: 120 }, (_, i) => `p${String(i)},P,c,,S${String(i)},false,,,1,1,,true,true,,,`)].join('\r\n')}\r\n`;
    const lotes = lotesDeCatalogo(csv120);
    expect(lotes.map((x) => x.ids.length)).toEqual([50, 50, 20]);
    for (const x of lotes) expect(leerCsvProductos(x.csv, true).length).toBe(x.ids.length);
    expect(lotes.flatMap((x) => x.ids)).toEqual(idsDeCatalogo(csv120));
    const pasos = planificarDemo(csv120, { ...fxExt, fichas: [] }, base, { ...opc, fotos: false }).pasos.filter((p) => p.etapa === 'catalogo');
    expect(pasos.map((p) => (p.tipo === 'llamada' ? p.datos['operacionId'] : ''))).toEqual(['demo-v1-catalogo', 'demo-v1-catalogo-2', 'demo-v1-catalogo-3']);
  });

  it('con 41 productos y fichas de 14 fotos: el plan completo y, con el estado al día, cero pasos', () => {
    expect(leerCsvProductos(csvExt, true)).toHaveLength(N);
    const p = planificarDemo(csvExt, fxExt, base, opc);
    expect(p.bloqueos).toEqual([]);
    expect(p.pasos.filter((x) => x.etapa === 'fotos')).toHaveLength(14 + 40);
    const medios: Record<string, string[]> = {};
    const fichas: Record<string, Record<string, unknown>> = {};
    for (const f of fxExt.fichas) {
      medios[f.productoId] = f.fotos.map((_, i) => subidaIdDe(f.productoId, i + 1));
      fichas[f.productoId] = { ...f.ficha, medios: f.fotos.map((foto, i) => ({ medioId: subidaIdDe(f.productoId, i + 1), alt: foto.alt })) };
    }
    const alDia: EstadoDemo = {
      ...base, productos: idsExt, plantilla: fx.recibos.plantilla, configSitio: fx.sitio.config, fichas, medios,
      tablero: { versionPublicada: 1, cambiosSinPublicar: 0 },
      cuentas: { sup: { uid: 's', rolActual: 'sup' }, caj: { uid: 'c', rolActual: 'caj' } },
    };
    const otra = planificarDemo(csvExt, fxExt, alDia, opc);
    expect(otra.pasos).toEqual([]);
    expect(otra.bloqueos).toEqual([]);
  });

  it('--retirar-fuera-del-fixture: desactiva y despublica solo lo que sobra, sin borrar, y es idempotente', () => {
    const visibles = [
      ...idsExt.map((id) => ({ id, activo: true, publicado: true })),
      { id: 'ejemplo-tv-55', activo: true, publicado: true },
      { id: 'ejemplo-tv-65', activo: false, publicado: true },
      { id: 'ya-retirado', activo: false, publicado: false },
    ];
    const estado: EstadoDemo = { ...base, productos: [...idsExt, 'ejemplo-tv-55', 'ejemplo-tv-65', 'ya-retirado'], productosVisibilidad: visibles };
    const sin = planificarDemo(csvExt, fxExt, estado, opc);
    expect(sin.pasos.some((x) => x.etapa === 'retiro')).toBe(false);
    const con = planificarDemo(csvExt, fxExt, estado, { ...opc, retirarFueraDelFixture: true });
    const retiros = con.pasos.filter((x) => x.etapa === 'retiro');
    expect(retiros.map((x) => (x.tipo === 'llamada' ? x.datos : null))).toEqual([
      { productoId: 'ejemplo-tv-55', cambios: { activo: false, publicado: false } },
      { productoId: 'ejemplo-tv-65', cambios: { activo: false, publicado: false } },
    ]);
    for (const r of retiros) expect(r.tipo === 'llamada' && r.accion === 'editarProducto' && r.modulo === 'consola').toBe(true);
    expect(con.diferencias).toContain('por retirar: 2');
    expect(con.pasos.at(-1)?.etapa).toBe('publicacion');
    // Segunda pasada: ya retirados.
    const despues: EstadoDemo = { ...estado, productosVisibilidad: visibles.map((v) => (idsExt.includes(v.id) ? v : { ...v, activo: false, publicado: false })) };
    expect(planificarDemo(csvExt, fxExt, despues, { ...opc, retirarFueraDelFixture: true }).pasos.filter((x) => x.etapa === 'retiro')).toEqual([]);
  });

  it('con fixtures propios todos los identificadores llevan demo-x<hash8> y nada coincide con demo-v1', () => {
    const fotos = Object.keys(bytes);
    const v = versionDeFixture(csvExt, fxExt, fotos);
    expect(v).toMatch(/^demo-x[0-9a-f]{8}$/);
    expect(versionDeFixture(csvExt, fxExt, [...fotos].reverse())).toBe(v);
    expect(versionDeFixture(`${csvExt}\r\n`, fxExt, fotos)).not.toBe(v);
    expect(versionDeFixture(csvExt, { ...fxExt, sitio: { config: { otro: 1 } } }, fotos)).not.toBe(v);
    const conV = planificarDemo(csvExt, { ...fxExt, pos: fx.pos }, base, { ...opc, ventas: true, version: v });
    const porDefecto = planificarDemo(csvExt, { ...fxExt, pos: fx.pos }, base, { ...opc, ventas: true });
    const ops = (p: PlanDemo): string[] => p.pasos.flatMap((x) => (x.tipo === 'llamada' && typeof x.datos['operacionId'] === 'string' ? [x.datos['operacionId']] : []));
    for (const o of ops(conV)) expect(o.startsWith(`${v}-`)).toBe(true);
    expect(ops(porDefecto).every((o) => o.startsWith('demo-v1-'))).toBe(true);
    expect(turnoIdDemo(v)).not.toBe(turnoIdDemo());
    expect(ventaIdDemo('v1', v)).not.toBe(ventaIdDemo('v1'));
    expect(subidaIdDe('p-1', 1, v)).toMatch(/^dx[0-9a-f]{8}-p-1-1$/);
    for (const x of conV.pasos) if (x.tipo === 'foto') expect(x.subidaId).toMatch(/^[A-Za-z0-9_-]{8,40}$/);
    const turno = conV.pasos.find((x) => x.tipo === 'llamada' && x.accion === 'abrirTurno');
    expect(turno?.tipo === 'llamada' && turno.datos['turnoId']).toBe(turnoIdDemo(v));
  });

  it('tras la demostración anterior (turno v1 cerrado, plantilla y sitio iguales) se omite lo que coincide y se abre un turno nuevo', () => {
    const v = versionDeFixture(csvExt, fxExt, Object.keys(bytes));
    const fxV = { ...fxExt, pos: fx.pos };
    const previo: EstadoDemo = {
      ...base, plantilla: fx.recibos.plantilla, configSitio: fx.sitio.config, tablero: { versionPublicada: 1, cambiosSinPublicar: 0 },
      cuentas: { sup: { uid: 's', rolActual: 'sup' }, caj: { uid: 'c', rolActual: 'caj' } },
      turnos: [{ turnoId: turnoIdDemo(), estado: 'cerrado' }], ventas: fx.pos.ventas.map((x) => ventaIdDemo(x.clave)),
    };
    const p = planificarDemo(csvExt, fxV, previo, { ...opc, ventas: true, version: v });
    expect(p.bloqueos).toEqual([]);
    const etapas = new Set(p.pasos.map((x) => x.etapa));
    expect(etapas.has('recibos')).toBe(false);
    expect(etapas.has('sitio')).toBe(false);
    expect(p.pasos.filter((x) => x.tipo === 'llamada' && x.accion === 'abrirTurno')).toHaveLength(1);
    expect(p.pasos.filter((x) => x.tipo === 'llamada' && x.accion === 'confirmarVenta')).toHaveLength(fx.pos.ventas.length);
    // Segunda pasada con el estado resultante: cero pasos.
    const medios: Record<string, string[]> = {};
    const fichas: Record<string, Record<string, unknown>> = {};
    for (const f of fxV.fichas) {
      medios[f.productoId] = f.fotos.map((_, i) => subidaIdDe(f.productoId, i + 1, v));
      fichas[f.productoId] = { ...f.ficha, medios: f.fotos.map((foto, i) => ({ medioId: subidaIdDe(f.productoId, i + 1, v), alt: foto.alt })) };
    }
    const despues: EstadoDemo = {
      ...previo, productos: idsExt, fichas, medios,
      turnos: [...previo.turnos, { turnoId: turnoIdDemo(v), estado: 'cerrado' }], ventas: [...previo.ventas, ...fx.pos.ventas.map((x) => ventaIdDemo(x.clave, v))],
    };
    expect(planificarDemo(csvExt, fxV, despues, { ...opc, ventas: true, version: v }).pasos).toEqual([]);
  });

  it('fotos rechazadas: reintento con -r2 y -r3, bloqueo tras 3 fallos, sin romper la idempotencia', () => {
    expect(MAX_INTENTOS_FOTO).toBe(3);
    const f = fxExt.fichas[1] as (typeof fxExt.fichas)[number];
    const un: FixtureDemo = { ...fxExt, fichas: [f] };
    const id = (k: number): string => subidaIdDe(f.productoId, 1, 'demo-v1', k);
    expect([id(1), id(2), id(3)]).toEqual([id(1), `${id(1)}-r2`, `${id(1)}-r3`]);
    for (const k of [1, 2, 3]) expect(id(k)).toMatch(/^[A-Za-z0-9_-]{8,40}$/);
    const largo = 'producto-con-un-identificador-bastante-largo';
    for (const k of [1, 2, 3]) expect(subidaIdDe(largo, 12, 'demo-xabcdef12', k)).toMatch(/^[A-Za-z0-9_-]{8,40}$/);
    expect(new Set([1, 2, 3].map((k) => subidaIdDe(largo, 12, 'demo-xabcdef12', k))).size).toBe(3);
    const estado = (subidas: EstadoDemo['subidas'], medios: string[] = []): EstadoDemo => ({
      ...base, productos: idsExt, ...(subidas !== undefined ? { subidas } : {}), medios: { [f.productoId]: medios },
    });
    const fotos = (e: EstadoDemo): string[] => planificarDemo(csvExt, un, e, opc).pasos.flatMap((p) => (p.tipo === 'foto' ? [p.subidaId] : []));
    expect(fotos(estado({ [id(1)]: 'reservada' }))).toEqual([id(1)]); // se reanuda
    expect(fotos(estado({ [id(1)]: 'rechazada' }))).toEqual([id(2)]);
    expect(fotos(estado({ [id(1)]: 'borrando' }))).toEqual([id(2)]);
    expect(fotos(estado({ [id(1)]: 'rechazada', [id(2)]: 'rechazada' }))).toEqual([id(3)]);
    const muerta = planificarDemo(csvExt, un, estado({ [id(1)]: 'rechazada', [id(2)]: 'rechazada', [id(3)]: 'rechazada' }), opc);
    expect(muerta.bloqueos.join(' ')).toMatch(/falló 3 veces/);
    expect(muerta.pasos.some((p) => p.tipo === 'foto')).toBe(false);
    // La ficha referencia el id que se va a subir (el reintento), no el rechazado.
    const ficha = planificarDemo(csvExt, un, estado({ [id(1)]: 'rechazada' }), opc).pasos.find((p) => p.tipo === 'llamada' && p.accion === 'guardarFicha');
    expect(JSON.stringify(ficha)).toContain(id(2));
    expect(JSON.stringify(ficha)).not.toContain(`"${id(1)}"`);
    // Con el reintento ya procesado (medio existente) y rechazos previos: ficha con -r2 y cero pasos de fotos.
    const hecho = estado({ [id(1)]: 'rechazada' }, [id(2)]);
    expect(fotos(hecho)).toEqual([]);
    const conFicha: EstadoDemo = {
      ...hecho, plantilla: fx.recibos.plantilla, configSitio: fx.sitio.config, tablero: { versionPublicada: 1, cambiosSinPublicar: 0 },
      cuentas: { sup: { uid: 's', rolActual: 'sup' }, caj: { uid: 'c', rolActual: 'caj' } },
      fichas: { [f.productoId]: { ...f.ficha, medios: [{ medioId: id(2), alt: (f.fotos[0] as { alt: string }).alt }] } },
    };
    expect(planificarDemo(csvExt, un, conFicha, opc).pasos).toEqual([]);
  });

  it('un lote existente solo en parte bloquea; otro lote ya completo no se vuelve a cargar', () => {
    const csv60 = `${[cab, ...Array.from({ length: 60 }, (_, i) => `q${String(i)},P,c,,S${String(i)},false,,,1,1,,true,true,,,`)].join('\r\n')}\r\n`;
    const primero = Array.from({ length: 50 }, (_, i) => `q${String(i)}`);
    const reanuda = planificarDemo(csv60, { ...fxExt, fichas: [] }, { ...base, productos: primero }, { ...opc, fotos: false });
    expect(reanuda.bloqueos).toEqual([]);
    expect(reanuda.pasos.filter((x) => x.etapa === 'catalogo')).toHaveLength(1);
    const parcial = planificarDemo(csv60, { ...fxExt, fichas: [] }, { ...base, productos: ['q3'] }, { ...opc, fotos: false });
    expect(parcial.bloqueos.length).toBeGreaterThan(0);
  });
});

describe('alta del personal (puro, con dobles)', () => {
  const entrada = validarEntradaPersonal(personalJson);
  const claimAdm = (() => {
    const c = construirClaim({ 'demo-x': 'adm' }, 1, false);
    if (!c.ok) throw new Error(c.error);
    return { ...c.valor };
  })();
  const usuario = (o: Partial<UsuarioAuth> & { uid: string }): UsuarioAuth => ({ disabled: false, emailVerified: true, proveedores: ['password'], ...o });
  const credenciales = (): AlmacenCredenciales & { guardadas: Credencial[][] } => {
    const guardadas: Credencial[][] = [];
    return {
      guardadas,
      leer: () => Promise.resolve([] as readonly Credencial[]),
      guardar: (c) => {
        guardadas.push([...c]);
        return Promise.resolve();
      },
    };
  };
  const auth = (existentes: Record<string, UsuarioAuth>, todos: readonly UsuarioAuth[] = Object.values(existentes)): AuthOperador & { creados: string[] } => {
    const creados: string[] = [];
    return {
      creados,
      buscarPorCorreo: (c) => Promise.resolve(existentes[c] ?? null),
      listarUsuarios: () => Promise.resolve(todos),
      crear: (d) => {
        creados.push(d.correo);
        return Promise.resolve(`uid-${d.correo}`);
      },
      getUser: () => Promise.reject(new Error('no debe llamarse')),
      setCustomUserClaims: () => Promise.reject(new Error('no debe llamarse')),
      revokeRefreshTokens: () => Promise.reject(new Error('no debe llamarse')),
    };
  };
  const base = { tenantId: 'demo-x', entrada, db: {} as never, aleatorios: (n: number) => randomBytes(n), operador: operadorDe('adm@example.com') };

  it('personal.json es válido: 3 cuentas @example.com con un solo administrador', () => {
    expect(entrada.cuentas).toHaveLength(3);
    expect(entrada.cuentas.filter((c) => c.rol === 'adm')).toHaveLength(1);
    for (const c of entrada.cuentas) expect(c.correo).toMatch(/@example\.com$/);
  });

  it('operador: operador:<cuenta> con una cuenta válida y operador:script en cualquier otro caso', () => {
    expect(operadorDe('adm@example.com')).toBe('operador:adm@example.com');
    expect(operadorDe()).toBe('operador:script');
    expect(operadorDe('con espacio; rm -rf')).toBe('operador:script');
    expect(operadorDe('')).toBe('operador:script');
  });

  it('sin aplicar solo informa: no crea ni guarda nada', async () => {
    const a = auth({});
    const c = credenciales();
    const r = await aplicarPersonal({ ...base, auth: a, credenciales: c, aplicar: false });
    expect(r).toMatchObject({ aplicado: false, creadas: 0, adminAsignado: false });
    expect(r.diferencias.join(' ')).not.toMatch(/@/);
    expect(a.creados).toEqual([]);
    expect(c.guardadas).toEqual([]);
  });

  it('no continúa si una cuenta está deshabilitada', async () => {
    const a = auth({ 'sup@example.com': usuario({ uid: 's', disabled: true }) });
    const c = credenciales();
    await expect(aplicarPersonal({ ...base, auth: a, credenciales: c, aplicar: true })).rejects.toThrow(/deshabilitadas/);
    expect(a.creados).toEqual([]);
    expect(c.guardadas).toEqual([]);
  });

  it('no continúa si otro usuario ya es administrador del tenant', async () => {
    const otro = usuario({ uid: 'otro', claims: claimAdm });
    const a = auth({}, [otro]);
    const c = credenciales();
    await expect(aplicarPersonal({ ...base, auth: a, credenciales: c, aplicar: true })).rejects.toThrow(/administrador distinto/);
    expect(a.creados).toEqual([]);
    expect(c.guardadas).toEqual([]);
  });

  it('no pisa una cuenta existente sin credencial guardada ni una que no es de correo y contraseña', async () => {
    const sinCred = auth({ 'caj@example.com': usuario({ uid: 'c' }) });
    await expect(aplicarPersonal({ ...base, auth: sinCred, credenciales: credenciales(), aplicar: true })).rejects.toThrow(/credencial guardada/);
    const google = auth({ 'caj@example.com': usuario({ uid: 'c', proveedores: ['google.com'] }) });
    await expect(aplicarPersonal({ ...base, auth: google, credenciales: credenciales(), aplicar: true })).rejects.toThrow(/correo y contraseña/);
  });

  it('las contraseñas generadas tienen 32 caracteres y no se repiten', () => {
    const a = generarContrasena((n) => randomBytes(n));
    expect(a).toHaveLength(32);
    expect(generarContrasena((n) => randomBytes(n))).not.toBe(a);
  });
});

// ---- Con emulador -------------------------------------------------------------------------------------------------

describe.skipIf(!hayEmulador)('siembra completa de la demostración (emulador)', () => {
  const tenant = unico('demo').toLowerCase();
  const sha256 = (t: string): string => createHash('sha256').update(t).digest('hex');
  const tokenNovuchat = randomBytes(24).toString('hex');
  let h: Herramientas;
  let adm: { uid: string; correo: string; token: string };
  let sup: { uid: string; correo: string };
  let caj: { uid: string; correo: string };

  type Dato = Record<string, unknown>;
  const ok = async (actor: 'adm' | 'caj', modulo: string, nombre: string, datos: unknown): Promise<Dato> => {
    // El claim del cajero se asigna durante la corrida: el token se pide fresco.
    const token = actor === 'adm' ? adm.token : await iniciarSesion(caj.correo);
    const r = await accion(modulo, nombre, datos, token, tenant);
    if (r.error !== undefined) throw new Error(`${modulo}.${nombre}: ${r.error.status ?? ''} ${r.error.message ?? ''}`);
    return (r.resultado ?? {}) as Dato;
  };
  const opcional = async (modulo: string, nombre: string, datos: unknown): Promise<Dato | null> => {
    const r = await accion(modulo, nombre, datos, adm.token, tenant);
    if (r.error?.status === 'NOT_FOUND') return null;
    if (r.error !== undefined) throw new Error(`${modulo}.${nombre}: ${r.error.status ?? ''} ${r.error.message ?? ''}`);
    return (r.resultado ?? {}) as Dato;
  };

  async function leerEstado(): Promise<EstadoDemo> {
    const usuarios = ((await ok('adm', 'consola', 'listarUsuarios', {}))['usuarios'] ?? []) as { uid: string; rol: string }[];
    const cuenta = (u: { uid: string; correo: string }): { uid: string; rolActual: string | null } => ({ uid: u.uid, rolActual: usuarios.find((x) => x.uid === u.uid)?.rol ?? null });
    const ubicaciones = (((await ok('adm', 'inventarios', 'ubicaciones', {}))['ubicaciones'] ?? []) as { id: string }[]).map((u) => u.id);
    const productos = (((await ok('adm', 'inventarios', 'listarProductos', {}))['productos'] ?? []) as { id: string }[]).map((p) => p.id);
    const series: Record<string, string> = {};
    for (const productoId of [...new Set(fx.series.map((g) => g.productoId))].filter((id) => productos.includes(id))) {
      for (const u of ((await ok('adm', 'inventarios', 'series', { productoId }))['unidades'] ?? []) as { serie: string; ubicacionId: string }[]) series[u.serie] = u.ubicacionId;
    }
    const plantilla = ((await ok('adm', 'recibos', 'leerPlantilla', {}))['plantilla'] ?? null) as Dato | null;
    const configSitio = ((await ok('adm', 'consola', 'configSitio', {}))['config'] ?? null) as Dato | null;
    const fichas: Record<string, Dato> = {};
    for (const f of ((await ok('adm', 'consola', 'fichas', {}))['fichas'] ?? []) as { productoId: string; ficha: Dato }[]) fichas[f.productoId] = f.ficha;
    const t = await ok('adm', 'consola', 'tablero', {});
    const turnos = (((await ok('adm', 'pos', 'turnos', { limite: 30 }))['turnos'] ?? []) as { turnoId: string; estado: string }[]).map((x) => ({ turnoId: x.turnoId, estado: x.estado }));
    const ventas: string[] = [];
    for (const v of fx.pos.ventas) {
      const id = ventaIdDemo(v.clave);
      if ((await opcional('pos', 'venta', { ventaId: id })) !== null) ventas.push(id);
    }
    return {
      cuentas: { sup: cuenta(sup), caj: cuenta(caj) }, ubicaciones, productos, series, plantilla, configSitio, fichas, medios: {},
      tablero: { versionPublicada: Number(t['versionPublicada'] ?? 0), cambiosSinPublicar: Number(t['cambiosSinPublicar'] ?? 0) },
      turnos, ventas,
    };
  }

  beforeAll(async () => {
    h = herramientas();
    await h.firestore.doc(`tenants/${tenant}`).set(TENANT_TODO_ENCENDIDO);
    const almacen = almacenCotizacionesDesde(h.db);
    for (const [mercado, valor] of [['BO', 7], ['AR', 1000]] as const) {
      await cargarManual(almacen, { mercado, valor, fecha: hoyLaPaz(), actor: { uid: 'sembrador', rol: 'adm', proveedor: 'password' }, ahoraMs: Date.now() }, { tenantId: tenant });
    }
    adm = await crearUsuario(h, { rol: 'adm', tenant });
    const s = await crearUsuario(h, { tenant });
    const c = await crearUsuario(h, { tenant });
    sup = { uid: s.uid, correo: s.correo };
    caj = { uid: c.uid, correo: c.correo };
    await h.firestore.doc(`novuchatTokens/${sha256(tokenNovuchat)}`).set({ tenantId: tenant, hash: sha256(tokenNovuchat), activo: true });
  });

  it('la siembra completa deja el catálogo de NovuChat con precio y disponibilidad correctos, y una segunda pasada da 0 pasos', async () => {
    // Fotos fuera: dependen del procesamiento de medios (otra suite).
    const opciones: OpcionesDemo = { fotos: false, ventas: true, bytesFoto };
    const primera = planificarDemo(csv, fx, await leerEstado(), opciones);
    expect(primera.bloqueos).toEqual([]);
    expect(primera.pasos.length).toBeGreaterThan(20);
    for (const p of primera.pasos) {
      if (p.tipo === 'llamada') await ok(p.como, p.modulo, p.accion, p.datos);
    }

    const segunda = planificarDemo(csv, fx, await leerEstado(), opciones);
    expect(segunda.bloqueos).toEqual([]);
    expect(segunda.pasos).toEqual([]);

    const r = await http('/api/novuchat/v1/catalogo?mercado=BO', { headers: { authorization: `Bearer ${tokenNovuchat}` } });
    expect(r.status).toBe(200);
    const items = (r.cuerpo as { items: { id: string; precio?: number; precioCentavos?: number; disponible: boolean; stock: number | null }[] }).items;
    expect(items.length).toBeGreaterThanOrEqual(9);
    const publicados = leerCsvProductos(csv, true).filter((f) => f.producto.publicado !== false).map((f) => f.producto.id);
    // ejemplo-tv-65 no tiene precio: el catálogo de NovuChat no lo ofrece (la tienda lo muestra «a consultar» y agotado).
    const esperados = publicados.filter((id) => id !== 'ejemplo-tv-65');
    expect(items.map((i) => i.id).sort()).toEqual(esperados.sort());
    for (const i of items) expect(i.precioCentavos, i.id).toBeGreaterThan(0);
    expect(items.find((i) => i.id === 'ejemplo-tv-55')).toMatchObject({ disponible: true, stock: 3 });
    // La venta de muestra descontó el stock de tienda del parlante (12 - 1).
    expect(items.find((i) => i.id === 'ejemplo-parlante-1')).toMatchObject({ disponible: true, stock: 11 });
  });
});
