import type { TransaccionIdentidad } from '@novutienda/nucleo';
import { EntradaInvalida, EstadoInvalido, NoEncontrado, SerieNoDisponible } from './errores.js';
import { hashCarga } from './hash.js';
import { exigirProducto, exigirSegmento, exigirSeries, exigirUbicacion, MAX_LINEAS, ruta } from './ids.js';
import { MARCA_SERVIDOR, type Autor, type Datos, type Trabajo } from './motor.js';
import { ejecutarOperacion, exigirAutor, PERMISOS, type ResultadoOperacion } from './operacion.js';
import { exigirControl } from './stock.js';

interface Base {
  readonly tenantId: string;
  readonly operacionId: string;
  readonly por: Autor;
  readonly conteoId: string;
}

const idLinea = (conteoId: string, productoId: string): string => `${conteoId}__${productoId}`;

/** Abre un conteo ciego. Solo uno abierto por ubicación (la ubicación debe existir). Sup/adm. */
export async function abrirConteo(
  tx: TransaccionIdentidad,
  e: Base & { ubicacionId: string },
): Promise<ResultadoOperacion<Datos>> {
  const conteoId = exigirSegmento(e.conteoId, 'conteoId');
  const ubicacionId = exigirUbicacion(e.ubicacionId);
  const por = exigirAutor(e.por);
  return ejecutarOperacion(tx, {
    tenantId: e.tenantId,
    operacionId: e.operacionId,
    tipo: 'conteo-abrir',
    accion: 'inventarios.conteo-abrir',
    carga: { conteoId, ubicacionId },
    por,
    roles: PERMISOS.conteoAbrir,
    construir: async (t) => {
      const [ubic, previo] = await Promise.all([t.lector.leer('ubicaciones', ubicacionId), t.lector.leer('conteos', conteoId)]);
      if (ubic === undefined) throw new EstadoInvalido(`La ubicación ${ubicacionId} no existe`);
      if (previo !== undefined) throw new EstadoInvalido(`El conteo ${conteoId} ya existe`);
      if (ubic['conteoAbiertoId'] !== undefined) throw new EstadoInvalido(`Ya hay un conteo abierto en ${ubicacionId}`);
      t.escribir({
        ruta: ruta(t.tenantId, 'conteos', conteoId),
        modo: 'create',
        datos: { ubicacionId, estado: 'abierto', productos: [], abiertoPor: por.uid, abiertoEn: MARCA_SERVIDOR },
      });
      t.escribir({ ruta: ruta(t.tenantId, 'ubicaciones', ubicacionId), modo: 'set', datos: { ...ubic, conteoAbiertoId: conteoId } });
      return { resultado: { conteoId, ubicacionId }, referencia: { tipo: 'conteo', id: conteoId }, tipoMovimiento: 'conteo' };
    },
  });
}

/**
 * Registra (o reemplaza) la línea contada de un producto. El teórico se guarda en el servidor
 * (`conteoTeoricos`) y NUNCA se devuelve a quien cuenta. En productos con serie se informan las
 * series halladas; deben estar disponibles en la ubicación.
 */
export async function registrarLineaConteo(
  tx: TransaccionIdentidad,
  e: Base & { productoId: string; contado?: number; series?: readonly string[] },
): Promise<ResultadoOperacion<Datos>> {
  const conteoId = exigirSegmento(e.conteoId, 'conteoId');
  const productoId = exigirProducto(e.productoId);
  const series = e.series === undefined ? undefined : exigirSeries(e.series);
  if (e.contado !== undefined && !(Number.isSafeInteger(e.contado) && e.contado >= 0)) throw new EntradaInvalida('contado inválido');
  const por = exigirAutor(e.por);
  return ejecutarOperacion(tx, {
    tenantId: e.tenantId,
    operacionId: e.operacionId,
    tipo: 'conteo-linea',
    accion: 'inventarios.conteo-linea',
    carga: { conteoId, productoId, contado: e.contado, series: series === undefined ? undefined : [...series].sort() },
    por,
    roles: PERMISOS.conteoRegistrar,
    construir: async (t) => {
      const conteo = await t.lector.leer('conteos', conteoId);
      if (conteo === undefined) throw new NoEncontrado(`Conteo inexistente: ${conteoId}`);
      if (conteo['estado'] !== 'abierto') throw new EstadoInvalido(`El conteo ${conteoId} no está abierto`);
      const ubicacionId = conteo['ubicacionId'] as string;
      const productos = [...(conteo['productos'] as string[])];
      const nuevo = !productos.includes(productoId);
      if (nuevo && productos.length >= MAX_LINEAS) throw new EntradaInvalida(`Un conteo admite hasta ${MAX_LINEAS} productos`);
      await t.cargar(productoId, ubicacionId);
      exigirControl(t, productoId);
      const prod = t.producto(productoId);
      const ex = t.existencia(productoId, ubicacionId);
      let contado: number;
      if (prod['conSerie'] === true) {
        if (series === undefined) throw new EntradaInvalida(`${productoId} lleva serie: informe las series halladas`);
        if (e.contado !== undefined && e.contado !== series.length) throw new EntradaInvalida('contado no coincide con las series');
        await Promise.all(series.map((s) => t.unidad(productoId, s)));
        for (const s of series) {
          const u = t.unidadLeida(productoId, s);
          if (u === undefined || u['estado'] !== 'disponible' || u['ubicacionId'] !== ubicacionId) throw new SerieNoDisponible(productoId, s);
        }
        contado = series.length;
      } else {
        if (series !== undefined && series.length > 0) throw new EntradaInvalida(`${productoId} no lleva serie`);
        if (e.contado === undefined) throw new EntradaInvalida('contado requerido');
        contado = e.contado;
      }
      const id = idLinea(conteoId, productoId);
      t.escribir({
        ruta: ruta(t.tenantId, 'conteoLineas', id),
        modo: 'set',
        datos: {
          conteoId,
          productoId,
          contado,
          ...(series !== undefined ? { series: [...series] } : {}),
          registradaPor: por.uid,
          registradaRol: por.rol,
          registradaEn: MARCA_SERVIDOR,
        },
      });
      t.escribir({
        ruta: ruta(t.tenantId, 'conteoTeoricos', id),
        modo: 'set',
        datos: {
          conteoId,
          productoId,
          cantidad: ex.cantidad,
          ...(prod['conSerie'] === true ? { series: [...ex.series] } : {}),
        },
      });
      if (nuevo) t.escribir({ ruta: ruta(t.tenantId, 'conteos', conteoId), modo: 'set', datos: { ...conteo, productos: [...productos, productoId] } });
      return { resultado: { conteoId, productoId, contado }, referencia: { tipo: 'conteo', id: conteoId }, tipoMovimiento: 'conteo' };
    },
  });
}

