// Registro de módulos. No lleva ninguna importación (ni de tipos): por eso
// trabaja sobre la forma mínima estructural `ManifiestoBase`, que
// `ManifiestoModulo` (tipos.ts) satisface; index.ts lo verifica al compilar.

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
}

type IdModulo = string;

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
const ROLES = ['caj', 'sup', 'adm'];
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
}

function validar(m: ManifiestoBase): void {
  if (typeof m.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(m.id)) {
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
      if (!ROLES.includes(r)) throw new ErrorRegistro(`Rol inválido en ${m.id}/${c.ruta}: ${r}`);
    }
    if (c.escritura !== 'servidor') {
      for (const r of c.escritura) {
        if (!ROLES.includes(r)) throw new ErrorRegistro(`Rol inválido en ${m.id}/${c.ruta}: ${r}`);
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
      if (c.ruta === 'tenants') throw new ErrorRegistro(`${donde}: no puede llamarse "tenants"`);
      if (c.lectura.length > 0) throw new ErrorRegistro(`${donde}: la lectura debe ser [] (solo el servidor lee)`);
      if (c.escritura !== 'servidor') throw new ErrorRegistro(`${donde}: la escritura debe ser 'servidor'`);
      if (c.limite !== undefined) throw new ErrorRegistro(`${donde}: no admite límite de plan`);
    }
  }
  for (const a of m.almacenamiento ?? []) validarAlmacenamiento(m, a);
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
    if (!ROLES.includes(r)) throw new ErrorRegistro(`${donde}: rol inválido ${r}`);
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
      return orden;
    },
    rutas,
    rutasAlmacenamiento,
  };
}
