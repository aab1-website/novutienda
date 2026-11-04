import type { TransaccionIdentidad } from '@plataforma/nucleo';
import { EntradaInvalida, EstadoInvalido, NoEncontrado, SerieNoDisponible, SinPermiso, StockInsuficiente } from './errores.js';
import { exigirCantidad, exigirProducto, exigirSegmento, exigirSeries, exigirUbicacion, ruta } from './ids.js';
import { MARCA_SERVIDOR, type Autor, type Datos } from './motor.js';
import { ejecutarOperacion, exigirAutor, exigirMotivo, PERMISOS, type ResultadoOperacion } from './operacion.js';
import { exigirControl, seriesDeLinea } from './stock.js';

interface Base {
  readonly tenantId: string;
  readonly operacionId: string;
  readonly por: Autor;
}

/**
 * Solicita una merma (no mueve stock). El id de la merma es la `operacionId`.
 * Cualquier rol puede solicitarla; descontar exige la resolución de otra persona.
 */
export async function solicitarMerma(
  tx: TransaccionIdentidad,
  e: Base & { productoId: string; ubicacionId: string; cantidad: number; series?: readonly string[]; motivo: string },
): Promise<ResultadoOperacion<Datos>> {
  const productoId = exigirProducto(e.productoId);
  const ubicacionId = exigirUbicacion(e.ubicacionId);
  const cantidad = exigirCantidad(e.cantidad);
  const motivo = exigirMotivo(e.motivo);
  const series = e.series === undefined ? undefined : exigirSeries(e.series);
  const por = exigirAutor(e.por);
  return ejecutarOperacion(tx, {
    tenantId: e.tenantId,
    operacionId: e.operacionId,
    tipo: 'merma-solicitar',
    accion: 'inventarios.merma-solicitar',
    carga: { productoId, ubicacionId, cantidad, series: series === undefined ? undefined : [...series].sort(), motivo },
    por,
    roles: PERMISOS.mermaSolicitar,
    construir: async (t) => {
      await t.cargar(productoId, ubicacionId);
      exigirControl(t, productoId);
      const lista = seriesDeLinea(t, { productoId, cantidad, series });
      await Promise.all(lista.map((s) => t.unidad(productoId, s)));
      for (const s of lista) {
        const u = t.unidadLeida(productoId, s);
        if (u === undefined || u['estado'] !== 'disponible' || u['ubicacionId'] !== ubicacionId) throw new SerieNoDisponible(productoId, s);
      }
      const disponible = t.existencia(productoId, ubicacionId).cantidad;
      if (disponible < cantidad) throw new StockInsuficiente([{ productoId, almacenId: ubicacionId, pedido: cantidad, disponible }]);
      t.escribir({
        ruta: ruta(t.tenantId, 'mermas', e.operacionId),
        modo: 'create',
        datos: {
          estado: 'solicitada',
          productoId,
          ubicacionId,
          cantidad,
          series: [...lista],
          motivo,
          solicitadaPor: por.uid,
          solicitadaRol: por.rol,
          solicitadaEn: MARCA_SERVIDOR,
        },
      });
      return { resultado: { mermaId: e.operacionId }, referencia: { tipo: 'merma', id: e.operacionId }, tipoMovimiento: 'merma', motivo };
    },
  });
}

/**
 * Resuelve una merma una sola vez (solicitada → aprobada|rechazada). Sup/adm, distinto de quien
 * la solicitó. Aprobada descuenta el stock y pasa las series a «merma».
 */
export async function resolverMerma(
  tx: TransaccionIdentidad,
  e: Base & { mermaId: string; decision: 'aprobada' | 'rechazada'; motivo?: string },
): Promise<ResultadoOperacion<Datos>> {
  const mermaId = exigirSegmento(e.mermaId, 'mermaId');
  if (e.decision !== 'aprobada' && e.decision !== 'rechazada') throw new EntradaInvalida('decision inválida');
  const decision = e.decision;
  const motivo = e.motivo === undefined ? undefined : exigirMotivo(e.motivo);
  const por = exigirAutor(e.por);
  return ejecutarOperacion(tx, {
    tenantId: e.tenantId,
    operacionId: e.operacionId,
    tipo: 'merma-resolver',
    accion: `inventarios.merma-${decision === 'aprobada' ? 'aprobar' : 'rechazar'}`,
    carga: { mermaId, decision, motivo },
    por,
    roles: PERMISOS.mermaResolver,
    construir: async (t) => {
      const merma = await t.lector.leer('mermas', mermaId);
      if (merma === undefined) throw new NoEncontrado(`Merma inexistente: ${mermaId}`);
      if (merma['estado'] !== 'solicitada') throw new EstadoInvalido(`La merma ${mermaId} ya fue resuelta`);
      if (merma['solicitadaPor'] === por.uid) throw new SinPermiso('Quien solicita una merma no puede resolverla');
      const productoId = merma['productoId'] as string;
      const ubicacionId = merma['ubicacionId'] as string;
      if (decision === 'aprobada') {
        const cantidad = merma['cantidad'] as number;
        const series = merma['series'] as string[];
        await t.cargar(productoId, ubicacionId);
        await Promise.all(series.map((s) => t.unidad(productoId, s)));
        for (const s of series) {
          const u = t.unidadLeida(productoId, s);
          if (u === undefined || u['estado'] !== 'disponible' || u['ubicacionId'] !== ubicacionId) throw new SerieNoDisponible(productoId, s);
          t.marcarUnidad({ productoId, serie: s, base: u, estado: 'merma', ubicacionId, modo: 'set' });
        }
        t.mover(productoId, ubicacionId, -cantidad, { quitar: series, tipo: 'merma' });
      }
      t.escribir({
        ruta: ruta(t.tenantId, 'mermas', mermaId),
        modo: 'set',
        datos: {
          ...merma,
          estado: decision,
          resueltaPor: por.uid,
          resueltaRol: por.rol,
          resueltaEn: MARCA_SERVIDOR,
          ...(motivo !== undefined ? { resolucionMotivo: motivo } : {}),
        },
      });
      return {
        resultado: { mermaId, estado: decision },
        referencia: { tipo: 'merma', id: mermaId },
        tipoMovimiento: 'merma',
        ...(motivo !== undefined ? { motivo } : {}),
      };
    },
  });
}
