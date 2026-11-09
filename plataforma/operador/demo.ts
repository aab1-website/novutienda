// Planificador de la carga de datos de demostración de un tenant (puro: sin red, disco ni reloj).
// Recibe el fixture (scripts/demo/*) y el estado leído por las mismas callables del panel y devuelve la lista ORDENADA de
// pasos que faltan y las diferencias legibles (sin identificadores ni correos). Con el estado ya al día devuelve cero pasos:
// la segunda pasada de `--aplicar` no escribe nada. Los identificadores de operación son deterministas (`demo-v1-…`); los
// que el servidor exige como UUID (turno, venta) se derivan de una clave fija con SHA-256.
import { createHash } from 'node:crypto';

export const VERSION_DEMO = 'demo-v1';

export type Actor = 'adm' | 'caj';
export type Modulo = 'pos' | 'inventarios' | 'consola' | 'recibos' | 'medios';

export interface PasoLlamada {
  readonly tipo: 'llamada';
  readonly etapa: string;
  readonly modulo: Modulo;
  readonly accion: string;
  readonly datos: Readonly<Record<string, unknown>>;
  readonly como: Actor;
}
export interface PasoFoto {
  readonly tipo: 'foto';
  readonly etapa: 'fotos';
  readonly productoId: string;
  readonly subidaId: string;
  readonly archivo: string;
  readonly bytes: number;
}
export type Paso = PasoLlamada | PasoFoto;

// ---- Fixture (forma de scripts/demo/demo.json) -------------------------------------------------------------------

export interface FixtureDemo {
  readonly almacenes: readonly { readonly id: string; readonly nombre: string }[];
  readonly series: readonly { readonly productoId: string; readonly ubicacionId: string; readonly series: readonly string[] }[];
  readonly traspaso: {
    readonly origenId: string;
    readonly destinoId: string;
    readonly lineas: readonly { readonly productoId: string; readonly series: readonly string[] }[];
  };
  readonly recibos: { readonly plantilla: Readonly<Record<string, unknown>> };
  readonly sitio: { readonly config: Readonly<Record<string, unknown>> };
  readonly fichas: readonly {
    readonly productoId: string;
    readonly ficha: { readonly slug: string; readonly descripcion: string; readonly garantia: string; readonly estado: string; readonly seo: Readonly<Record<string, unknown>> };
    readonly fotos: readonly { readonly archivo: string; readonly alt: string }[];
  }[];
  readonly pos: {
    readonly apertura: Readonly<Record<string, number>>;
    readonly contado: Readonly<Record<string, number>>;
    readonly ventas: readonly { readonly clave: string; readonly carrito: Readonly<Record<string, unknown>>; readonly pagos: readonly Readonly<Record<string, unknown>>[] }[];
  };
}

// ---- Estado leído ------------------------------------------------------------------------------------------------

export interface CuentaEstado {
  readonly uid: string;
  /** Rol que el tenant ya le asignó (`miembros`), o `null`. */
  readonly rolActual: string | null;
}
export interface EstadoDemo {
  /** Cuentas de personal (por rol) ya creadas; `null` si no existe. */
  readonly cuentas: { readonly sup: CuentaEstado | null; readonly caj: CuentaEstado | null };
  readonly ubicaciones: readonly string[];
  /** Ids de productos existentes. */
  readonly productos: readonly string[];
  /** Estado de visibilidad de cada producto existente (solo se usa con `retirarFueraDelFixture`). */
  readonly productosVisibilidad?: readonly { readonly id: string; readonly activo: boolean; readonly publicado: boolean }[];
  /** Unidades con serie existentes, por serie → ubicación. */
  readonly series: Readonly<Record<string, string>>;
  readonly plantilla: Readonly<Record<string, unknown>> | null;
  readonly configSitio: Readonly<Record<string, unknown>> | null;
  readonly fichas: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Estado de las subidas de fotos que existen y aún no son medios (por id, incluidos los reintentos `-r2`, `-r3`). */
  readonly subidas?: Readonly<Record<string, 'reservada' | 'procesada' | 'borrando' | 'rechazada'>>;
  /** Ids de medios ya procesados, por producto. */
  readonly medios: Readonly<Record<string, readonly string[]>>;
  readonly tablero: { readonly versionPublicada: number; readonly cambiosSinPublicar: number };
  readonly turnos: readonly { readonly turnoId: string; readonly estado: string }[];
  /** Ids de venta (UUID) existentes entre las de la demostración. */
  readonly ventas: readonly string[];
}

