// Registro de módulos. No lleva ninguna importación (ni de tipos): por eso
// trabaja sobre la forma mínima estructural `ManifiestoBase`, que
// `ManifiestoModulo` (tipos.ts) satisface; index.ts lo verifica al compilar.
/**
 * Tipos con contrato v1. Copia sin importaciones de las claves de `CONTRATOS_V1` (eventos/contratos.ts);
 * pruebas/tenant/contrato-l2.test.ts verifica la paridad.
 */
export const TIPOS_EVENTO_V1: readonly string[] = [
  'venta.confirmada',
  'venta.anulada',
  'turno.cerrado',
  'producto.cambiado',
  'stock.cambiado',
  'stock.bajo',
  'recibo.emitido',
  'pedido.solicitado',
  'pedido.confirmado',
];

/** Forma mínima que el registro necesita de un manifiesto. */
export interface ManifiestoBase {
  readonly id: string;
  readonly version: string;
  readonly dependeDe: readonly string[];
  readonly colecciones: readonly {
    readonly ruta: string;
    readonly lectura: readonly string[];
    readonly escritura: 'servidor' | readonly string[];
    readonly limite?: string | undefined;
    readonly ambito?: string | undefined;
  }[];
  readonly almacenamiento?:
    | readonly {
        readonly ruta: string;
        readonly lectura: string;
        readonly escritura:
          | 'servidor'
          | {
              readonly tipo: string;
              readonly roles: readonly string[];
              readonly reserva: string;
              readonly archivos: readonly { readonly tipo: string; readonly bytesMax: number; readonly contentType: string }[];
            };
      }[]
    | undefined;
  readonly zona?: string | undefined;
  readonly pantallas?: readonly PantallaBase[] | undefined;
  readonly acciones?: readonly AccionBase[] | undefined;
  readonly programadas?: readonly ProgramadaBase[] | undefined;
  readonly requiere?: readonly string[] | undefined;
  readonly emite?: readonly string[] | undefined;
  readonly consume?: readonly string[] | undefined;
  readonly consumeOpcional?: readonly string[] | undefined;
  readonly rutasHttp?: readonly RutaHttpBase[] | undefined;
}

type IdModulo = string;

/** Ids que ningún tenant enciende: siempre presentes o fuera de su alcance. */
export const NO_ENCENDIBLES = ['nucleo', 'panel', 'plataforma'] as const;

/** Fila agregada por el registro: el elemento del manifiesto y su módulo dueño. */
export type ConModulo<T> = T & { readonly modulo: string };

export interface PantallaBase {
  readonly id: string;
  readonly titulo: string;
  readonly roles: readonly RolBase[];
  readonly orden: number;
  readonly tituloPorRol?: Partial<Record<RolBase, string>> | undefined;
}
export interface AccionBase {
  readonly callable: string;
  readonly nombre: string;
  readonly roles: readonly RolBase[];
  readonly propietario?: boolean | undefined;
}
export interface RutaHttpBase {
  readonly ruta: string;
  readonly prefijo?: boolean | undefined;
}
export interface ProgramadaBase {
  readonly id: string;
  readonly horario: string;
  readonly zonaHoraria: string;
  readonly porTenant: boolean;
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
// Mismo criterio que el generador de reglas (scripts/generar-reglas.mjs); el
// núcleo no puede importarlo, y pruebas/reglas/raiz.test.ts verifica la paridad.
const SEGMENTO = /^[A-Za-z][A-Za-z0-9_-]*$/;
// Almacenamiento: mismo segmento, o variable `{nombre}`; `{nombre=**}` solo al final.
const SEGMENTO_ALM = /^(?:[A-Za-z][A-Za-z0-9_-]*|\{[A-Za-z][A-Za-z0-9_]*\})$/;
const TIPO_ARCHIVO = /^[a-z][a-z0-9_]*$/;
const VARIABLES_RESERVADAS = ['tenantId', 'todo', 'bucket'];
const SEGMENTO_RESTO = /^\{[A-Za-z][A-Za-z0-9_]*=\*\*\}$/;
const CONTENT_TYPE = /^[a-z]+\/\([a-z0-9|-]+\)$/;
const NOMBRE_L2 = /^[a-z][a-zA-Z0-9]*$/;
const RUTA_HTTP = /^\/api(?:\/[a-z0-9_-]+)+$/;
const ID_MODULO = /^[a-z][a-z0-9-]*$/;
const HORARIO = /^(?:[0-9*/,\- ]+|every [1-9][0-9]* (?:minutes|hours)|every day (?:[01][0-9]|2[0-3]):[0-5][0-9])$/;
const ZONAS = ['nucleo', 'central', 'plataforma', 'modulo'];
const ROLES = ['caj', 'sup', 'adm'] as const;
/** Mismo conjunto que `Rol` de tipos.ts (sin importarlo). Si divergen, deja de compilar: `crearRegistro<ManifiestoModulo>` en plataforma/registro.ts y la asignación de roles en plataforma/coordinador/encendido.ts exigen que coincidan. */
export type RolBase = (typeof ROLES)[number];
const esRol = (r: unknown): r is RolBase => (ROLES as readonly unknown[]).includes(r);
/** Único manifiesto que puede declarar la raíz `tenants` (mismo valor que scripts/generar-reglas.mjs). */
const ID_DUENO_TENANTS = 'plataforma';
const LIMITES = ['productos', 'usuarios', 'cajas', 'almacenes'];

export class ErrorRegistro extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorRegistro';
  }
}

