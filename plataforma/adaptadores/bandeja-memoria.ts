// Bandeja de eventos en memoria, SOLO para pruebas de integración. Lee los eventos que los módulos
// publicaron (`tenants/{t}/eventos/*`, escritos en la transacción del negocio) y los entrega a los
// consumidores, con entrega duplicada y desordenada como la de un bus real (al menos una vez).
import { consumirPedidoConfirmado, consumirVentaAnulada, ejecutorDesde } from '@plataforma/inventarios';
import type { BaseDatosIdentidad, SobreEvento } from '@plataforma/nucleo';
import { manejarVentaAnulada, manejarVentaConfirmada, type OpcionesEmision } from '@plataforma/recibos';
import type { LectorColecciones } from './colecciones.js';
import { ejecutorRecibosDesde } from './ejecutor-recibos.js';

export interface Consumidor {
  /** Nombre para el informe (no es el nombre del consumidor de la bandeja). */
  readonly nombre: string;
  readonly tipos: readonly string[];
  /** Devuelve `false` si el evento era duplicado o quedó descartado. Lanza si falla (el bus reintenta). */
  manejar(evento: SobreEvento): Promise<boolean>;
}

/** Los consumidores reales de la plataforma: Recibos (2) e Inventarios (2). */
export function consumidoresDePlataforma(db: BaseDatosIdentidad, opcionesRecibos: OpcionesEmision = {}): Consumidor[] {
  const recibos = ejecutorRecibosDesde(db);
  const inventarios = ejecutorDesde(db);
  return [
    { nombre: 'recibos:venta.confirmada', tipos: ['venta.confirmada'], manejar: (e) => manejarVentaConfirmada(recibos, e, opcionesRecibos) },
    { nombre: 'recibos:venta.anulada', tipos: ['venta.anulada'], manejar: (e) => manejarVentaAnulada(recibos, e, opcionesRecibos) },
    { nombre: 'inventarios:venta.anulada', tipos: ['venta.anulada'], manejar: (e) => consumirVentaAnulada(inventarios, e) },
    { nombre: 'inventarios:pedido.confirmado', tipos: ['pedido.confirmado'], manejar: (e) => consumirPedidoConfirmado(inventarios, e) },
  ];
}

export type OrdenEntrega = 'publicacion' | 'inverso' | 'barajado';

export interface OpcionesEntrega {
  /** Copias extra de cada entrega (0 = una sola). */
  readonly duplicados?: number;
  readonly orden?: OrdenEntrega;
  /** Semilla del orden barajado (determinista). */
  readonly semilla?: number;
  /** Pasadas máximas: lo que falla se reintenta en la pasada siguiente. */
  readonly maxRondas?: number;
}

export interface ResumenEntrega {
  /** Entregas que produjeron efectos. */
  readonly aplicadas: number;
  /** Entregas que el consumidor reconoció como duplicadas (o descartadas). */
  readonly ignoradas: number;
  /** Fallos que se reintentaron en otra pasada. */
  readonly reintentos: number;
  /** Entregas que siguieron fallando tras la última pasada. */
  readonly fallidas: readonly { readonly consumidor: string; readonly eventoId: string; readonly error: string }[];
}

interface Entrega {
  readonly consumidor: Consumidor;
  readonly evento: SobreEvento;
}

/** Generador pseudoaleatorio determinista (mulberry32). */
function aleatorio(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class BandejaMemoria {
  constructor(
    private readonly lector: LectorColecciones,
    private readonly consumidores: readonly Consumidor[],
  ) {}

  /** Eventos publicados del tenant, en orden de publicación y sin la marca de tiempo del servidor. */
  async publicados(tenantId: string, tipo?: string): Promise<SobreEvento[]> {
    const docs = await this.lector.listar(`tenants/${tenantId}/eventos`);
    return docs
      .map((d) => {
        const sobre: Record<string, unknown> = { ...d.datos };
        delete sobre['publicadoEn'];
        return sobre as unknown as SobreEvento;
      })
      .filter((e) => tipo === undefined || e.tipo === tipo);
  }

  /** Entrega a los consumidores suscritos al tipo de cada evento publicado. */
  async entregar(tenantId: string, opciones: OpcionesEntrega = {}): Promise<ResumenEntrega> {
    const copias = 1 + (opciones.duplicados ?? 0);
    const entregas: Entrega[] = [];
    for (const evento of await this.publicados(tenantId)) {
      for (const consumidor of this.consumidores.filter((c) => c.tipos.includes(evento.tipo))) {
        for (let i = 0; i < copias; i++) entregas.push({ consumidor, evento });
      }
    }
    return this.entregarLista(ordenar(entregas, opciones), opciones.maxRondas ?? 4);
  }

  /** Entrega un evento concreto (por ejemplo uno que un servicio externo publicó sin pasar por la base). */
  async entregarEvento(evento: SobreEvento, opciones: OpcionesEntrega = {}): Promise<ResumenEntrega> {
    const copias = 1 + (opciones.duplicados ?? 0);
    const entregas: Entrega[] = [];
    for (const consumidor of this.consumidores.filter((c) => c.tipos.includes(evento.tipo))) {
      for (let i = 0; i < copias; i++) entregas.push({ consumidor, evento });
    }
    return this.entregarLista(entregas, opciones.maxRondas ?? 4);
  }

  private async entregarLista(inicial: readonly Entrega[], maxRondas: number): Promise<ResumenEntrega> {
    let pendientes = [...inicial];
    let aplicadas = 0;
    let ignoradas = 0;
    let reintentos = 0;
    let ultimos = new Map<Entrega, string>();
    for (let ronda = 1; ronda <= maxRondas && pendientes.length > 0; ronda++) {
      const fallidas: Entrega[] = [];
      ultimos = new Map();
      for (const entrega of pendientes) {
        try {
          if (await entrega.consumidor.manejar(entrega.evento)) aplicadas++;
          else ignoradas++;
        } catch (error) {
          fallidas.push(entrega);
          ultimos.set(entrega, error instanceof Error ? error.name : 'desconocido');
        }
      }
      reintentos += ronda < maxRondas ? fallidas.length : 0;
      pendientes = fallidas;
    }
    return {
      aplicadas,
      ignoradas,
      reintentos,
      fallidas: pendientes.map((p) => ({ consumidor: p.consumidor.nombre, eventoId: p.evento.id, error: ultimos.get(p) ?? 'desconocido' })),
    };
  }
}

function ordenar(entregas: Entrega[], o: OpcionesEntrega): Entrega[] {
  if (o.orden === 'inverso') return [...entregas].reverse();
  if (o.orden === 'barajado') {
    const azar = aleatorio(o.semilla ?? 1);
    const copia = [...entregas];
    for (let i = copia.length - 1; i > 0; i--) {
      const j = Math.floor(azar() * (i + 1));
      [copia[i], copia[j]] = [copia[j] as Entrega, copia[i] as Entrega];
    }
    return copia;
  }
  return entregas;
}
