import type { Actor } from '@novutienda/nucleo';
import type {
  AlmacenMedios, CatalogoPuerto, ConsultaSubidas, DisparadorSitio, Existencia, InfoMedio,
  ProcesadorMedios, ProductoCatalogo, Reloj, SolicitudProcesado, VersionProcesada,
} from '@novutienda/consola';
import { ArchivoNoAdmitido, ProcesamientoNoDisponible } from '@novutienda/consola';
import { DobleDb } from './doble-db.js';

export const T = 't1';
export const tenantOk = { estado: 'activo', plan: 'base', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] };

export const actor = (rol: 'caj' | 'sup' | 'adm', tenant = T, uid = `u-${rol}`): Actor => ({
  uid,
  claims: { firebase: { sign_in_provider: 'password' }, pl: { t: { [tenant]: rol }, v: 1 } },
});

export function nuevaDb(): DobleDb {
  const db = new DobleDb();
  db.poner(`tenants/${T}`, tenantOk);
  return db;
}

export class RelojFijo implements Reloj {
  constructor(public ms = Date.UTC(2026, 10, 4, 12, 0, 0)) {}
  ahora(): number {
    return this.ms;
  }
}

/** Catálogo en memoria, de solo lectura como el puerto. */
export class CatalogoDoble implements CatalogoPuerto {
  readonly productos = new Map<string, ProductoCatalogo>();
  readonly existencias = new Map<string, Existencia[]>();
  constructor(readonly db?: DobleDb) {}

  agregar(id: string, extra: Partial<ProductoCatalogo> = {}): ProductoCatalogo {
    const p: ProductoCatalogo = { id, nombre: `Producto ${id}`, categoria: 'general', activo: true, disponible: true, precioUSD: { bo: 10, ar: 12 }, ...extra };
    this.productos.set(id, p);
    return p;
  }
  listarProductos(): Promise<readonly ProductoCatalogo[]> {
    return Promise.resolve([...this.productos.values()]);
  }
  leerProducto(_t: string, id: string): Promise<ProductoCatalogo | undefined> {
    return Promise.resolve(this.productos.get(id));
  }
  existenciasPorAlmacen(_t: string, id: string): Promise<readonly Existencia[]> {
    return Promise.resolve(this.existencias.get(id) ?? []);
  }
}

/** Almacén en memoria con contenido real: el hash es SHA-256 de los bytes. */
export class AlmacenDoble implements AlmacenMedios {
  readonly objetos = new Map<string, Uint8Array>();
  fallaAlBorrar = false;
  async tamano(ruta: string): Promise<number | undefined> {
    return this.objetos.get(ruta)?.length;
  }
  async leerInicio(ruta: string, n: number): Promise<Uint8Array> {
    return (this.objetos.get(ruta) ?? new Uint8Array()).slice(0, n);
  }
  async hashContenido(ruta: string): Promise<string> {
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(this.objetos.get(ruta) ?? new Uint8Array()).digest('hex');
  }
  async publicar(origen: string, destino: string): Promise<void> {
    this.objetos.set(destino, this.objetos.get(origen) as Uint8Array);
  }
  async borrar(rutas: readonly string[]): Promise<void> {
    if (this.fallaAlBorrar) throw new Error('almacenamiento caído');
    for (const r of rutas) this.objetos.delete(r);
  }
  async borrarPrefijo(prefijo: string): Promise<void> {
    for (const r of [...this.objetos.keys()]) if (r.startsWith(prefijo)) this.objetos.delete(r);
  }
  /** Sube un objeto como lo haría el cliente a la ruta privada. */
  subir(ruta: string, bytes: Uint8Array): void {
    this.objetos.set(ruta, bytes);
  }
}

// ---- Bytes de muestra --------------------------------------------------------------------------------------

const rellenar = (cabecera: number[], total = 128): Uint8Array => {
  const b = new Uint8Array(total);
  b.set(cabecera);
  return b;
};
const texto = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