export interface Registro<M extends ManifiestoBase = ManifiestoBase> {
  registrar(manifiesto: M): void;
  listar(): readonly M[];
  /** Módulos ordenados de modo que cada uno aparece después de sus dependencias. */
  ordenTopologico(): readonly IdModulo[];
  /** Rutas de colecciones de todos los módulos; lanza si hay duplicados. */
  rutas(): readonly string[];
  /** Rutas de almacenamiento de todos los módulos; lanza si hay duplicados o más de una subida reservada. */
  rutasAlmacenamiento(): readonly string[];
  /** Acciones de todos los módulos con su módulo dueño; lanza si (callable, nombre) se repite. */
  acciones(): readonly ConModulo<AccionBase>[];
  /** Pantallas de todos los módulos con su módulo dueño; lanza si un id se repite. */
  pantallas(): readonly ConModulo<PantallaBase>[];
  /** Programadas de todos los módulos con su módulo dueño; lanza si un id se repite. */
  programadas(): readonly ConModulo<ProgramadaBase>[];
  /** Rutas HTTP de todos los módulos con su módulo dueño; lanza si se repiten o si una cae bajo el prefijo de otro módulo. */
  rutasHttp(): readonly ConModulo<RutaHttpBase>[];
}

function validar(m: ManifiestoBase): void {
  if (typeof m.id !== 'string' || !ID_MODULO.test(m.id)) {
    throw new ErrorRegistro(`Id de módulo inválido: ${String(m.id)}`);
  }
  if (!SEMVER.test(m.version)) {
    throw new ErrorRegistro(`Versión no semver en ${m.id}: ${m.version}`);
  }
  if (m.dependeDe.includes(m.id)) {
    throw new ErrorRegistro(`El módulo ${m.id} depende de sí mismo`);
  }
  for (const c of m.colecciones) {
    if (c.ruta === '' || c.ruta.startsWith('/') || c.ruta.endsWith('/') || c.ruta.split('/').includes('..')) {
      throw new ErrorRegistro(`Ruta inválida en ${m.id}: "${c.ruta}"`);
    }
    if (!c.ruta.split('/').every((s) => SEGMENTO.test(s))) {
      throw new ErrorRegistro(`Ruta con caracteres no admitidos: "${c.ruta}"`);
    }
    // Una colección de tenant tiene un número impar de segmentos (el documento, par).
    if (c.ambito !== 'raiz' && c.ruta.split('/').length % 2 === 0) {
      throw new ErrorRegistro(`La ruta "${c.ruta}" no es una colección válida de Firestore (número par de segmentos)`);
    }
    for (const r of c.lectura) {
      if (!esRol(r)) throw new ErrorRegistro(`Rol inválido en ${m.id}/${c.ruta}: ${r}`);
    }
    if (c.escritura !== 'servidor') {
      for (const r of c.escritura) {
        if (!esRol(r)) throw new ErrorRegistro(`Rol inválido en ${m.id}/${c.ruta}: ${r}`);
      }
    }
    if (c.limite !== undefined && !LIMITES.includes(c.limite)) {
      throw new ErrorRegistro(`Límite inválido en ${m.id}/${c.ruta}: ${c.limite}`);
    }
    if (c.ambito !== undefined && c.ambito !== 'tenant' && c.ambito !== 'raiz') {
      throw new ErrorRegistro(`Ámbito inválido en ${m.id}/${c.ruta}: ${c.ambito}`);
    }
    if (c.ambito === 'raiz') {
      const donde = `Colección de raíz ${m.id}/${c.ruta}`;
      if (c.ruta.includes('/')) throw new ErrorRegistro(`${donde}: la ruta debe tener un solo segmento`);
      // Excepción explícita (L2-5): `tenants` solo puede ser raíz del manifiesto `plataforma` (dueño del documento del tenant).
      if (c.ruta === 'tenants' && m.id !== ID_DUENO_TENANTS) {
        throw new ErrorRegistro(`${donde}: no puede llamarse "tenants"`);
      }
      if (c.lectura.length > 0) throw new ErrorRegistro(`${donde}: la lectura debe ser [] (solo el servidor lee)`);
      if (c.escritura !== 'servidor') throw new ErrorRegistro(`${donde}: la escritura debe ser 'servidor'`);
      if (c.limite !== undefined) throw new ErrorRegistro(`${donde}: no admite límite de plan`);
    }
  }
  for (const a of m.almacenamiento ?? []) validarAlmacenamiento(m, a);
  validarL2(m);
  validarConsumeOpcional(m);
}

