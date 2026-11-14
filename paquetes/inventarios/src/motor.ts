import { type MotivoStockCambiado, type Rol, type TransaccionMin } from '@novutienda/nucleo';
import { ErrorInventario, EstadoInvalido, ProductoInactivo, SerieNoDisponible, StockInsuficiente } from './errores.js';
import { esDisponible, UBICACION_DISPONIBILIDAD } from './disponibilidad.js';
import { idExistencia, idUnidad, ruta } from './ids.js';

export type Datos = Record<string, unknown>;
export interface Autor {
  readonly uid: string;
  readonly rol: Rol;
}
export interface Referencia {
  readonly tipo: string;
  readonly id: string;
}

/** Valor que `aplicarPlan` sustituye por la marca de tiempo del servidor. */
export const MARCA_SERVIDOR = '\u0000marca-servidor';

let reloj: () => number = () => Date.now();
/** Solo para pruebas: fija el reloj del módulo. */
export function fijarReloj(f: () => number): void {
  reloj = f;
}
export const ahoraIso = (): string => new Date(reloj()).toISOString();

export interface EscrituraPlan {
  readonly ruta: string;
  readonly datos: Datos;
  readonly modo: 'set' | 'create';
}

/** Cambio de una unidad con serie; `aplicarPlan` arma el documento con la referencia de la operación. */
export interface UnidadPlan {
  readonly productoId: string;
  readonly serie: string;
  /** Documento previo (se conserva); ausente al crear. */
  readonly base?: Datos;
  readonly estado: 'disponible' | 'vendida' | 'merma';
  readonly ubicacionId: string;
  readonly garantiaHasta?: string;
  readonly modo: 'set' | 'create';
}

export interface MovimientoPlan {
  readonly productoId: string;
  readonly ubicacionId: string;
  readonly delta: number;
  readonly saldoUbicacion: number;
  readonly saldoTotal: number;
  readonly series: readonly string[];
  readonly costoUSDUnit?: number;
  /** Tipo propio del movimiento; si falta, el de la operación. */
  readonly tipo?: MotivoStockCambiado;
}

export interface AlertaPlan {
  readonly productoId: string;
  readonly saldoTotal: number;
  readonly minimo: number;
}

/** Todo lo que una operación va a escribir, calculado solo con lecturas. */
export interface PlanStock {
  readonly tenantId: string;
  readonly ahora: string;
  readonly docs: readonly EscrituraPlan[];
  readonly unidades: readonly UnidadPlan[];
  readonly movimientos: readonly MovimientoPlan[];
  readonly alertas: readonly AlertaPlan[];
}

/** Lector con caché dentro de una transacción: cada documento se lee una sola vez. */
export class Lector {
  private readonly cache = new Map<string, Promise<Datos | undefined>>();
  constructor(
    readonly tx: Pick<TransaccionMin, 'get'>,
    readonly tenantId: string,
  ) {}

  leer(coleccion: string, id: string): Promise<Datos | undefined> {
    return this.leerRuta(ruta(this.tenantId, coleccion, id));
  }

  leerRuta(r: string): Promise<Datos | undefined> {
    let p = this.cache.get(r);
    if (p === undefined) {
      p = this.tx.get(r).then((d) => {
        const v = d.existe ? d.data() : undefined;
        return v === undefined ? undefined : { ...v };
      });
      this.cache.set(r, p);
    }
    return p;
  }
}

interface EstadoExistencia {
  cantidad: number;
  series: string[];
}

const entero = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x);

export const controlaStock = (p: Datos): boolean => entero(p['stockTotal']);

export function bajoMinimo(p: Datos): boolean {
  const min = p['minimo'];
  return entero(min) && entero(p['stockTotal']) && p['stockTotal'] <= min;
}

/**
 * Fecha de calendario aaaa-mm-dd de un instante ISO en la zona dada (no en UTC). La zona NO tiene valor por omisión: la
 * decide quien llama con la configuración del tenant (la del mercado de la operación o, si no hay mercado, `zonaPrincipalDe`).
 */
export function fechaLocal(instanteIso: string, zona: string): string {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instanteIso));
  const g = (t: string): string => partes.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