export const JPG = rellenar([0xff, 0xd8, 0xff, 0xe0]);
export const PNG = rellenar([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const WEBP = rellenar([...texto('RIFF'), 0, 0, 0, 0, ...texto('WEBP')]);
export const HEIC = rellenar([0, 0, 0, 24, ...texto('ftyp'), ...texto('heic'), 0, 0, 0, 0, ...texto('mif1'), ...texto('heic')]);
export const MP4 = rellenar([0, 0, 0, 24, ...texto('ftyp'), ...texto('isom'), 0, 0, 0, 0, ...texto('isom'), ...texto('mp42')]);
export const MOV = rellenar([0, 0, 0, 20, ...texto('ftyp'), ...texto('qt  '), 0, 0, 0, 0, ...texto('qt  ')]);
export const WEBM = rellenar([0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x82, 0x84, ...texto('webm')]);
export const EXE = rellenar([0x4d, 0x5a, 0x90, 0x00]);
export const AVIF = rellenar([0, 0, 0, 24, ...texto('ftyp'), ...texto('avif'), 0, 0, 0, 0, ...texto('mif1'), ...texto('avif')]);

/** JPEG con un segmento APP1 Exif (lo que lleva el GPS). */
export const JPG_CON_EXIF = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, ...texto('Exif'), 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0xff, 0xda, 0, 2]);
/** JPEG limpio de metadatos (APP0 JFIF y datos). */
export const JPG_LIMPIO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xda, 0, 2, 9, 9, 9]);

/** Contenido distinto para cada versión: así el hash por contenido las distingue. */
const contenidoVersion = (v: { clase: string; lado: number; formato: string }, sucio: boolean): Uint8Array => {
  if (v.clase === 'video') return new Uint8Array([...texto(`video${String(v.lado)}`), 1, 2, 3]);
  if (sucio) return new Uint8Array([...JPG_CON_EXIF, ...texto(`${v.formato}${String(v.lado)}`)]);
  return new Uint8Array([...JPG_LIMPIO, ...texto(`${v.formato}${String(v.lado)}${v.clase}`)]);
};

/** Procesador simulado: respeta el plan y escribe versiones en el almacén. */
export class ProcesadorSimulado implements ProcesadorMedios {
  info: InfoMedio = { ancho: 3000, alto: 2000 };
  lanza = false;
  lanzaNoDisponible = false;
  lanzaNoAdmitido: string | undefined = undefined;
  videoDisponible = true;
  dejarMetadatos = false;
  omitirUna = false;
  escribirFuera = false;
  constructor(private readonly almacen: AlmacenDoble) {}
  async disponible(tipo: 'foto' | 'video'): Promise<boolean> {
    return tipo === 'video' ? this.videoDisponible : true;
  }
  async inspeccionar(): Promise<InfoMedio> {
    return this.info;
  }
  async procesar(s: SolicitudProcesado): Promise<readonly VersionProcesada[]> {
    if (this.lanzaNoAdmitido !== undefined) throw new ArchivoNoAdmitido(this.lanzaNoAdmitido);
    if (this.lanzaNoDisponible) throw new ProcesamientoNoDisponible('servicio de video caído');
    if (this.lanza) throw new Error('imagen ilegible');
    const salida: VersionProcesada[] = [];
    for (const item of this.omitirUna ? s.plan.items.slice(1) : s.plan.items) {
      const ruta = `${this.escribirFuera ? 'tenants/otro/privado' : s.destinoTemporal}/${item.clase}-${String(item.lado)}.${item.formato}`;
      this.almacen.subir(ruta, contenidoVersion(item, this.dejarMetadatos));
      salida.push({ ...item, rutaTemporal: ruta });
    }
    return salida;
  }
}

export class ConsultaDoble implements ConsultaSubidas {
  constructor(private readonly db: DobleDb) {}
  async listarPorEstado(t: string, estado: 'reservada' | 'procesando' | 'borrando', limite: number) {
    return [...this.db.docs]
      .filter(([r, d]) => r.startsWith(`tenants/${t}/subidas/`) && d.datos?.['estado'] === estado)
      .slice(0, limite)
      .map(([r, d]) => ({ id: r.split('/').pop() as string, data: d.datos as Record<string, unknown> }));
  }
}

export class DisparadorDoble implements DisparadorSitio {
  readonly eventos: string[] = [];
  async programar(_t: string, para: number): Promise<void> {
    this.eventos.push(`programar:${String(para)}`);
  }
  async reconstruir(_t: string, version: number, motivo: string): Promise<void> {
    this.eventos.push(`reconstruir:${String(version)}:${motivo}`);
  }
}