function validarConsumeOpcional(m: ManifiestoBase): void {
  const opc = lista(m, 'consumeOpcional', m.consumeOpcional);
  const consume = Array.isArray(m.consume) ? m.consume : [];
  const vistos = new Set<string>();
  for (const e of opc) {
    if (typeof e !== 'string' || !TIPOS_EVENTO_V1.includes(e)) {
      throw new ErrorRegistro(`El módulo ${m.id} declara en consumeOpcional un evento sin contrato v1: ${String(e)}`);
    }
    if (consume.includes(e)) throw new ErrorRegistro(`El módulo ${m.id} declara "${e}" en consume y en consumeOpcional`);
    if (vistos.has(e)) throw new ErrorRegistro(`El módulo ${m.id} repite "${e}" en consumeOpcional`);
    vistos.add(e);
  }
}

function validarRoles(donde: string, roles: readonly string[], admiteVacia: boolean): void {
  if (!Array.isArray(roles)) throw new ErrorRegistro(`${donde}: roles debe ser una lista`);
  // Lista vacía: una pantalla sería invisible y una acción sin propietario, inalcanzable.
  if (roles.length === 0 && !admiteVacia) {
    throw new ErrorRegistro(`${donde}: roles no puede estar vacío (inalcanzable o invisible)`);
  }
  for (const r of roles) {
    if (!esRol(r)) throw new ErrorRegistro(`${donde}: rol inválido ${String(r)}`);
  }
}

function lista<T>(m: ManifiestoBase, campo: string, v: readonly T[] | undefined): readonly T[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new ErrorRegistro(`${m.id}: ${campo} debe ser una lista`);
  return v;
}

function tieneControl(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return true;
  }
  return false;
}

/** Texto visible: no vacío, hasta 60 caracteres y sin caracteres de control. */
function validarTexto(donde: string, campo: string, v: unknown): void {
  if (typeof v !== 'string' || v.trim() === '' || v.length > 60 || tieneControl(v)) {
    throw new ErrorRegistro(`${donde}: ${campo} debe ser un texto de 1 a 60 caracteres sin caracteres de control`);
  }
}

let zonasValidas: ReadonlySet<string> | undefined;
function zonaHorariaValida(z: string): boolean {
  if (zonasValidas === undefined) {
    try {
      zonasValidas = new Set(Intl.supportedValuesOf('timeZone'));
    } catch {
      zonasValidas = new Set();
    }
  }
  if (zonasValidas.size > 0 && (zonasValidas.has(z) || z === 'UTC')) return true;
  return zonasValidas.size === 0 && /^[A-Za-z]+(\/[A-Za-z0-9_+-]+)+$|^UTC$/.test(z);
}