export interface OpcionesDemo {
  readonly fotos: boolean;
  readonly ventas: boolean;
  /** Tamaño en bytes de cada archivo de `fotos/`. */
  readonly bytesFoto: Readonly<Record<string, number>>;
  /** Desactiva y despublica (nunca borra) los productos del tenant que no están en el catálogo del fixture. */
  readonly retirarFueraDelFixture?: boolean;
  /** Versión de la carga (`demo-v1` por defecto; `demo-x<hash8>` con fixtures propios, ver `versionDeFixture`). */
  readonly version?: string;
}

export interface PlanDemo {
  readonly pasos: readonly Paso[];
  readonly diferencias: readonly string[];
  /** Condiciones que impiden aplicar (p. ej. faltan cuentas). Con bloqueos no se escribe nada. */
  readonly bloqueos: readonly string[];
}

// ---- Ayudas puras -------------------------------------------------------------------------------------------------

/** UUID determinista (forma 8-4-4-4-12 en hexadecimal) derivado de una clave y de la versión de la carga. */
export function uuidDeterminista(clave: string, version: string = VERSION_DEMO): string {
  const h = createHash('sha256').update(`${version}:${clave}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export const turnoIdDemo = (version: string = VERSION_DEMO): string => uuidDeterminista('turno-1', version);
export const ventaIdDemo = (clave: string, version: string = VERSION_DEMO): string => uuidDeterminista(`venta-${clave}`, version);

/**
 * Versión de una carga con fixtures propios: `demo-x<hash8>`, con hash8 = primeros 8 hex del SHA-256 del contenido de
 * catalogo.csv, demo.json (claves ordenadas) y los nombres de las fotos. Un fixture distinto da operaciones distintas y no choca
 * con las anteriores; el mismo fixture da siempre la misma versión (idempotencia).
 */
export function versionDeFixture(catalogoCsv: string, fixture: unknown, nombresFotos: readonly string[]): string {
  const h = createHash('sha256').update(catalogoCsv).update('\u0000').update(json(fixture)).update('\u0000').update([...nombresFotos].sort().join('\n')).digest('hex');
  return `demo-x${h.slice(0, 8)}`;
}

/** Intentos por foto: el id base y `-r2`, `-r3` si el servidor rechazó el anterior. */
export const MAX_INTENTOS_FOTO = 3;

/** Id de subida (`^[A-Za-z0-9_-]{8,40}$`): corto y estable; si no cabe, se acorta con un hash. `intento` > 1 agrega `-r<intento>`. */
export function subidaIdDe(productoId: string, n: number, version: string = VERSION_DEMO, intento = 1): string {
  const pref = version === VERSION_DEMO ? 'dv1' : `d${version.replace(/^demo-/, '')}`;
  const sufijo = intento > 1 ? `-r${String(intento)}` : '';
  const directo = `${pref}-${productoId}-${String(n)}${sufijo}`;
  if (directo.length <= 40) return directo;
  return `${pref}-${createHash('sha256').update(productoId).digest('hex').slice(0, intento > 1 ? 18 : 24)}-${String(n)}${sufijo}`;
}

/** Máximo de filas por importación de Inventarios (`MAX_LINEAS` del módulo): un CSV mayor se parte en lotes. */
export const MAX_FILAS_CSV = 50;

/** Registros de un CSV (cabecera aparte), respetando comillas con saltos de línea dentro de un campo. */
function registrosCsv(csv: string): { cabecera: string; registros: string[] } {
  const texto = csv.replace(/^\uFEFF/, '');
  const todos: string[] = [];
  let actual = '';
  let comillas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const ch = texto.charAt(i);
    if (ch === '"') comillas = !comillas;
    if (!comillas && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && texto.charAt(i + 1) === '\n') i += 1;
      if (actual.trim() !== '') todos.push(actual);
      actual = '';
    } else actual += ch;
  }
  if (actual.trim() !== '') todos.push(actual);
  return { cabecera: todos[0] ?? '', registros: todos.slice(1) };
}
const idDeRegistro = (l: string): string => {
  const m = /^"((?:[^"]|"")*)"|^([^,]*)/.exec(l);
  return (m?.[1] !== undefined ? m[1].replace(/""/g, '"') : (m?.[2] ?? '')).trim();
};

/** Ids de producto (primera columna) de un CSV de Inventarios; admite campos entre comillas. */
export function idsDeCatalogo(csv: string): string[] {
  return registrosCsv(csv).registros.map(idDeRegistro);
}

/** Parte el CSV en lotes de hasta `max` filas, cada uno con la cabecera; el orden y los ids se conservan. */
export function lotesDeCatalogo(csv: string, max: number = MAX_FILAS_CSV): { csv: string; ids: string[] }[] {
  const { cabecera, registros } = registrosCsv(csv);
  const lotes: { csv: string; ids: string[] }[] = [];
  for (let i = 0; i < registros.length; i += max) {
    const trozo = registros.slice(i, i + max);
    lotes.push({ csv: `${[cabecera, ...trozo].join('\r\n')}\r\n`, ids: trozo.map(idDeRegistro) });
  }
  return lotes;
}

const json = (x: unknown): string => JSON.stringify(ordenar(x));
function ordenar(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(ordenar);
  if (typeof x === 'object' && x !== null) {
    return Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, ordenar(v)]));
  }
  return x;
}
/** `deseado` está contenido en `actual` (mismas claves y valores; `actual` puede traer campos extra). */
function contiene(actual: unknown, deseado: unknown): boolean {
  if (typeof deseado === 'object' && deseado !== null && !Array.isArray(deseado)) {
    if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) return false;
    return Object.entries(deseado as Record<string, unknown>).every(([k, v]) => contiene((actual as Record<string, unknown>)[k], v));
  }
  return json(actual) === json(deseado);
}

const llamada = (etapa: string, modulo: Modulo, accion: string, datos: Record<string, unknown>, como: Actor = 'adm'): PasoLlamada => ({
  tipo: 'llamada', etapa, modulo, accion, datos, como,
});

// ---- Planificador -------------------------------------------------------------------------------------------------

/** Plan completo: etapas en el orden en que se ejecutan. */
export function planificarDemo(catalogoCsv: string, fx: FixtureDemo, estado: EstadoDemo, opciones: OpcionesDemo): PlanDemo {
  const V = opciones.version ?? VERSION_DEMO;
  const pasos: Paso[] = [];
  const diferencias: string[] = [];
  const bloqueos: string[] = [];

  // 1) Roles de supervisión y caja (las cuentas las crea personal-tenant).
  for (const rol of ['sup', 'caj'] as const) {
    const c = estado.cuentas[rol];
    if (c === null) {
      bloqueos.push(`falta la cuenta de ${rol}: ejecute personal-tenant primero`);
      diferencias.push(`rol ${rol}: cuenta inexistente`);
    } else if (c.rolActual !== rol) {
      diferencias.push(`rol ${rol}: por asignar`);
      pasos.push(llamada('roles', 'consola', 'asignarRol', { uid: c.uid, rol }));
    }
  }

  // 2) Almacenes.
  for (const a of fx.almacenes) {
    if (estado.ubicaciones.includes(a.id)) continue;
    diferencias.push('almacén por crear');
    pasos.push(llamada('almacenes', 'inventarios', 'crearUbicacion', { operacionId: `${V}-ubicacion-${a.id}`, ubicacionId: a.id, nombre: a.nombre }));
  }

  // 3) Catálogo con stock inicial, en lotes de hasta 50 filas (límite de la importación). Cada lote es todo o nada:
  // la carga inicial falla si algún producto ya existe. El primer lote conserva el operacionId `demo-v1-catalogo`.
  const ids = idsDeCatalogo(catalogoCsv);
  const lotes = lotesDeCatalogo(catalogoCsv);
  const existentes = ids.filter((i) => estado.productos.includes(i));
  let lotesPorCargar = 0;
  let parcial = false;
  lotes.forEach((lote, n) => {
    const hay = lote.ids.filter((i) => estado.productos.includes(i)).length;
    if (hay === 0) {
      lotesPorCargar += 1;
      pasos.push(llamada('catalogo', 'inventarios', 'importarProductosCsv', {
        operacionId: n === 0 ? `${V}-catalogo` : `${V}-catalogo-${String(n + 1)}`, csv: lote.csv, cargaInicial: true,
      }));
    } else if (hay < lote.ids.length) parcial = true;
  });
  if (parcial) {
    bloqueos.push('el catálogo existe solo en parte: revise el tenant a mano (la carga inicial no admite productos repetidos)');
    diferencias.push(`catálogo parcial: ${String(existentes.length)} de ${String(ids.length)}`);
  } else if (lotesPorCargar > 0) {
    diferencias.push(`catálogo por cargar: ${String(ids.length - existentes.length)} productos`);
  }

  // 3b) Retiro de lo que no está en el fixture (opcional): activo=false y publicado=false, sin borrar.
  if (opciones.retirarFueraDelFixture === true) {
    const delFixture = new Set(ids);
    const porRetirar = (estado.productosVisibilidad ?? []).filter((p) => !delFixture.has(p.id) && (p.activo || p.publicado));
    if (porRetirar.length > 0) diferencias.push(`por retirar: ${String(porRetirar.length)}`);
    for (const p of porRetirar) pasos.push(llamada('retiro', 'consola', 'editarProducto', { productoId: p.id, cambios: { activo: false, publicado: false } }));
  }

  // 4) Series, por almacén (todo o nada por almacén).
  const porAlmacen = new Map<string, { productoId: string; series: readonly string[] }[]>();
  for (const g of fx.series) porAlmacen.set(g.ubicacionId, [...(porAlmacen.get(g.ubicacionId) ?? []), { productoId: g.productoId, series: g.series }]);
  for (const [ubicacionId, grupos] of porAlmacen) {
    const todas = grupos.flatMap((g) => g.series);
    const presentes = todas.filter((s) => estado.series[s] !== undefined);
    if (presentes.length === todas.length) continue;
    if (presentes.length > 0) {
      bloqueos.push('hay series cargadas solo en parte: revise el tenant a mano');
      diferencias.push('series parciales');
      continue;
    }
    diferencias.push(`series por ingresar: ${String(todas.length)}`);
    pasos.push(llamada('series', 'inventarios', 'ingresar', {
      operacionId: `${V}-series-${ubicacionId}`,
      ubicacionId,
      lineas: grupos.map((g) => ({ productoId: g.productoId, cantidad: g.series.length, series: [...g.series] })),
    }));
  }

  // 5) Traspaso de series entre almacenes.
  const enDestino = fx.traspaso.lineas.flatMap((l) => l.series).every((s) => estado.series[s] === fx.traspaso.destinoId);
  if (!enDestino) {
    diferencias.push('traspaso por hacer');
    pasos.push(llamada('traspaso', 'inventarios', 'traspasar', {
      operacionId: `${V}-traspaso-1`,
      origenId: fx.traspaso.origenId,
      destinoId: fx.traspaso.destinoId,
      lineas: fx.traspaso.lineas.map((l) => ({ productoId: l.productoId, cantidad: l.series.length, series: [...l.series] })),
    }));
  }

  // 6) Plantilla de recibos y configuración del sitio.
  if (estado.plantilla === null || !contiene(estado.plantilla, fx.recibos.plantilla)) {
    diferencias.push('plantilla de recibos por guardar');
    pasos.push(llamada('recibos', 'recibos', 'guardarPlantilla', { plantilla: fx.recibos.plantilla }));
  }
  if (estado.configSitio === null || !contiene(estado.configSitio, fx.sitio.config)) {
    diferencias.push('configuración del sitio por guardar');
    pasos.push(llamada('sitio', 'consola', 'guardarConfigSitio', { config: fx.sitio.config }));
  }

  // 7) Fotos: antes de las fichas, porque la ficha referencia medios ya procesados. Cada foto tiene hasta 3 intentos
  // (id base, `-r2`, `-r3`): una subida rechazada o en borrado se da por fallida y se pasa al siguiente id. Las reservas
  // rechazadas liberan su cupo de 5 fotos por producto en el servidor, así que los reintentos no lo agotan.
  const mediosFicha = new Map<string, { medioId: string; alt: string }[]>();
  let fotosPendientes = 0;
  for (const f of fx.fichas) {
    const hechos = new Set(estado.medios[f.productoId] ?? []);
    const lista: { medioId: string; alt: string }[] = [];
    f.fotos.forEach((foto, i) => {
      const candidatos = Array.from({ length: MAX_INTENTOS_FOTO }, (_, k) => subidaIdDe(f.productoId, i + 1, V, k + 1));
      const hecho = candidatos.find((c) => hechos.has(c) || estado.subidas?.[c] === 'procesada');
      if (hecho !== undefined) {
        lista.push({ medioId: hecho, alt: foto.alt });
        return;
      }
      if (!opciones.fotos) return;
      const vivo = candidatos.find((c) => { const e = estado.subidas?.[c]; return e === undefined || e === 'reservada'; });
      if (vivo === undefined) {
        bloqueos.push(`una foto falló ${String(MAX_INTENTOS_FOTO)} veces (el servidor rechazó todos los intentos): revise el archivo`);
        diferencias.push('foto sin intentos disponibles');
        return;
      }
      lista.push({ medioId: vivo, alt: foto.alt });
      fotosPendientes += 1;
      pasos.push({ tipo: 'foto', etapa: 'fotos', productoId: f.productoId, subidaId: vivo, archivo: foto.archivo, bytes: opciones.bytesFoto[foto.archivo] ?? 0 });
    });
    mediosFicha.set(f.productoId, lista);
  }
  if (fotosPendientes > 0) diferencias.push(`fotos por subir: ${String(fotosPendientes)}`);

  // 8) Fichas del sitio.
  let fichasPendientes = 0;
  for (const f of fx.fichas) {
    const deseada = { ...f.ficha, medios: mediosFicha.get(f.productoId) ?? [] };
    const actual = estado.fichas[f.productoId];
    if (actual !== undefined && contiene(actual, deseada)) continue;
    fichasPendientes += 1;
    pasos.push(llamada('fichas', 'consola', 'guardarFicha', { productoId: f.productoId, ficha: deseada }));
  }
  if (fichasPendientes > 0) diferencias.push(`fichas por guardar: ${String(fichasPendientes)}`);

  // 9) Publicación: si algo del sitio o del catálogo cambió, o nunca se publicó.
  const cambioSitio = pasos.some((p) => p.etapa !== 'roles');
  const sinPublicar = estado.tablero.versionPublicada === 0 || estado.tablero.cambiosSinPublicar > 0;
  if (cambioSitio || sinPublicar) {
    diferencias.push('sitio por publicar');
    pasos.push(llamada('publicacion', 'consola', 'publicarSitio', {}));
  }

  // 10) Ventas de muestra como cajero: turno abierto, 3 ventas, turno cerrado.
  if (opciones.ventas) {
    const turnoId = turnoIdDemo(V);
    const turno = estado.turnos.find((t) => t.turnoId === turnoId);
    const otroAbierto = estado.turnos.some((t) => t.turnoId !== turnoId && t.estado === 'abierto');
    const faltan = fx.pos.ventas.filter((v) => !estado.ventas.includes(ventaIdDemo(v.clave, V)));
    const sinCerrar = turno === undefined || turno.estado === 'abierto';
    if (otroAbierto && turno === undefined) {
      bloqueos.push('hay otro turno abierto en la caja: ciérrelo antes de cargar las ventas de muestra');
    } else if (faltan.length > 0 || sinCerrar) {
      if (turno === undefined) {
        diferencias.push('turno por abrir');
        pasos.push(llamada('ventas', 'pos', 'abrirTurno', { turnoId, apertura: fx.pos.apertura }, 'caj'));
      }
      if (faltan.length > 0) diferencias.push(`ventas por registrar: ${String(faltan.length)}`);
      for (const v of faltan) {
        pasos.push(llamada('ventas', 'pos', 'confirmarVenta', { requestId: ventaIdDemo(v.clave, V), carrito: v.carrito, pagos: v.pagos }, 'caj'));
      }
      if (sinCerrar) {
        diferencias.push('turno por cerrar');
        pasos.push(llamada('ventas', 'pos', 'cerrarTurno', { turnoId, contado: fx.pos.contado }, 'caj'));
      }
    }
  }

  return { pasos, diferencias, bloqueos };
}
