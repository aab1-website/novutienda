// Tipo de cambio manual (Central, plano §5.2): lo que todo comercio con tipo de cambio ve igual tenga los módulos que tenga.
// Viaja dentro del callable `consola` (`index.ts` lo compone con `accionesConsola`); los roles y el permiso del propietario
// los declara el manifiesto del panel. La regla de fondo (precedencia, salto, historial) vive en el núcleo; aquí solo el borde.
// Los valores del tipo de cambio nunca van a los registros.
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  ConfirmacionRequerida, fijarCotizacionManualDe, leerTipoCambioDe, mercadosDe, quitarCotizacionManualDe, rutaCotizacion,
  SinManualActivo, tieneTipoCambio, TipoCambioInvalido, ValorFueraDeBanda,
  type ActorCarga, type AlmacenCotizaciones, type ConfiguracionComercial, type LimiteTasa, type VistaTipoCambio,
} from '@novutienda/nucleo';
import { accion, type Contexto, type TablaImplementaciones } from './marco.js';
import type { Entorno } from '../entorno.js';
import { VACIO, objeto } from './comunes.js';

/** Tope de cargas y retornos al banco central por comercio y hora. */
export const MAXIMO_CAMBIOS_TIPO_CAMBIO_POR_HORA = 10;
export const VENTANA_TIPO_CAMBIO_MS = 3_600_000;
/** Entradas del historial que devuelve `verTipoCambio` por mercado. */
export const HISTORIAL_RECIENTE = 20;

/**
 * Puertos que el coordinador debe sumar (el marco no los trae todavía):
 * - `limiteTipoCambio`: `LimiteTasa` de 10 por hora (`MAXIMO_CAMBIOS_TIPO_CAMBIO_POR_HORA`, `VENTANA_TIPO_CAMBIO_MS`), con clave por comercio.
 * - `almacenCotizaciones.listarRecientes?` (puerto del núcleo): las últimas entradas de una subcolección, la más nueva primero.
 */
export interface PuertosTipoCambio {
  readonly limiteTipoCambio: LimiteTasa;
}

function limiteDe(e: Entorno): LimiteTasa {
  const l = (e as Partial<PuertosTipoCambio>).limiteTipoCambio;
  // Falla cerrado y sin detalles: faltó la conexión del coordinador.
  if (l === undefined) throw new HttpsError('internal', 'Error interno.');
  return l;
}

/**
 * Descuenta un cupo solo si la operación se concreta: se llama dentro de la transacción, cuando la validación del núcleo
 * ya pasó y solo faltan las escrituras. Si el tope se pasó, lanza y la transacción se aborta sin escribir. Así un intento
 * rechazado no gasta cupo y el conteo y la escritura no se separan (no hay hueco para pasar el tope).
 */
async function limitar(c: Contexto): Promise<void> {
  const r = await limiteDe(c.e).intentar(`tipo-cambio:${c.tenantId}`, c.e.ahora());
  if (!r.permitido) {
    throw new HttpsError('resource-exhausted', 'Se hicieron demasiados cambios del tipo de cambio. Intente de nuevo más tarde.', { codigo: 'limite-tipo-cambio', reintentarEnSeg: r.reintentarEnSeg });
  }
}

/** Almacén que cuenta el cupo al primer intento de escritura de la transacción (validación ya superada). */
function almacenConLimite(c: Contexto): AlmacenCotizaciones {
  limiteDe(c.e); // falla cerrado antes de tocar nada si falta el puerto
  const base = c.e.almacenCotizaciones;
  return {
    leer: (ruta) => base.leer(ruta),
    transaccion: (fn) => base.transaccion(async (tx) => {
      let contado = false;
      const contar = async (): Promise<void> => { if (!contado) { contado = true; await limitar(c); } };
      const escrituras: Array<() => void> = [];
      const r = await fn({
        leer: (ruta) => tx.leer(ruta),
        establecer: (ruta, datos) => { escrituras.push(() => tx.establecer(ruta, datos)); },
        crear: (ruta, datos) => { escrituras.push(() => tx.crear(ruta, datos)); },
      });
      if (escrituras.length > 0) await contar();
      for (const w of escrituras) w();
      return r;
    }),
    ...(base.listarRecientes === undefined ? {} : { listarRecientes: (ruta, limite) => base.listarRecientes!(ruta, limite) }),
  };
}

const MERCADO = z.string().regex(/^[A-Z]{2}$/, 'mercado inválido');
/** Positivo, finito y con hasta 6 decimales. */
const VALOR = z.number().finite().positive().max(1_000_000_000).refine((v) => Math.abs(Math.round(v * 1e6) / 1e6 - v) < 1e-9, 'hasta 6 decimales');

/** El propietario de la plataforma con Google actúa como propietario aunque además tenga rol (p. ej. adm) en el comercio. */
const actorDe = (c: Contexto): ActorCarga => ({
  uid: c.sesion.uid,
  rol: c.sesion.propietario && c.sesion.proveedor === 'google.com' ? 'propietario' : (c.rol ?? 'propietario'),
  proveedor: c.sesion.proveedor,
});