function validarL2(m: ManifiestoBase): void {
  if (m.zona !== undefined && !ZONAS.includes(m.zona)) {
    throw new ErrorRegistro(`Zona inválida en ${m.id}: ${String(m.zona)}`);
  }
  if (m.zona !== undefined && (m.zona !== 'modulo') !== (NO_ENCENDIBLES as readonly string[]).includes(m.id)) {
    throw new ErrorRegistro(`Zona ${m.zona} incoherente con el id ${m.id} (los ids no encendibles no son de zona modulo, y los demás sí)`);
  }
  const pantallas = lista(m, 'pantallas', m.pantallas);
  const acciones = lista(m, 'acciones', m.acciones);
  const programadas = lista(m, 'programadas', m.programadas);
  const requiere = lista(m, 'requiere', m.requiere);
  const rutasHttp = lista(m, 'rutasHttp', m.rutasHttp);
  if (m.zona === 'nucleo' && (pantallas.length > 0 || acciones.length > 0)) {
    throw new ErrorRegistro(`El módulo ${m.id} es de zona nucleo y no admite pantallas ni acciones`);
  }
  const ids = new Set<string>();
  for (const p of pantallas) {
    const donde = `Pantalla ${m.id}/${String(p.id)}`;
    if (typeof p.id !== 'string' || !NOMBRE_L2.test(p.id)) throw new ErrorRegistro(`${donde}: id inválido`);
    if (ids.has(p.id)) throw new ErrorRegistro(`${donde}: id de pantalla duplicado`);
    ids.add(p.id);
    validarTexto(donde, 'titulo', p.titulo);
    if (!Number.isInteger(p.orden) || p.orden < 0) throw new ErrorRegistro(`${donde}: orden debe ser un entero >= 0`);
    validarRoles(donde, p.roles, false);
    const porRol = p.tituloPorRol ?? {};
    for (const [r, t] of Object.entries(porRol)) {
      if (!esRol(r)) throw new ErrorRegistro(`${donde}: rol inválido en tituloPorRol: ${r}`);
      validarTexto(donde, `tituloPorRol.${r}`, t);
    }
  }
  const pares = new Set<string>();
  for (const a of acciones) {
    const donde = `Acción ${m.id}/${String(a.callable)}/${String(a.nombre)}`;
    if (typeof a.callable !== 'string' || !NOMBRE_L2.test(a.callable)) throw new ErrorRegistro(`${donde}: callable inválido`);
    if (typeof a.nombre !== 'string' || !NOMBRE_L2.test(a.nombre)) throw new ErrorRegistro(`${donde}: nombre inválido`);
    const par = `${a.callable}.${a.nombre}`;
    if (pares.has(par)) throw new ErrorRegistro(`${donde}: acción duplicada`);
    pares.add(par);
    validarRoles(donde, a.roles, a.propietario === true);
    if (a.propietario !== undefined && typeof a.propietario !== 'boolean') {
      throw new ErrorRegistro(`${donde}: propietario debe ser booleano`);
    }
  }
  const progs = new Set<string>();
  for (const p of programadas) {
    const donde = `Programada ${m.id}/${String(p.id)}`;
    if (typeof p.id !== 'string' || !NOMBRE_L2.test(p.id)) throw new ErrorRegistro(`${donde}: id inválido`);
    if (progs.has(p.id)) throw new ErrorRegistro(`${donde}: id de programada duplicado`);
    progs.add(p.id);
    if (typeof p.horario !== 'string' || !HORARIO.test(p.horario.trim()) || p.horario.trim() === '') {
      throw new ErrorRegistro(`${donde}: horario inválido (cron con 0-9 * / , - y espacios, "every N minutes|hours" o "every day HH:MM")`);
    }
    if (typeof p.zonaHoraria !== 'string' || !zonaHorariaValida(p.zonaHoraria)) {
      throw new ErrorRegistro(`${donde}: zonaHoraria inválida`);
    }
    if (typeof p.porTenant !== 'boolean') throw new ErrorRegistro(`${donde}: porTenant debe ser booleano`);
  }
  if (rutasHttp.length > 0 && ((m.zona !== undefined && m.zona !== 'modulo') || (NO_ENCENDIBLES as readonly string[]).includes(m.id))) {
    throw new ErrorRegistro(`El módulo ${m.id} no es de zona modulo y no admite rutasHttp`);
  }
  const rutas = new Set<string>();
  for (const r of rutasHttp) {
    const donde = `Ruta HTTP ${m.id}/${String(r?.ruta)}`;
    if (typeof r?.ruta !== 'string' || !RUTA_HTTP.test(r.ruta) || r.ruta.endsWith('/')) {
      throw new ErrorRegistro(`${donde}: ruta inválida (^/api/[a-z0-9_/-]+$, sin barra final)`);
    }
    if (r.prefijo !== undefined && typeof r.prefijo !== 'boolean') throw new ErrorRegistro(`${donde}: prefijo debe ser booleano`);
    if (rutas.has(r.ruta)) throw new ErrorRegistro(`${donde}: ruta duplicada`);
    rutas.add(r.ruta);
  }
  const req = new Set<string>();
  for (const d of requiere) {
    if (typeof d !== 'string' || !ID_MODULO.test(d)) throw new ErrorRegistro(`El módulo ${m.id} tiene un id inválido en requiere`);
    if (d === m.id) throw new ErrorRegistro(`El módulo ${m.id} se requiere a sí mismo`);
    if (req.has(d)) throw new ErrorRegistro(`El módulo ${m.id} repite "${d}" en requiere`);
    req.add(d);
  }
}

