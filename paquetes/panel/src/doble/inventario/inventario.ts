import type { Entrada, NombreCallable, Salida } from '../../api/contrato.js';
import type { ResultadoOperacion, TipoMovimiento, UbicacionId } from '../../api/tipos.js';
import { UBICACIONES } from '../../api/tipos.js';
import { aCsv } from '../../util/csv.js';
import { importarProductosDoble, simularImportacionDoble } from './importacion.js';
import { auditar, exigirRol, fallo, iso, recalcular, vistaProducto, type Contexto, type ProductoInterno } from '../estado.js';

type H<N extends NombreCallable> = (c: Contexto, e: Entrada<N>) => Salida<N> | Promise<Salida<N>>;

const ID_PRODUCTO = /^[a-z0-9][a-z0-9-]{1,59}$/;
const ID_SEG = /^[A-Za-z0-9_-]{1,80}$/;

/** Idempotencia por operacionId + hash del contenido (misma id con otro contenido = already-exists). */
function operacion(c: Contexto, tipo: string, operacionId: string, carga: unknown, f: () => Record<string, unknown>): ResultadoOperacion {
  if (!ID_SEG.test(operacionId)) throw fallo('entrada-invalida', 'operacionId inválido');
  const hash = JSON.stringify([tipo, carga]);
  const previa = c.e.operaciones.get(operacionId);
  if (previa !== undefined) {
    if (previa.hash !== hash) throw fallo('operacion-conflicto');
    return { resultado: previa.resultado, repetida: true };
  }
  const resultado = f();
  c.e.operaciones.set(operacionId, { hash, resultado });
  return { resultado, repetida: false };
}

function ubicacion(x: string): UbicacionId {
  if (!UBICACIONES.includes(x as UbicacionId)) throw fallo('entrada-invalida', 'Almacén desconocido');
  return x as UbicacionId;
}

function producto(c: Contexto, id: string): ProductoInterno {
  const p = c.e.productos.get(id);
  if (p === undefined) throw fallo('producto-inexistente');
  return p;
}

function mover(c: Contexto, opId: string, p: ProductoInterno, u: UbicacionId, tipo: TipoMovimiento, delta: number, series: readonly string[], motivo?: string, ref?: string): void {
  p.existencias[u] += delta;
  if (p.existencias[u] < 0) throw fallo('stock-insuficiente');
  recalcular(p);
  c.e.movimientos.push({
    id: `${opId}__${p.id}__${u}`, operacionId: opId, productoId: p.id, ubicacionId: u, tipo, delta, saldoUbicacion: p.existencias[u], series,
    ...(ref !== undefined ? { referencia: ref } : {}), por: c.uid, rol: c.rol, fecha: iso(c.ahora), ...(motivo !== undefined ? { motivo } : {}),
  });
}

function validarSeries(p: ProductoInterno, cantidad: number, series: readonly string[] | undefined): readonly string[] {
  if (!Number.isSafeInteger(cantidad) || cantidad < 1) throw fallo('entrada-invalida', 'Cantidad inválida');
  if (!p.conSerie) {
    if (series !== undefined && series.length > 0) throw fallo('entrada-invalida', `${p.id} no lleva serie`);
    return [];
  }
  if (series === undefined || series.length !== cantidad || new Set(series).size !== cantidad || series.some((s) => s.trim() === '')) {
    throw fallo('entrada-invalida', `${p.id}: se requiere una serie distinta por unidad`);
  }
  return series.map((s) => s.trim());
}

const motivoObligatorio = (m: string): string => {
  if (typeof m !== 'string' || m.trim() === '' || m.length > 500) throw fallo('entrada-invalida', 'El motivo es obligatorio');
  return m.trim();
};