/**
 * Cierra y firma el conteo (sup/adm). Faltantes → mermas solicitadas (a nombre de quien contó, para
 * que otro las resuelva); sobrantes → movimiento de conteo. Libera la ubicación.
 */
export async function cerrarConteo(tx: TransaccionIdentidad, e: Base): Promise<ResultadoOperacion<Datos>> {
  const conteoId = exigirSegmento(e.conteoId, 'conteoId');
  const por = exigirAutor(e.por);
  return ejecutarOperacion(tx, {
    tenantId: e.tenantId,
    operacionId: e.operacionId,
    tipo: 'conteo-cerrar',
    accion: 'inventarios.conteo-cerrar',
    carga: { conteoId },
    por,
    roles: PERMISOS.conteoCerrar,
    construir: async (t) => {
      const conteo = await t.lector.leer('conteos', conteoId);
      if (conteo === undefined) throw new NoEncontrado(`Conteo inexistente: ${conteoId}`);
      if (conteo['estado'] !== 'abierto') throw new EstadoInvalido(`El conteo ${conteoId} no está abierto`);
      const ubicacionId = conteo['ubicacionId'] as string;
      const productos = conteo['productos'] as string[];
      if (productos.length === 0) throw new EstadoInvalido('El conteo no tiene líneas');
      const ubic = await t.lector.leer('ubicaciones', ubicacionId);
      const [lineas, teoricos] = await Promise.all([
        Promise.all(productos.map((p) => t.lector.leer('conteoLineas', idLinea(conteoId, p)))),
        Promise.all(productos.map((p) => t.lector.leer('conteoTeoricos', idLinea(conteoId, p)))),
        Promise.all(productos.map((p) => t.cargar(p, ubicacionId))),
      ]);
      const mermas: string[] = [];
      let sobrantes = 0;
      const firmaLineas: Datos[] = [];
      for (const [i, p] of productos.entries()) {
        const l = lineas[i];
        const te = teoricos[i];
        if (l === undefined || te === undefined) throw new EstadoInvalido(`Falta la línea o el teórico de ${p}`);
        const contado = l['contado'] as number;
        const teorico = te['cantidad'] as number;
        firmaLineas.push({ productoId: p, contado });
        if (prodSerie(t.producto(p))) {
          const halladas = (l['series'] as string[]) ?? [];
          const faltan = ((te['series'] as string[]) ?? []).filter((s) => !halladas.includes(s));
          if (faltan.length > 0) mermas.push(pedirMerma(t, conteoId, p, ubicacionId, faltan.length, faltan, l['registradaPor'] as string, l['registradaRol'] as string));
        } else if (contado < teorico) {
          mermas.push(pedirMerma(t, conteoId, p, ubicacionId, teorico - contado, [], l['registradaPor'] as string, l['registradaRol'] as string));
        } else if (contado > teorico) {
          t.mover(p, ubicacionId, contado - teorico, { tipo: 'conteo' });
          sobrantes += contado - teorico;
        }
      }
      const { conteoAbiertoId: _libre, ...resto } = ubic ?? {};
      void _libre;
      t.escribir({ ruta: ruta(t.tenantId, 'ubicaciones', ubicacionId), modo: 'set', datos: resto });
      t.escribir({
        ruta: ruta(t.tenantId, 'conteos', conteoId),
        modo: 'set',
        datos: {
          ...conteo,
          estado: 'cerrado',
          cerradoPor: por.uid,
          cerradoEn: MARCA_SERVIDOR,
          firma: { uid: por.uid, rol: por.rol, huella: hashCarga('conteo', firmaLineas) },
          mermas,
        },
      });
      return {
        resultado: { conteoId, sobrantes, mermas },
        referencia: { tipo: 'conteo', id: conteoId },
        tipoMovimiento: 'conteo',
      };
    },
  });
}

const prodSerie = (p: Datos): boolean => p['conSerie'] === true;

function pedirMerma(
  t: Trabajo,
  conteoId: string,
  productoId: string,
  ubicacionId: string,
  cantidad: number,
  series: readonly string[],
  solicitadaPor: string,
  solicitadaRol: string,
): string {
  const mermaId = `${conteoId}-${productoId}`;
  t.escribir({
    ruta: ruta(t.tenantId, 'mermas', mermaId),
    modo: 'create',
    datos: {
      estado: 'solicitada',
      productoId,
      ubicacionId,
      cantidad,
      series: [...series],
      motivo: `Faltante del conteo ${conteoId}`,
      origen: 'conteo',
      conteoId,
      solicitadaPor,
      solicitadaRol,
      solicitadaEn: MARCA_SERVIDOR,
    },
  });
  return mermaId;
}