function validarAlmacenamiento(m: ManifiestoBase, a: NonNullable<ManifiestoBase['almacenamiento']>[number]): void {
  const donde = `Almacenamiento ${m.id}/${a.ruta}`;
  const segs = a.ruta.split('/');
  if (segs[0] !== 'privado' && segs[0] !== 'publico') {
    throw new ErrorRegistro(`${donde}: el primer segmento debe ser "privado" o "publico"`);
  }
  if (segs.length < 2) throw new ErrorRegistro(`${donde}: falta al menos un segmento tras "${segs[0]}"`);
  segs.forEach((s, i) => {
    const ultimo = i === segs.length - 1;
    if (!(SEGMENTO_ALM.test(s) || (ultimo && i > 0 && SEGMENTO_RESTO.test(s)))) {
      throw new ErrorRegistro(`${donde}: segmento no admitido "${s}"`);
    }
    const variable = /^\{([A-Za-z][A-Za-z0-9_]*)(?:=\*\*)?\}$/.exec(s)?.[1];
    if (variable !== undefined && VARIABLES_RESERVADAS.includes(variable)) {
      throw new ErrorRegistro(`${donde}: variable de ruta reservada "{${variable}}"`);
    }
  });
  if (a.lectura !== 'servidor' && a.lectura !== 'publica') {
    throw new ErrorRegistro(`${donde}: lectura inválida "${String(a.lectura)}"`);
  }
  if (a.lectura === 'publica' && segs[0] !== 'publico') {
    throw new ErrorRegistro(`${donde}: la lectura 'publica' solo vale bajo publico/`);
  }
  if (a.escritura === 'servidor') return;
  const e = a.escritura;
  if (e.tipo !== 'subidaReservada') throw new ErrorRegistro(`${donde}: escritura inválida`);
  if (segs[0] !== 'privado') throw new ErrorRegistro(`${donde}: subidaReservada solo vale bajo privado/`);
  if (segs.length < 3 || segs[segs.length - 2] !== '{productoId}' || segs[segs.length - 1] !== '{subidaId}') {
    throw new ErrorRegistro(`${donde}: la ruta de subidaReservada debe terminar en {productoId}/{subidaId}`);
  }
  if (e.roles.length === 0) throw new ErrorRegistro(`${donde}: roles no puede estar vacío`);
  for (const r of e.roles) {
    if (!esRol(r)) throw new ErrorRegistro(`${donde}: rol inválido ${r}`);
  }
  const reserva = m.colecciones.find((c) => c.ruta === e.reserva);
  if (reserva === undefined) {
    throw new ErrorRegistro(`${donde}: la reserva "${e.reserva}" no es una colección del mismo manifiesto`);
  }
  if (reserva.escritura !== 'servidor' || (reserva.ambito !== undefined && reserva.ambito !== 'tenant')) {
    throw new ErrorRegistro(`${donde}: la reserva "${e.reserva}" debe ser de ámbito tenant y con escritura 'servidor'`);
  }
  if (e.archivos.length === 0) throw new ErrorRegistro(`${donde}: archivos no puede estar vacío`);
  const tipos = new Set<string>();
  for (const f of e.archivos) {
    if (typeof f.tipo !== 'string' || f.tipo === '') throw new ErrorRegistro(`${donde}: tipo de archivo vacío`);
    if (!TIPO_ARCHIVO.test(f.tipo)) {
      throw new ErrorRegistro(`${donde}: tipo de archivo "${f.tipo}" no cumple el patrón ^[a-z][a-z0-9_]*$`);
    }
    if (tipos.has(f.tipo)) throw new ErrorRegistro(`${donde}: tipo de archivo duplicado "${f.tipo}"`);
    tipos.add(f.tipo);
    if (!Number.isInteger(f.bytesMax) || f.bytesMax <= 0) {
      throw new ErrorRegistro(`${donde}: bytesMax de "${f.tipo}" debe ser un entero mayor que 0`);
    }
    if (!CONTENT_TYPE.test(f.contentType)) {
      throw new ErrorRegistro(`${donde}: contentType de "${f.tipo}" no cumple el patrón (por ejemplo image/(jpeg|png))`);
    }
  }
}