export const handlersInventario: {
  [N in 'crearProducto' | 'actualizarProducto' | 'ingresar' | 'traspasar' | 'ajustar' | 'solicitarMerma' | 'resolverMerma' | 'abrirConteo' | 'registrarLineaConteo' | 'cerrarConteo' | 'simularImportacionProductos' | 'importarProductosCsv' | 'exportarProductosCsv' | 'listarProductos' | 'listarSeries' | 'buscarSerie' | 'listarMovimientos' | 'listarMermas' | 'listarConteos' | 'cotizacionesVigentes']: H<N>;
} = {
  crearProducto(c, e) {
    const p = e.producto;
    if (!ID_PRODUCTO.test(p.id)) throw fallo('entrada-invalida', 'Identificador de producto inválido');
    return operacion(c, 'producto-crear', e.operacionId, p, () => {
      if (c.e.productos.has(p.id)) throw fallo('estado-invalido', `El producto ${p.id} ya existe`);
      if ([...c.e.productos.values()].some((x) => x.sku === p.sku)) throw fallo('estado-invalido', 'El SKU ya está en uso');
      if (c.e.productos.size >= 200) throw fallo('limite-del-plan');
      const controla = p.controlaStock ?? true;
      c.e.productos.set(p.id, {
        id: p.id, nombre: p.nombre, categoria: p.categoria, ...(p.marca !== undefined ? { marca: p.marca } : {}), sku: p.sku, activo: p.activo ?? true,
        publicado: p.publicado ?? false, conSerie: p.conSerie ?? false, ...(p.garantiaMeses !== undefined ? { garantiaMeses: p.garantiaMeses } : {}),
        ...(p.minimo !== undefined ? { minimo: p.minimo } : {}), precioUSD: p.precioUSD, costoUSD: p.costoUSD ?? 0,
        ...(controla ? { stockTotal: 0 } : {}), existencias: { tienda: 0, 'deposito-1': 0, 'deposito-2': 0 },
      });
      c.e.cambiosSinPublicar += 1;
      auditar(c, 'inventarios.producto-crear', `productos/${p.id}`);
      return { productoId: p.id };
    });
  },

  actualizarProducto(c, e) {
    if (Object.keys(e.cambios).length === 0) throw fallo('entrada-invalida', 'Sin cambios');
    return operacion(c, 'producto-actualizar', e.operacionId, [e.productoId, e.cambios], () => {
      const p = producto(c, e.productoId);
      if (e.cambios.conSerie !== undefined && e.cambios.conSerie !== p.conSerie && c.e.movimientos.some((m) => m.productoId === p.id)) {
        throw fallo('estado-invalido', 'conSerie no cambia tras el primer movimiento');
      }
      const { marca, garantiaMeses, minimo, costoUSD, precioUSD, ...directos } = e.cambios;
      if (precioUSD !== undefined) {
        for (const v of [precioUSD.bo, precioUSD.ar]) {
          if (!Number.isSafeInteger(v) || v < 0 || v > 10_000_000_000) throw fallo('entrada-invalida', 'Precio: centavos enteros');
        }
      }
      if (garantiaMeses != null && (!Number.isInteger(garantiaMeses) || garantiaMeses < 1 || garantiaMeses > 120)) throw fallo('entrada-invalida', 'Garantía: de 1 a 120 meses');
      if (minimo != null && (!Number.isInteger(minimo) || minimo < 0)) throw fallo('entrada-invalida', 'Mínimo inválido');
      Object.assign(p, directos);
      // `null` vacía el dato; ausente = sin cambio.
      if (marca === null) delete p.marca; else if (marca !== undefined) p.marca = marca;
      if (garantiaMeses === null) delete p.garantiaMeses; else if (garantiaMeses !== undefined) p.garantiaMeses = garantiaMeses;
      if (minimo === null) delete p.minimo; else if (minimo !== undefined) p.minimo = minimo;
      if (costoUSD === null) p.costoUSD = 0; else if (costoUSD !== undefined) p.costoUSD = costoUSD;
      if (precioUSD !== undefined) p.precioUSD = { bo: precioUSD.bo, ar: precioUSD.ar };
      c.e.cambiosSinPublicar += 1;
      auditar(c, 'inventarios.producto-actualizar', `productos/${p.id}`);
      return { productoId: p.id };
    });
  },

  ingresar(c, e) {
    const u = ubicacion(e.ubicacionId);
    return operacion(c, 'ingreso', e.operacionId, [u, e.lineas], () => {
      if (e.lineas.length < 1 || e.lineas.length > 50) throw fallo('entrada-invalida', 'Entre 1 y 50 líneas');
      const trabajos = e.lineas.map((l) => {
        const p = producto(c, l.productoId);
        return { p, l, series: validarSeries(p, l.cantidad, l.series) };
      });
      for (const { p, series } of trabajos) {
        for (const s of series) if (c.e.unidades.has(`${p.id}__${s}`)) throw fallo('estado-invalido', `La serie ${s} ya existe`);
      }
      for (const { p, l, series } of trabajos) {
        for (const s of series) c.e.unidades.set(`${p.id}__${s}`, { productoId: p.id, serie: s, estado: 'disponible', ubicacionId: u });
        mover(c, e.operacionId, p, u, 'ingreso', l.cantidad, series);
      }
      c.e.cambiosSinPublicar += 1;
      auditar(c, 'inventarios.ingreso', `ubicaciones/${u}`);
      return { lineas: e.lineas.length };
    });
  },

  traspasar(c, e) {
    const o = ubicacion(e.origenId);
    const d = ubicacion(e.destinoId);
    if (o === d) throw fallo('entrada-invalida', 'Origen y destino deben ser distintos');
    return operacion(c, 'traspaso', e.operacionId, [o, d, e.lineas], () => {
      const trabajos = e.lineas.map((l) => {
        const p = producto(c, l.productoId);
        return { p, l, series: validarSeries(p, l.cantidad, l.series) };
      });
      for (const { p, l, series } of trabajos) {
        if (p.existencias[o] < l.cantidad) throw fallo('stock-insuficiente', 'Stock insuficiente', { faltantes: [{ productoId: p.id, almacenId: o, pedido: l.cantidad, disponible: p.existencias[o] }] });
        for (const s of series) {
          const un = c.e.unidades.get(`${p.id}__${s}`);
          if (un === undefined || un.estado !== 'disponible' || un.ubicacionId !== o) throw fallo('serie-no-disponible');
        }
      }
      for (const { p, l, series } of trabajos) {
        for (const s of series) {
          const un = c.e.unidades.get(`${p.id}__${s}`);
          if (un !== undefined) c.e.unidades.set(`${p.id}__${s}`, { ...un, ubicacionId: d });
        }
        mover(c, e.operacionId, p, o, 'traspaso', -l.cantidad, series);
        mover(c, e.operacionId, p, d, 'traspaso', l.cantidad, series);
      }
      auditar(c, 'inventarios.traspaso', `ubicaciones/${o}`);
      return { lineas: e.lineas.length };
    });
  },

  ajustar(c, e) {
    const motivo = motivoObligatorio(e.motivo);
    return operacion(c, 'ajuste', e.operacionId, [motivo, e.lineas], () => {
      for (const l of e.lineas) {
        const p = producto(c, l.productoId);
        const u = ubicacion(l.ubicacionId);
        if (p.conSerie) throw fallo('estado-invalido', 'No se ajustan productos con serie');
        if (!Number.isSafeInteger(l.delta) || l.delta === 0) throw fallo('entrada-invalida', 'delta inválido');
        if (p.existencias[u] + l.delta < 0) throw fallo('stock-insuficiente');
        mover(c, e.operacionId, p, u, 'ajuste', l.delta, [], motivo);
      }
      auditar(c, 'inventarios.ajuste', 'existencias', motivo);
      return { lineas: e.lineas.length };
    });
  },

  solicitarMerma(c, e) {
    const motivo = motivoObligatorio(e.motivo);
    const u = ubicacion(e.ubicacionId);
    return operacion(c, 'merma-solicitar', e.operacionId, [e.productoId, u, e.cantidad, e.series, motivo], () => {
      const p = producto(c, e.productoId);
      const series = validarSeries(p, e.cantidad, e.series);
      for (const s of series) {
        const un = c.e.unidades.get(`${p.id}__${s}`);
        if (un === undefined || un.estado !== 'disponible' || un.ubicacionId !== u) throw fallo('serie-no-disponible');
      }
      if (p.existencias[u] < e.cantidad) throw fallo('stock-insuficiente');
      const mermaId = `merma-${e.operacionId}`;
      c.e.mermas.push({ mermaId, productoId: p.id, ubicacionId: u, cantidad: e.cantidad, series, motivo, estado: 'solicitada', solicitadaPor: c.uid, fecha: iso(c.ahora) });
      auditar(c, 'inventarios.merma-solicitar', `mermas/${mermaId}`, motivo);
      return { mermaId };
    });
  },

  resolverMerma(c, e) {
    if (e.decision === 'rechazada' && (e.motivo ?? '').trim() === '') throw fallo('entrada-invalida', 'Indique el motivo del rechazo.');
    return operacion(c, 'merma-resolver', e.operacionId, [e.mermaId, e.decision, e.motivo], () => {
      const i = c.e.mermas.findIndex((m) => m.mermaId === e.mermaId);
      const m = c.e.mermas[i];
      if (m === undefined) throw fallo('no-encontrado', 'La merma no existe');
      if (m.estado !== 'solicitada') throw fallo('estado-invalido', 'La merma ya fue resuelta');
      if (m.solicitadaPor === c.uid) throw fallo('estado-invalido', 'Quien solicitó la merma no la resuelve');
      if (e.decision === 'aprobada') {
        const p = producto(c, m.productoId);
        if (p.existencias[m.ubicacionId] < m.cantidad) throw fallo('stock-insuficiente');
        for (const s of m.series) {
          const un = c.e.unidades.get(`${p.id}__${s}`);
          if (un !== undefined) c.e.unidades.set(`${p.id}__${s}`, { ...un, estado: 'merma' });
        }
        mover(c, e.operacionId, p, m.ubicacionId, 'merma', -m.cantidad, m.series, m.motivo, m.mermaId);
      }
      c.e.mermas[i] = { ...m, estado: e.decision, resueltaPor: c.uid, ...(e.motivo !== undefined ? { motivoResolucion: e.motivo } : {}) };
      auditar(c, `inventarios.merma-${e.decision === 'aprobada' ? 'aprobar' : 'rechazar'}`, `mermas/${m.mermaId}`, e.motivo);
      return { mermaId: m.mermaId, estado: e.decision };
    });
  },

  abrirConteo(c, e) {
    const u = ubicacion(e.ubicacionId);
    if (!ID_SEG.test(e.conteoId)) throw fallo('entrada-invalida', 'conteoId inválido');
    return operacion(c, 'conteo-abrir', e.operacionId, [e.conteoId, u], () => {
      if ([...c.e.conteos.values()].some((k) => k.ubicacionId === u && k.estado === 'abierto')) throw fallo('estado-invalido', 'Ya hay un conteo abierto en ese almacén');
      if (c.e.conteos.has(e.conteoId)) throw fallo('estado-invalido', 'El conteo ya existe');
      c.e.conteos.set(e.conteoId, { conteoId: e.conteoId, ubicacionId: u, estado: 'abierto', abiertoPor: c.uid, fecha: iso(c.ahora), lineas: [], teoricos: new Map() });
      auditar(c, 'inventarios.conteo-abrir', `conteos/${e.conteoId}`);
      return { conteoId: e.conteoId };
    });
  },

  registrarLineaConteo(c, e) {
    return operacion(c, 'conteo-linea', e.operacionId, [e.conteoId, e.productoId, e.contado, e.series], () => {
      const k = c.e.conteos.get(e.conteoId);
      if (k === undefined) throw fallo('no-encontrado', 'Conteo inexistente');
      if (k.estado !== 'abierto') throw fallo('estado-invalido', 'El conteo no está abierto');
      const p = producto(c, e.productoId);
      const contado = e.series !== undefined ? e.series.length : e.contado;
      if (contado === undefined || !Number.isSafeInteger(contado) || contado < 0) throw fallo('entrada-invalida', 'contado inválido');
      // El teórico se guarda en el servidor, no se devuelve.
      k.teoricos.set(p.id, p.existencias[k.ubicacionId]);
      const lineas = k.lineas.filter((l) => l.productoId !== p.id);
      c.e.conteos.set(k.conteoId, { ...k, lineas: [...lineas, { productoId: p.id, contado, ...(e.series !== undefined ? { series: e.series } : {}) }] });
      return { productoId: p.id };
    });
  },

  cerrarConteo(c, e) {
    return operacion(c, 'conteo-cerrar', e.operacionId, [e.conteoId], () => {
      const k = c.e.conteos.get(e.conteoId);
      if (k === undefined) throw fallo('no-encontrado', 'Conteo inexistente');
      if (k.estado !== 'abierto') throw fallo('estado-invalido', 'El conteo no está abierto');
      const resultado = k.lineas.map((l) => {
        const teorico = k.teoricos.get(l.productoId) ?? 0;
        return { productoId: l.productoId, teorico, contado: l.contado, diferencia: l.contado - teorico };
      });
      for (const r of resultado) {
        const p = c.e.productos.get(r.productoId);
        if (p === undefined || r.diferencia === 0) continue;
        if (r.diferencia < 0) {
          c.e.mermas.push({
            mermaId: `merma-conteo-${k.conteoId}-${p.id}`, productoId: p.id, ubicacionId: k.ubicacionId, cantidad: -r.diferencia, series: [],
            motivo: `Faltante del conteo ${k.conteoId}`, estado: 'solicitada', solicitadaPor: c.uid, fecha: iso(c.ahora),
          });
        } else mover(c, e.operacionId, p, k.ubicacionId, 'conteo', r.diferencia, []);
      }
      // Conteo ciego completo: lo que tiene existencia y nadie contó se trata como contado en 0.
      const sinContar: string[] = [];
      for (const p of c.e.productos.values()) {
        if (k.lineas.some((l) => l.productoId === p.id) || p.stockTotal === undefined || (p.existencias[k.ubicacionId] ?? 0) <= 0) continue;
        sinContar.push(p.id);
        c.e.mermas.push({
          mermaId: `merma-conteo-${k.conteoId}-${p.id}`, productoId: p.id, ubicacionId: k.ubicacionId, cantidad: p.existencias[k.ubicacionId], series: [],
          motivo: `Faltante del conteo ${k.conteoId}`, estado: 'solicitada', solicitadaPor: c.uid, fecha: iso(c.ahora),
        });
      }
      const avisos = sinContar.length > 0 ? [`Productos con existencia que nadie contó, tratados como contados en 0 (merma solicitada): ${sinContar.join(', ')}`] : [];
      c.e.conteos.set(k.conteoId, { ...k, estado: 'cerrado', cerradoPor: c.uid, resultado });
      auditar(c, 'inventarios.conteo-cerrar', `conteos/${k.conteoId}`);
      return { conteoId: k.conteoId, sinContar, avisos };
    });
  },

  simularImportacionProductos(c, e) {
    exigirRol(c, ['adm']);
    return simularImportacionDoble(c, e);
  },

  importarProductosCsv(c, e) {
    exigirRol(c, ['adm']);
    return importarProductosDoble(c, e);
  },

  exportarProductosCsv(c) {
    exigirRol(c, ['sup', 'adm']);
    const verCosto = c.rol === 'adm';
    const cab = ['id', 'nombre', 'categoria', 'marca', 'sku', 'conSerie', 'garantiaMeses', 'minimo', 'precioUSDbo', 'precioUSDar', ...(verCosto ? ['costoUSD'] : []), 'activo', 'publicado'];
    const filas = [...c.e.productos.values()].map((p) => [
      p.id, p.nombre, p.categoria, p.marca ?? '', p.sku, p.conSerie, p.garantiaMeses ?? '', p.minimo ?? '', p.precioUSD.bo, p.precioUSD.ar,
      ...(verCosto ? [p.costoUSD] : []), p.activo, p.publicado,
    ]);
    return { csv: aCsv(cab, filas) };
  },

  listarProductos: (c) => [...c.e.productos.values()].map((p) => vistaProducto(p, c.rol === 'adm')).sort((a, b) => a.nombre.localeCompare(b.nombre)),

  listarSeries: (c, e) =>
    [...c.e.unidades.values()]
      .filter((u) => u.productoId === e.productoId)
      .filter((u) => (e.ubicacionId === undefined ? true : u.ubicacionId === e.ubicacionId))
      .filter((u) => (e.soloDisponibles === true ? u.estado === 'disponible' : true))
      .sort((a, b) => a.serie.localeCompare(b.serie)),

  buscarSerie: (c, e) => {
    const q = e.serie.trim().toLowerCase();
    if (q === '') return [];
    return [...c.e.unidades.values()]
      .filter((u) => u.serie.toLowerCase().includes(q))
      .map((u) => {
        const meses = c.e.productos.get(u.productoId)?.garantiaMeses;
        if (u.estado !== 'vendida' || meses === undefined || u.ventaRef === undefined) return u;
        const v = c.e.ventas.get(u.ventaRef);
        return v === undefined ? u : { ...u, garantiaHasta: c.e.recibos.get(`recibo-${v.ventaId}`)?.lineas.find((l) => l.series.includes(u.serie))?.garantiaHasta ?? '' };
      })
      .slice(0, 50);
  },

  listarMovimientos: (c, e) => {
    const coinciden = c.e.movimientos
      .filter((m) => (e.desde === undefined ? true : m.fecha.slice(0, 10) >= e.desde))
      .filter((m) => (e.hasta === undefined ? true : m.fecha.slice(0, 10) <= e.hasta))
      .filter((m) => (e.productoId === undefined ? true : m.productoId === e.productoId))
      .filter((m) => (e.tipo === undefined ? true : m.tipo === e.tipo))
      .filter((m) => (e.usuario === undefined ? true : m.por === e.usuario));
    const limite = e.limite ?? 200;
    return { movimientos: coinciden.slice(-limite).reverse(), cortada: coinciden.length > limite };
  },

  listarMermas: (c, e) => ({ mermas: c.e.mermas.filter((m) => (e.estado === undefined ? true : m.estado === e.estado)).slice().reverse(), cortada: false }),

  listarConteos: (c) =>
    [...c.e.conteos.values()].map((k) => ({
      conteoId: k.conteoId, ubicacionId: k.ubicacionId, estado: k.estado, abiertoPor: k.abiertoPor, ...(k.cerradoPor !== undefined ? { cerradoPor: k.cerradoPor } : {}), fecha: k.fecha, lineas: k.lineas,
      ...(c.rol !== 'caj' && k.estado === 'cerrado' && k.resultado !== undefined ? { resultado: k.resultado } : {}),
      // Con el conteo abierto, para todo rol: lo que hay que contar, sin existencias ni nada derivado de ellas.
      ...(k.estado === 'abierto'
        ? {
            productos: [...c.e.productos.values()]
              .filter((p) => p.stockTotal !== undefined)
              .map((p) => ({ productoId: p.id, nombre: p.nombre, sku: p.sku, categoria: p.categoria, ...(p.marca !== undefined ? { marca: p.marca } : {}), conSerie: p.conSerie }))
              .sort((x, y) => x.nombre.localeCompare(y.nombre)),
          }
        : {}),
    })),

  cotizacionesVigentes: (c) => c.e.cotizaciones,
};

/** CSV mínimo (RFC 4180) para la importación del doble. */
export function parsearCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let entre = false;
  const t = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i] as string;
    if (entre) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          celda += '"';
          i++;
        } else entre = false;
      } else celda += ch;
    } else if (ch === '"') entre = true;
    else if (ch === ',') {
      fila.push(celda);
      celda = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      fila.push(celda);
      celda = '';
      if (fila.some((x) => x !== '')) filas.push(fila);
      fila = [];
    } else celda += ch;
  }
  if (celda !== '' || fila.length > 0) {
    fila.push(celda);
    if (fila.some((x) => x !== '')) filas.push(fila);
  }
  return filas;
}
