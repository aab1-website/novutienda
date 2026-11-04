import type { Moneda, Rol, TransaccionIdentidad } from '@plataforma/nucleo';
import {
  ahoraDe, auditar, exigirActor, exigirRol, exigirTenant, leerObligatorio, rutaConfig, type DepsPos,
} from './contexto.js';
import { ErrorPos } from './errores.js';
import { MEDIOS_PAGO, MONEDAS_POS, type ActorPos, type MedioPago } from './tipos.js';

/** Configuración del POS (`pos_config/main`). Topes de descuento en puntos básicos (500 = 5 %). */
export interface ConfigPos {
  readonly negocio: { readonly nombre: string; readonly direccion?: string; readonly telefono?: string; readonly nit?: string };
  /** Solo https. */
  readonly logoUrl?: string;
  readonly colores: { readonly primario: string; readonly secundario: string };
  readonly mediosHabilitados: readonly MedioPago[];
  readonly monedaPorDefecto: Moneda;
  readonly topesDescuentoBp: Readonly<Record<Rol, number>>;
  readonly textoRecibo: string;
  /** Serie del correlativo del recibo (`contadores/recibo_{serie}`). */
  readonly serieRecibo: string;
}

export const TOPE_DESCUENTO_CAJ_BP = 500;

/**
 * Valores iniciales. El tope de `caj` es la decisión de Andres (5 %). El de `sup` y `adm`
 * (100 %) es un supuesto: son quienes aprueban; el administrador lo ajusta en la configuración.
 */
export const CONFIG_POS_POR_DEFECTO: ConfigPos = {
  negocio: { nombre: 'Mi negocio' },
  colores: { primario: '#1f4e79', secundario: '#f2f2f2' },
  mediosHabilitados: ['efectivo', 'qr', 'transferencia', 'credito'],
  monedaPorDefecto: 'BOB',
  topesDescuentoBp: { caj: TOPE_DESCUENTO_CAJ_BP, sup: 10000, adm: 10000 },
  textoRecibo: '',
  serieRecibo: 'A',
};

type Obj = Readonly<Record<string, unknown>>;
const esObjeto = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const invalida = (m: string): ErrorPos => new ErrorPos('entrada-invalida', `Configuración inválida: ${m}`);

function soloClaves(o: Obj, permitidas: readonly string[], que: string): void {
  for (const k of Object.keys(o)) if (!permitidas.includes(k)) throw invalida(`${que} no admite «${k}»`);
}