/** Fin de garantía: suma meses a la fecha de calendario del instante en la zona (si el día no existe, el último del mes). */
export function sumarMeses(instanteIso: string, meses: number, zona: string): string {
  const [a, m, d] = fechaLocal(instanteIso, zona).split('-').map(Number) as [number, number, number];
  const indice = a * 12 + (m - 1) + meses;
  const anio = Math.floor(indice / 12);
  const mes = (indice % 12) + 1;
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

/**
 * Estado de trabajo de una operación: carga documentos (solo lecturas) y aplica los
 * movimientos en memoria, validando invariantes; `plan()` entrega lo que hay que escribir.
 */
export class Trabajo {
  readonly ahora = ahoraIso();
  private readonly productos = new Map<string, Datos>();
  private readonly bajoAntes = new Map<string, boolean>();
  private readonly costos = new Map<string, number | undefined>();
  private readonly existencias = new Map<string, EstadoExistencia>();
  private readonly unidadesLeidas = new Map<string, Datos | undefined>();
  private readonly unidadesPlan: UnidadPlan[] = [];
  private readonly movs = new Map<string, MovimientoPlan>();
  private readonly extra: EscrituraPlan[] = [];
  private readonly nuevos = new Set<string>();

  constructor(readonly lector: Lector) {}

  get tenantId(): string {
    return this.lector.tenantId;
  }

  /** Carga producto, costo y existencia (lecturas). Lanza `ProductoInactivo('inexistente')` si el producto no existe. */
  async cargar(productoId: string, ubicacionId: string): Promise<void> {
    // También se lee la existencia en `tienda`: de ella depende `existenciasPublicas` (ver `esDisponible`).
    const [prod, costo, ex, tienda] = await Promise.all([
      this.lector.leer('productos', productoId),
      this.lector.leer('costos', productoId),
      this.lector.leer('existencias', idExistencia(productoId, ubicacionId)),
      ubicacionId === UBICACION_DISPONIBILIDAD ? undefined : this.lector.leer('existencias', idExistencia(productoId, UBICACION_DISPONIBILIDAD)),
    ]);
    if (prod === undefined) throw new ProductoInactivo(productoId, 'inexistente');
    if (!this.productos.has(productoId)) {
      this.productos.set(productoId, prod);
      this.bajoAntes.set(productoId, bajoMinimo(prod));
      const c = costo?.['costoUSD'];
      this.costos.set(productoId, typeof c === 'number' && Number.isFinite(c) && c >= 0 ? c : undefined);
    }
    this.registrarExistencia(idExistencia(productoId, ubicacionId), ex);
    if (ubicacionId !== UBICACION_DISPONIBILIDAD) this.registrarExistencia(idExistencia(productoId, UBICACION_DISPONIBILIDAD), tienda);
  }

  private registrarExistencia(k: string, ex: Datos | undefined): void {
    if (this.existencias.has(k)) return;
    const cantidad = ex?.['cantidad'] ?? 0;
    const series = ex?.['series'] ?? [];
    if (!entero(cantidad) || cantidad < 0 || !Array.isArray(series) || !series.every((s) => typeof s === 'string')) {
      throw new ErrorInventario('failed-precondition', `Existencia corrupta: ${k}`);
    }
    this.existencias.set(k, { cantidad, series: [...(series as string[])] });
  }

  /** Registra un producto que esta misma operación crea (aún no existe en la base): admite movimientos. */
  sembrar(productoId: string, doc: Datos, ubicaciones: readonly string[], costoUSD?: number): void {
    this.productos.set(productoId, doc);
    this.bajoAntes.set(productoId, false);
    this.costos.set(productoId, costoUSD);
    this.nuevos.add(productoId);
    for (const u of ubicaciones) this.existencias.set(idExistencia(productoId, u), { cantidad: 0, series: [] });
  }

  producto(productoId: string): Datos {
    const p = this.productos.get(productoId);
    if (p === undefined) throw new Error(`producto no cargado: ${productoId}`);
    return p;
  }

  existencia(productoId: string, ubicacionId: string): Readonly<EstadoExistencia> {
    const e = this.existencias.get(idExistencia(productoId, ubicacionId));
    if (e === undefined) throw new Error('existencia no cargada');
    return e;
  }

  /** Lee (y guarda) el documento de una unidad. */
  async unidad(productoId: string, serie: string): Promise<Datos | undefined> {
    const k = idUnidad(productoId, serie);
    if (!this.unidadesLeidas.has(k)) this.unidadesLeidas.set(k, await this.lector.leer('unidades', k));
    return this.unidadesLeidas.get(k);
  }

  unidadLeida(productoId: string, serie: string): Datos | undefined {
    return this.unidadesLeidas.get(idUnidad(productoId, serie));
  }

  marcarUnidad(u: UnidadPlan): void {
    this.unidadesPlan.push(u);
  }

  /** Escritura adicional ajena al stock (merma, traspaso, conteo, contador de plan...). */
  escribir(e: EscrituraPlan): void {
    this.extra.push(e);
  }

  /**
   * Aplica un movimiento en memoria. Con serie, `quitar`/`agregar` mantienen la lista de
   * disponibles del almacén (orden = antigüedad). Nunca deja un saldo negativo.
   */
  mover(
    productoId: string,
    ubicacionId: string,
    delta: number,
    opciones: { quitar?: readonly string[]; agregar?: readonly string[]; tipo?: MotivoStockCambiado } = {},
  ): void {
    const prod = this.producto(productoId);
    const ex = this.existencias.get(idExistencia(productoId, ubicacionId));
    if (ex === undefined) throw new Error('existencia no cargada');
    if (!Number.isSafeInteger(delta) || delta === 0) throw new EstadoInvalido('delta inválido');
    if (!entero(prod['stockTotal'])) throw new EstadoInvalido(`El producto ${productoId} no controla stock`);
    const nueva = ex.cantidad + delta;
    const quitar = opciones.quitar ?? [];
    const agregar = opciones.agregar ?? [];
    // Las series se comprueban ANTES que la cantidad: una serie que no pertenece falla igual haya o no stock.
    if (prod['conSerie'] === true) {
      for (const s of quitar) if (!ex.series.includes(s)) throw new SerieNoDisponible(productoId, s);
    }
    if (nueva < 0) {
      throw new StockInsuficiente([{ productoId, almacenId: ubicacionId, pedido: -delta, disponible: ex.cantidad }]);
    }
    if (prod['conSerie'] === true) {
      const restantes = ex.series.filter((s) => !quitar.includes(s));
      for (const s of agregar) if (restantes.includes(s)) throw new EstadoInvalido(`Serie ya disponible: ${s}`);
      const series = [...restantes, ...agregar];
      if (series.length !== nueva) throw new EstadoInvalido('Series y cantidad no coinciden');
      ex.series = series;
    } else if (quitar.length > 0 || agregar.length > 0) {
      throw new EstadoInvalido(`El producto ${productoId} no lleva serie`);
    }
    ex.cantidad = nueva;
    prod['stockTotal'] = prod['stockTotal'] + delta;

    const k = idExistencia(productoId, ubicacionId);
    const previo = this.movs.get(k);
    const costo = this.costos.get(productoId);
    const tipo = opciones.tipo ?? previo?.tipo;
    const mov: MovimientoPlan = {
      productoId,
      ubicacionId,
      delta: (previo?.delta ?? 0) + delta,
      saldoUbicacion: nueva,
      saldoTotal: prod['stockTotal'] as number,
      series: [...(previo?.series ?? []), ...quitar, ...agregar],
      ...(costo !== undefined ? { costoUSDUnit: costo } : {}),
      ...(tipo !== undefined ? { tipo } : {}),
    };
    this.movs.set(k, mov);
  }

  plan(): PlanStock {
    const docs: EscrituraPlan[] = [];
    const alertas: AlertaPlan[] = [];
    const movidos = new Set([...this.movs.values()].map((m) => m.productoId));
    for (const id of new Set([...movidos, ...this.nuevos])) {
      const prod = this.producto(id);
      const bajo = bajoMinimo(prod);
      const nuevo = this.nuevos.has(id);
      const version = nuevo ? 1 : (entero(prod['version']) ? prod['version'] : 0) + 1;
      const total = typeof prod['stockTotal'] === 'number' ? prod['stockTotal'] : 0;
      const modo = nuevo ? 'create' : 'set';
      docs.push({
        ruta: ruta(this.tenantId, 'productos', id),
        modo,
        datos: { ...prod, bajoMinimo: bajo, version, ...(movidos.has(id) ? { conMovimientos: true } : {}) },
      });
      docs.push({
        ruta: ruta(this.tenantId, 'existenciasPublicas', id),
        modo,
        datos: {
          productoId: id,
          disponible: esDisponible(
            { activo: prod['activo'] === true, ...(typeof prod['stockTotal'] === 'number' ? { stockTotal: prod['stockTotal'] } : {}) },
            this.existencias.get(idExistencia(id, UBICACION_DISPONIBILIDAD))?.cantidad ?? 0,
          ),
          version,
        },
      });
      if (movidos.has(id) && bajo && this.bajoAntes.get(id) !== true) alertas.push({ productoId: id, saldoTotal: total, minimo: prod['minimo'] as number });
    }
    for (const m of this.movs.values()) {
      const ex = this.existencia(m.productoId, m.ubicacionId);
      const conSerie = this.producto(m.productoId)['conSerie'] === true;
      docs.push({
        ruta: ruta(this.tenantId, 'existencias', idExistencia(m.productoId, m.ubicacionId)),
        modo: 'set',
        datos: {
          productoId: m.productoId,
          ubicacionId: m.ubicacionId,
          cantidad: ex.cantidad,
          ...(conSerie ? { series: [...ex.series] } : {}),
        },
      });
    }
    return {
      tenantId: this.tenantId,
      ahora: this.ahora,
      docs: [...docs, ...this.extra],
      unidades: this.unidadesPlan,
      movimientos: [...this.movs.values()],
      alertas,
    };
  }
}
