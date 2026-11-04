import type { TransaccionIdentidad } from '@plataforma/nucleo';
import { LIMITES_CONSOLA } from '../limites.js';
import { ErrorConsola } from '../errores.js';
import { rutaUsoMedios } from '../rutas.js';
import { esObjeto } from '../validar.js';
import type { TipoMedio } from './tipos-archivo.js';

export interface ConteoProducto {
  readonly fotos: number;
  readonly videos: number;
}

/** `uso/medios`: bytes de originales y conteo de medios por producto, siempre dentro de una transacción. */
export interface UsoMedios {
  readonly bytes: number;
  readonly productos: Readonly<Record<string, ConteoProducto>>;
}

const entero = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;

function corrupto(): never {
  throw new ErrorConsola('contador-corrupto', 'El contador de uso de medios está dañado; contacte a soporte');
}

export async function leerUsoMedios(tx: TransaccionIdentidad, tenantId: string): Promise<UsoMedios> {
  const d = (await tx.get(rutaUsoMedios(tenantId))).data();
  if (d === undefined) return { bytes: 0, productos: {} };
  if (!entero(d['bytes']) || !esObjeto(d['productos'])) return corrupto();
  const productos: Record<string, ConteoProducto> = {};
  for (const [id, c] of Object.entries(d['productos'])) {
    if (!esObjeto(c) || !entero(c['fotos']) || !entero(c['videos'])) return corrupto();
    productos[id] = { fotos: c['fotos'], videos: c['videos'] };
  }
  return { bytes: d['bytes'], productos };
}

export function escribirUsoMedios(tx: TransaccionIdentidad, tenantId: string, uso: UsoMedios): void {
  tx.set(rutaUsoMedios(tenantId), { bytes: uso.bytes, productos: uso.productos });
}

const conteo = (uso: UsoMedios, productoId: string): ConteoProducto => uso.productos[productoId] ?? { fotos: 0, videos: 0 };

/** Reserva un medio y sus bytes. Lanza `limite` (sexta foto, segundo video) o `cuota-excedida`. */
export function reservarEnUso(uso: UsoMedios, productoId: string, tipo: TipoMedio, bytes: number): UsoMedios {
  const c = conteo(uso, productoId);
  if (tipo === 'foto' && c.fotos >= LIMITES_CONSOLA.fotosPorProducto) {
    throw new ErrorConsola('limite', `Este producto ya tiene ${String(LIMITES_CONSOLA.fotosPorProducto)} fotos`);
  }
  if (tipo === 'video' && c.videos >= LIMITES_CONSOLA.videosPorProducto) {
    throw new ErrorConsola('limite', 'Este producto ya tiene un video');
  }
  if (uso.bytes + bytes > LIMITES_CONSOLA.cuotaOriginalesBytes) {
    throw new ErrorConsola('cuota-excedida', 'Se alcanzó la cuota de 10 GB de originales');
  }
  return {
    bytes: uso.bytes + bytes,
    productos: { ...uso.productos, [productoId]: tipo === 'foto' ? { ...c, fotos: c.fotos + 1 } : { ...c, videos: c.videos + 1 } },
  };
}

/** Libera un medio y sus bytes; nunca baja de cero. */
export function liberarEnUso(uso: UsoMedios, productoId: string, tipo: TipoMedio, bytes: number): UsoMedios {
  const c = conteo(uso, productoId);
  const nuevo = tipo === 'foto' ? { ...c, fotos: Math.max(0, c.fotos - 1) } : { ...c, videos: Math.max(0, c.videos - 1) };
  const { [productoId]: _quitado, ...resto } = uso.productos;
  void _quitado;
  return {
    bytes: Math.max(0, uso.bytes - bytes),
    productos: nuevo.fotos === 0 && nuevo.videos === 0 ? resto : { ...resto, [productoId]: nuevo },
  };
}
