import type { Rol } from '../registro/tipos.js';

/** Transacción mínima inyectable. Solo `create`: sin `update` ni `delete`, la auditoría es inmutable. */
export interface TransaccionAuditoria {
  create(ruta: string, datos: Readonly<Record<string, unknown>>): void;
  /** Identificador nuevo para un documento de la colección dada. */
  nuevoId(rutaColeccion: string): string;
  /** Marca de tiempo asignada por el servidor al confirmar. */
  marcaTiempoServidor(): unknown;
}

export type ValorResumen = string | number | boolean | null | readonly ValorResumen[] | { readonly [clave: string]: ValorResumen };
export type Resumen = { readonly [clave: string]: ValorResumen };

export interface EntradaAuditoria {
  readonly tenantId: string;
  readonly uid: string;
  readonly rol: Rol;
  readonly accion: string;
  readonly ruta: string;
  readonly resumenAntes?: Resumen;
  readonly resumenDespues?: Resumen;
  readonly motivo?: string;
}

export class ErrorAuditoria extends Error {}

const ROLES: readonly string[] = ['caj', 'sup', 'adm', 'dir'];
/** Claves (normalizadas) que se rechazan por igualdad exacta. */
const CLAVES_EXACTAS = new Set(['pin', 'email', 'correo', 'telefono', 'celular', 'documento', 'ci', 'nit', 'direccion']);
/** Fragmentos que se rechazan si aparecen dentro de la clave normalizada. */
const FRAGMENTOS = ['password', 'contrasena', 'token', 'secret', 'apikey', 'authorization', 'credencial', 'privatekey'];
const PROFUNDIDAD_MAXIMA = 5;

const normalizar = (clave: string): string =>
  clave
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const esProhibida = (clave: string): boolean => {
  const n = normalizar(clave);
  return CLAVES_EXACTAS.has(n) || FRAGMENTOS.some((f) => n.includes(f));
};

function revisar(valor: unknown, ruta: string, profundidad: number): void {
  if (profundidad > PROFUNDIDAD_MAXIMA) throw new ErrorAuditoria(`${ruta} excede la profundidad permitida`);
  if (Array.isArray(valor)) {
    valor.forEach((v, i) => revisar(v, `${ruta}[${i}]`, profundidad + 1));
  } else if (typeof valor === 'object' && valor !== null) {
    for (const [k, v] of Object.entries(valor)) {
      if (esProhibida(k)) throw new ErrorAuditoria(`${ruta}.${k}: clave prohibida (datos personales o secretos)`);
      revisar(v, `${ruta}.${k}`, profundidad + 1);
    }
  }
}

const SEGURO = /^[A-Za-z0-9._-]+$/;

/** Valida una entrada de auditoría; lanza `ErrorAuditoria` si es inválida. */
export function validarEntradaAuditoria(e: EntradaAuditoria): void {
  if (!SEGURO.test(e.tenantId)) throw new ErrorAuditoria('tenantId inválido');
  for (const c of ['uid', 'accion', 'ruta'] as const) {
    if (typeof e[c] !== 'string' || e[c].trim() === '') throw new ErrorAuditoria(`${c} requerido`);
  }
  if (!ROLES.includes(e.rol)) throw new ErrorAuditoria('rol inválido');
  if (e.motivo !== undefined && e.motivo.trim() === '') throw new ErrorAuditoria('motivo no puede estar vacío');
  if (e.resumenAntes !== undefined) revisar(e.resumenAntes, 'resumenAntes', 0);
  if (e.resumenDespues !== undefined) revisar(e.resumenDespues, 'resumenDespues', 0);
}

/** Escribe `tenants/{t}/auditoria/{id}` en la transacción dada (solo `create`). Devuelve el id. */
export function registrarAuditoria(tx: TransaccionAuditoria, entrada: EntradaAuditoria): string {
  validarEntradaAuditoria(entrada);
  const coleccion = `tenants/${entrada.tenantId}/auditoria`;
  const id = tx.nuevoId(coleccion);
  if (!SEGURO.test(id)) throw new ErrorAuditoria('id de auditoría inválido');
  const doc: Record<string, unknown> = {
    tenantId: entrada.tenantId,
    uid: entrada.uid,
    rol: entrada.rol,
    accion: entrada.accion,
    ruta: entrada.ruta,
    en: tx.marcaTiempoServidor(),
  };
  if (entrada.resumenAntes !== undefined) doc['resumenAntes'] = entrada.resumenAntes;
  if (entrada.resumenDespues !== undefined) doc['resumenDespues'] = entrada.resumenDespues;
  if (entrada.motivo !== undefined) doc['motivo'] = entrada.motivo;
  tx.create(`${coleccion}/${id}`, doc);
  return id;
}