export function crearRegistro<M extends ManifiestoBase = ManifiestoBase>(): Registro<M> {
  const modulos = new Map<IdModulo, M>();

  function rutas(): string[] {
    const vistas = new Map<string, IdModulo>();
    const todas: string[] = [];
    for (const m of modulos.values()) {
      for (const c of m.colecciones) {
        const previo = vistas.get(c.ruta);
        if (previo !== undefined) {
          throw new ErrorRegistro(`Ruta duplicada "${c.ruta}" (${previo} y ${m.id})`);
        }
        vistas.set(c.ruta, m.id);
        todas.push(c.ruta);
      }
    }
    return todas;
  }

  function rutasAlmacenamiento(): string[] {
    const vistas = new Map<string, IdModulo>();
    const todas: string[] = [];
    let reservada: string | undefined;
    for (const m of modulos.values()) {
      for (const a of m.almacenamiento ?? []) {
        const previo = vistas.get(a.ruta);
        if (previo !== undefined) {
          throw new ErrorRegistro(`Ruta de almacenamiento duplicada "${a.ruta}" (${previo} y ${m.id})`);
        }
        vistas.set(a.ruta, m.id);
        todas.push(a.ruta);
        if (a.escritura !== 'servidor') {
          if (reservada !== undefined) {
            throw new ErrorRegistro(`Más de una subidaReservada en el registro (${reservada} y ${m.id}/${a.ruta})`);
          }
          reservada = `${m.id}/${a.ruta}`;
        }
      }
    }
    return todas;
  }

  function agregar<T>(
    sacar: (m: M) => readonly T[] | undefined,
    clave: (x: T) => string,
    que: string,
  ): ConModulo<T>[] {
    const vistas = new Map<string, IdModulo>();
    const todas: ConModulo<T>[] = [];
    for (const m of modulos.values()) {
      for (const x of sacar(m) ?? []) {
        const k = clave(x);
        const previo = vistas.get(k);
        if (previo !== undefined) throw new ErrorRegistro(`${que} duplicado "${k}" (${previo} y ${m.id})`);
        vistas.set(k, m.id);
        todas.push({ ...x, modulo: m.id });
      }
    }
    return todas;
  }

  function rutasHttp(): ConModulo<RutaHttpBase>[] {
    const todas = agregar((m) => m.rutasHttp, (r) => r.ruta, 'Ruta HTTP');
    for (const p of todas) {
      if (p.prefijo !== true) continue;
      for (const o of todas) {
        if (o.modulo !== p.modulo && (o.ruta === p.ruta || o.ruta.startsWith(`${p.ruta}/`))) {
          throw new ErrorRegistro(`Ruta HTTP "${o.ruta}" (${o.modulo}) cae bajo el prefijo "${p.ruta}" de ${p.modulo}`);
        }
      }
    }
    return todas;
  }

  return {
    registrar(manifiesto) {
      validar(manifiesto);
      if (modulos.has(manifiesto.id)) {
        throw new ErrorRegistro(`Módulo ya registrado: ${manifiesto.id}`);
      }
      const propias = new Set<string>();
      for (const c of manifiesto.colecciones) {
        if (propias.has(c.ruta)) throw new ErrorRegistro(`Ruta duplicada "${c.ruta}" (${manifiesto.id})`);
        propias.add(c.ruta);
        for (const otro of modulos.values()) {
          if (otro.colecciones.some((x) => x.ruta === c.ruta)) {
            throw new ErrorRegistro(`Ruta duplicada "${c.ruta}" (${otro.id} y ${manifiesto.id})`);
          }
        }
      }
      modulos.set(manifiesto.id, manifiesto);
    },
    listar() {
      return [...modulos.values()];
    },
    ordenTopologico() {
      const estado = new Map<IdModulo, 'visitando' | 'listo'>();
      const orden: IdModulo[] = [];
      const visitar = (id: IdModulo, camino: readonly IdModulo[]): void => {
        const actual = estado.get(id);
        if (actual === 'listo') return;
        if (actual === 'visitando') {
          throw new ErrorRegistro(`Ciclo de dependencias: ${[...camino, id].join(' -> ')}`);
        }
        const m = modulos.get(id);
        if (m === undefined) {
          const de = camino[camino.length - 1] ?? '?';
          throw new ErrorRegistro(`Dependencia ausente: ${de} depende de ${id}, que no está registrado`);
        }
        estado.set(id, 'visitando');
        for (const d of m.dependeDe) visitar(d, [...camino, id]);
        estado.set(id, 'listo');
        orden.push(id);
      };
      for (const id of modulos.keys()) visitar(id, []);
      // El orden alimenta las reglas generadas y solo depende de `dependeDe`; `requiere` es de
      // ejecución: aquí únicamente se valida (ausentes y ciclos sobre el grafo unión), sin alterar `orden`.
      const requeridos = (m: M): readonly IdModulo[] => (Array.isArray(m.requiere) ? m.requiere : []);
      const marca = new Map<IdModulo, 'visitando' | 'listo'>();
      const validar = (id: IdModulo, camino: readonly IdModulo[]): void => {
        const actual = marca.get(id);
        if (actual === 'listo') return;
        if (actual === 'visitando') {
          throw new ErrorRegistro(`Ciclo de dependencias: ${[...camino, id].join(' -> ')}`);
        }
        const m = modulos.get(id);
        if (m === undefined) return;
        marca.set(id, 'visitando');
        for (const d of m.dependeDe) validar(d, [...camino, id]);
        for (const d of requeridos(m)) {
          if (modulos.has(d)) validar(d, [...camino, id]);
          else if (!(NO_ENCENDIBLES as readonly string[]).includes(d)) {
            throw new ErrorRegistro(`Requiere ausente: ${id} requiere ${d}, que no está registrado`);
          }
        }
        marca.set(id, 'listo');
      };
      for (const id of modulos.keys()) validar(id, []);
      // consumeOpcional: al menos un emisor del evento debe estar en el cierre de dependeDe/requiere del consumidor.
      for (const m of modulos.values()) {
        const opc = m.consumeOpcional ?? [];
        if (opc.length === 0) continue;
        const cierre = new Set<IdModulo>();
        const pila: IdModulo[] = [m.id];
        while (pila.length > 0) {
          const actual = modulos.get(pila.pop() as IdModulo);
          if (actual === undefined) continue;
          for (const d of [...actual.dependeDe, ...requeridos(actual)]) {
            if (!cierre.has(d)) {
              cierre.add(d);
              pila.push(d);
            }
          }
        }
        for (const e of opc) {
          const hay = [...modulos.values()].some((x) => cierre.has(x.id) && (x.emite ?? []).includes(e));
          if (!hay) throw new ErrorRegistro(`${m.id} consume opcionalmente "${e}", pero ningún módulo de su dependeDe/requiere lo emite`);
        }
      }
      return orden;
    },
    rutas,
    rutasAlmacenamiento,
    acciones: () => agregar((m) => m.acciones, (a) => `${a.callable}.${a.nombre}`, 'Par (callable, nombre)'),
    pantallas: () => agregar((m) => m.pantallas, (p) => p.id, 'Id de pantalla'),
    rutasHttp,
    programadas: () => agregar((m) => m.programadas, (p) => p.id, 'Id de programada'),
  };
}