function textoOpcional(x: unknown, que: string, max: number): string | undefined {
  if (x === undefined) return undefined;
  if (typeof x !== 'string' || x.trim() === '' || x.length > max) throw invalida(`${que} debe ser texto de hasta ${max} caracteres`);
  return x.trim();
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const SERIE = /^[A-Z0-9]{1,6}$/;

/** Valida una configuración completa; lanza `ErrorPos('entrada-invalida')`. Rechaza claves desconocidas. */
export function validarConfigPos(x: unknown): ConfigPos {
  if (!esObjeto(x)) throw invalida('debe ser un objeto');
  soloClaves(x, ['negocio', 'logoUrl', 'colores', 'mediosHabilitados', 'monedaPorDefecto', 'topesDescuentoBp', 'textoRecibo', 'serieRecibo'], 'la configuración');
  const n = x['negocio'];
  if (!esObjeto(n)) throw invalida('negocio es obligatorio');
  soloClaves(n, ['nombre', 'direccion', 'telefono', 'nit'], 'negocio');
  const nombre = textoOpcional(n['nombre'], 'negocio.nombre', 100);
  if (nombre === undefined) throw invalida('negocio.nombre es obligatorio');
  const direccion = textoOpcional(n['direccion'], 'negocio.direccion', 200);
  const telefono = textoOpcional(n['telefono'], 'negocio.telefono', 30);
  const nit = textoOpcional(n['nit'], 'negocio.nit', 30);
  const logoUrl = textoOpcional(x['logoUrl'], 'logoUrl', 500);
  if (logoUrl !== undefined && !/^https:\/\/[^\s]+$/.test(logoUrl)) throw invalida('logoUrl debe ser una URL https');
  const c = x['colores'];
  if (!esObjeto(c)) throw invalida('colores es obligatorio');
  soloClaves(c, ['primario', 'secundario'], 'colores');
  if (typeof c['primario'] !== 'string' || !HEX.test(c['primario']) || typeof c['secundario'] !== 'string' || !HEX.test(c['secundario'])) {
    throw invalida('los colores deben ser #RRGGBB');
  }
  const medios = x['mediosHabilitados'];
  if (!Array.isArray(medios) || medios.length === 0 || new Set(medios).size !== medios.length || !medios.every((m) => MEDIOS_PAGO.includes(m as MedioPago))) {
    throw invalida('mediosHabilitados debe listar sin repetir al menos un medio válido');
  }
  const moneda = x['monedaPorDefecto'];
  if (!MONEDAS_POS.includes(moneda as Moneda)) throw invalida('monedaPorDefecto debe ser BOB, USD o ARS');
  const t = x['topesDescuentoBp'];
  if (!esObjeto(t)) throw invalida('topesDescuentoBp es obligatorio');
  soloClaves(t, ['caj', 'sup', 'adm'], 'topesDescuentoBp');
  for (const r of ['caj', 'sup', 'adm']) {
    const v = t[r];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 10000) throw invalida(`el tope de ${r} debe ser un entero entre 0 y 10000 (puntos básicos)`);
  }
  const textoRecibo = x['textoRecibo'];
  if (typeof textoRecibo !== 'string' || textoRecibo.length > 500) throw invalida('textoRecibo debe ser texto de hasta 500 caracteres');
  const serie = x['serieRecibo'];
  if (typeof serie !== 'string' || !SERIE.test(serie)) throw invalida('serieRecibo debe ser de 1 a 6 letras mayúsculas o dígitos');
  return {
    negocio: { nombre, ...(direccion !== undefined ? { direccion } : {}), ...(telefono !== undefined ? { telefono } : {}), ...(nit !== undefined ? { nit } : {}) },
    ...(logoUrl !== undefined ? { logoUrl } : {}),
    colores: { primario: c['primario'], secundario: c['secundario'] },
    mediosHabilitados: medios as MedioPago[],
    monedaPorDefecto: moneda as Moneda,
    topesDescuentoBp: { caj: t['caj'] as number, sup: t['sup'] as number, adm: t['adm'] as number },
    textoRecibo,
    serieRecibo: serie,
  };
}

/** Lee la configuración dentro de la transacción; ausente = valores iniciales; presente e inválida = error. */
export async function leerConfigPos(tx: TransaccionIdentidad, tenantId: string): Promise<ConfigPos> {
  const d = await leerObligatorio(tx, rutaConfig(tenantId));
  if (d === undefined) return CONFIG_POS_POR_DEFECTO;
  try {
    return validarConfigPos(d['config']);
  } catch {
    throw new ErrorPos('dato-corrupto', 'La configuración guardada del POS es inválida');
  }
}

/** Guarda la configuración (solo el administrador). Queda en la auditoría sin volcar datos del negocio. */
export async function guardarConfigPos(deps: DepsPos, tenantId: string, actor: ActorPos, config: unknown): Promise<ConfigPos> {
  exigirTenant(tenantId);
  exigirActor(actor);
  exigirRol(actor, ['adm'], 'cambiar la configuración del POS');
  const nueva = validarConfigPos(config);
  const ahora = ahoraDe(deps);
  await deps.db.runTransaction(async (tx) => {
    const previa = await leerObligatorio(tx, rutaConfig(tenantId));
    tx.set(rutaConfig(tenantId), { config: nueva, actualizadoPor: actor.uid, actualizadoEnMs: ahora });
    auditar(tx, tenantId, actor, {
      accion: 'pos.config.guardar',
      ruta: rutaConfig(tenantId),
      antes: { existia: previa !== undefined },
      despues: { serieRecibo: nueva.serieRecibo, medios: [...nueva.mediosHabilitados], topeCajBp: nueva.topesDescuentoBp.caj },
    });
  });
  return nueva;
}