function exigirMercado(comercial: ConfiguracionComercial, mercado: string): void {
  if (!mercadosDe(comercial).includes(mercado) || !tieneTipoCambio(comercial, mercado)) {
    throw new HttpsError('invalid-argument', 'Ese mercado no tiene tipo de cambio.', { codigo: 'entrada-invalida' });
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const txt = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

async function referenciaDe(c: Contexto, vista: VistaTipoCambio, mercado: string): Promise<{ valor: number; fecha: string; fuente: string; estado: string } | null> {
  if ('valor' in vista.referencia) return { valor: vista.referencia.valor, fecha: vista.referencia.fecha, fuente: vista.referencia.fuente, estado: vista.referencia.estado };
  // La referencia no sirve (vieja o ausente): se muestra lo que haya, marcado como vencido, para que el administrador decida.
  const d = await c.e.almacenCotizaciones.leer(rutaCotizacion(c.tenantId, mercado));
  const valor = d === null ? null : num(d['valor']);
  const fecha = d === null ? null : txt(d['fecha']);
  return d !== null && valor !== null && valor > 0 && fecha !== null ? { valor, fecha, fuente: txt(d['fuente']) ?? 'desconocida', estado: 'vencida' } : null;
}

/** Nombre o correo de cada uid (nunca el uid crudo). */
async function nombresDe(e: Entorno, uids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const unicos = [...new Set(uids)].slice(0, 100);
  const m = new Map<string, string>();
  if (unicos.length === 0) return m;
  const { users } = await e.auth.getUsers(unicos.map((uid) => ({ uid })));
  for (const u of users) m.set(u.uid, txt(u.displayName) ?? txt(u.email) ?? 'Persona sin correo');
  return m;
}

export const accionesTipoCambio: TablaImplementaciones = {
  /** Por mercado con tipo de cambio: referencia del banco central, manual vigente (con quién y cuándo) e historial reciente. */
  verTipoCambio: accion({
    esquema: VACIO,
    ejecutar: async (c) => {
      const comercial = await c.e.comercialDelTenant(c.tenantId);
      const parciales = [];
      for (const mercado of mercadosDe(comercial).filter((m) => tieneTipoCambio(comercial, m))) {
        const v = await leerTipoCambioDe(c.e.almacenCotizaciones, mercado, c.e.ahora(), { tenantId: c.tenantId, comercial, limite: HISTORIAL_RECIENTE });
        parciales.push({ mercado, par: v.par, referencia: await referenciaDe(c, v, mercado), manual: v.manual, historial: v.historial.slice(0, HISTORIAL_RECIENTE) });
      }
      const nombres = await nombresDe(c.e, parciales.flatMap((p) => [p.manual?.por ?? null, ...p.historial.map((h) => txt(h.por))]).filter((x): x is string => x !== null));
      const quien = (uid: string | null): string => (uid === null ? 'Persona sin correo' : (nombres.get(uid) ?? 'Persona que ya no tiene acceso'));
      return {
        mercados: parciales.map((p) => ({
          mercado: p.mercado,
          par: p.par,
          rige: p.manual !== null ? 'manual' : p.referencia !== null && p.referencia.estado !== 'vencida' ? 'referencia' : 'ninguna',
          referencia: p.referencia,
          manual: p.manual === null ? null : { valor: p.manual.valor, fecha: p.manual.fecha, actualizadoEn: p.manual.actualizadoEn, por: quien(p.manual.por) },
          historial: p.historial.map((h) => ({
            accion: h.accion, valor: h.valor, antes: h.antes === null ? null : num(h.antes.valor),
            fecha: h.fecha, actualizadoEn: txt(h.actualizadoEn), por: quien(txt(h.por)),
          })),
        })),
      };
    },
  }),
  /** Fija el tipo de cambio manual del mercado (administrador con contraseña o propietario; la regla la aplica el núcleo). */
  cotizacionManual: accion({
    esquema: objeto({ mercado: MERCADO, valor: VALOR, confirmarSalto: z.boolean().optional() }),
    ejecutar: async (c, d) => {
      const comercial = await c.e.comercialDelTenant(c.tenantId);
      exigirMercado(comercial, d.mercado);
      let r;
      try {
        r = await fijarCotizacionManualDe(
          almacenConLimite(c),
          { mercado: d.mercado, valor: d.valor, actor: actorDe(c), ahoraMs: c.e.ahora(), ...(d.confirmarSalto === true ? { confirmarSalto: true } : {}) },
          { tenantId: c.tenantId, comercial },
        );
      } catch (error) {
        if (error instanceof ValorFueraDeBanda) {
          throw new HttpsError('invalid-argument', `El valor está fuera del rango razonable para ${error.par} (${error.descripcion}). Revíselo.`, { codigo: 'valor-fuera-de-rango' });
        }
        if (error instanceof TipoCambioInvalido) throw new HttpsError('invalid-argument', 'El tipo de cambio indicado no es válido. Revise el mercado y el valor.', { codigo: 'entrada-invalida' });
        throw error;
      }
      return { ok: true, mercado: r.mercado, fecha: r.fecha };
    },
  }),
  /** Vuelve al tipo de cambio del banco central (administrador con contraseña o propietario, con confirmación expresa). */
  quitarCotizacionManual: accion({
    esquema: objeto({ mercado: MERCADO, confirmar: z.boolean().optional() }),
    ejecutar: async (c, d) => {
      const comercial = await c.e.comercialDelTenant(c.tenantId);
      exigirMercado(comercial, d.mercado);
      try {
        await quitarCotizacionManualDe(
          almacenConLimite(c),
          { mercado: d.mercado, actor: actorDe(c), ahoraMs: c.e.ahora(), ...(d.confirmar === true ? { confirmar: true } : {}) },
          { tenantId: c.tenantId, comercial },
        );
      } catch (error) {
        if (error instanceof ConfirmacionRequerida) throw new HttpsError('failed-precondition', error.message, { codigo: 'confirmacion-requerida' });
        if (error instanceof SinManualActivo) throw new HttpsError('failed-precondition', 'No hay un tipo de cambio manual vigente que quitar.', { codigo: 'sin-manual' });
        if (error instanceof TipoCambioInvalido) throw new HttpsError('invalid-argument', 'Ese mercado no tiene tipo de cambio.', { codigo: 'entrada-invalida' });
        throw error;
      }
      return { ok: true, mercado: d.mercado };
    },
  }),
};
