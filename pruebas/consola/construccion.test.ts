// Construcción inmediata del sitio (DR-CB, P3): ventana de 60 s, tarea temprana, bloqueo por sitio, aviso de `cloud-builds`,
// reintento único y temporizador de red. Todo con puertos en memoria; sin constructor (modo `github`) no hay efecto.
import { describe, expect, it, vi } from 'vitest';
import { decidirBloqueo, decidirReconstruccion, ejecutarReconstruccion, LIMITES_CONSOLA, type ConstructorSitio } from '@novutienda/consola';
import {
  lanzarSiguiente, manejarAvisoConstruccion, manejarTareaConstruccion, redConstruccion, type AlmacenConstruccion, type BloqueoSitio,
  type DepsConstruccion, type TrabajoSitio, type TxConstruccion,
} from '../../plataforma/funciones/servidor/construccion-sitio.js';
import { crearDisparadorSitio, nombreTareaSitio } from '../../plataforma/funciones/servidor/disparador-sitio.js';
import { DisparadorDoble, RelojFijo, T, nuevaDb } from './dobles.js';

const MIN = 60_000;

class AlmacenDoble implements AlmacenConstruccion {
  readonly trabajos = new Map<string, TrabajoSitio>();
  bloqueo: BloqueoSitio | null = null;
  ultimaImagen: string | undefined;
  version: number | undefined = 5;

  poner(id: string, estado: string, solicitadaEnMs: number, extra: Partial<TrabajoSitio> = {}): void {
    this.trabajos.set(id, { id, estado, solicitadaEnMs, version: 1, ...extra });
  }
  estadoDe(id: string): string | undefined {
    return this.trabajos.get(id)?.estado;
  }
  async transaccion<R>(_t: string, fn: (tx: TxConstruccion) => Promise<R>): Promise<R> {
    const escrituras: (() => void)[] = [];
    const tx: TxConstruccion = {
      estado: () => Promise.resolve({ bloqueo: this.bloqueo, ...(this.ultimaImagen === undefined ? {} : { ultimaImagen: this.ultimaImagen }) }),
      pendientes: () => Promise.resolve([...this.trabajos.values()].filter((j) => j.estado === 'pendiente').sort((a, b) => a.solicitadaEnMs - b.solicitadaEnMs)),
      trabajo: (id) => Promise.resolve(this.trabajos.get(id)),
      fijarBloqueo: (b, u) => escrituras.push(() => { this.bloqueo = b; this.ultimaImagen = u; }),
      liberar: (u) => escrituras.push(() => { this.bloqueo = null; this.ultimaImagen = u; }),
      marcar: (id, estado) => escrituras.push(() => { const j = this.trabajos.get(id); if (j) this.trabajos.set(id, { ...j, estado }); }),
    };
    const r = await fn(tx);
    for (const e of escrituras) e();
    return r;
  }
  abiertos(): Promise<readonly TrabajoSitio[]> {
    return Promise.resolve([...this.trabajos.values()].filter((j) => j.estado === 'pendiente' || j.estado === 'en_curso'));
  }
  crearPendiente(_t: string, id: string, d: { version: number; motivo: string; solicitadaEnMs: number }): Promise<void> {
    if (!this.trabajos.has(id)) this.trabajos.set(id, { id, estado: 'pendiente', ...d });
    return Promise.resolve();
  }
  leerUltimaImagen(): Promise<string | undefined> {
    return Promise.resolve(this.ultimaImagen);
  }
  versionPublicada(): Promise<number | undefined> {
    return Promise.resolve(this.version);
  }
}

class ConstructorDoble implements ConstructorSitio {
  readonly lanzados: string[] = [];
  falla = false;
  lanzar(_t: string, trabajoId: string): Promise<{ buildId: string; imagen: string }> {
    if (this.falla) return Promise.reject(new Error('sin cuota'));
    this.lanzados.push(trabajoId);
    return Promise.resolve({ buildId: `b${String(this.lanzados.length)}`, imagen: 'img@sha256:aaa' });
  }
}

function montar(extra: Partial<DepsConstruccion> = {}) {
  const almacen = new AlmacenDoble();
  const reloj = new RelojFijo();
  const constructor = new ConstructorDoble();
  const deps: DepsConstruccion = { almacen, reloj, constructorSitio: constructor, imagenActual: 'img@sha256:aaa', ...extra };
  return { almacen, reloj, constructor, deps };
}

describe('decisiones puras', () => {
  const ahora = 1_000_000;
  it('la ventana es de 60 s y la tarea admite 5 s de adelanto', () => {
    expect(LIMITES_CONSOLA.ventanaReconstruccionMs).toBe(60_000);
    expect(LIMITES_CONSOLA.toleranciaTareaMs).toBe(5_000);
    expect(decidirReconstruccion({ hayPublicacion: true, programadaPara: ahora + 5_000 }, ahora, 'tarea')).toEqual({ accion: 'reconstruir' });
    expect(decidirReconstruccion({ hayPublicacion: true, programadaPara: ahora + 5_001 }, ahora, 'tarea')).toEqual({ accion: 'esperar', para: ahora + 5_001 });
    // El temporizador no tiene tolerancia: una tarea temprana no cambia su regla.
    expect(decidirReconstruccion({ hayPublicacion: true, programadaPara: ahora + 5_000 }, ahora, 'temporizador')).toEqual({ accion: 'esperar', para: ahora + 5_000 });
    expect(decidirReconstruccion({ hayPublicacion: true, programadaPara: null }, ahora, 'tarea')).toEqual({ accion: 'nada' });
  });
  it('bloqueo por sitio: libre lanza, ocupado espera, ocupado más de 12 min relanza', () => {
    expect(decidirBloqueo(null, ahora)).toBe('lanzar');
    expect(decidirBloqueo({ desdeMs: ahora - 1 * MIN }, ahora)).toBe('esperar');
    expect(decidirBloqueo({ desdeMs: ahora - 12 * MIN }, ahora)).toBe('esperar');
    expect(decidirBloqueo({ desdeMs: ahora - 12 * MIN - 1 }, ahora)).toBe('relanzar');
  });
});

describe('primerCambioEnMs', () => {
  it('la reconstrucción lo limpia junto con la hora agendada', async () => {
    const db = nuevaDb();
    const reloj = new RelojFijo();
    const ruta = `tenants/${T}/publicado/estado`;
    db.poner(ruta, { version: 1, reconstruccion: { programadaPara: reloj.ms + 60_000, primerCambioEnMs: reloj.ms, ultima: null } });
    reloj.ms += 60_000;
    await ejecutarReconstruccion({ db, reloj, disparador: new DisparadorDoble() }, { tenantId: T, evento: 'temporizador' });
    expect(db.dato(ruta)?.['reconstruccion']).toMatchObject({ programadaPara: null, primerCambioEnMs: null });
  });
});

describe('modo github (sin ConstructorSitio): sin efecto', () => {
  it('ningún manejador toca nada', async () => {
    const almacen = new AlmacenDoble();
    almacen.poner('rec-a', 'pendiente', 1);
    const deps: DepsConstruccion = { almacen, reloj: new RelojFijo() };
    expect(await lanzarSiguiente(deps, T)).toBe('sin-constructor');
    expect(await redConstruccion(deps, T)).toBe('sin-constructor');
    expect(await manejarAvisoConstruccion(deps, { tenantId: T, buildId: 'b', estado: 'SUCCESS' })).toBe('sin-constructor');
    expect(await manejarTareaConstruccion({ ...deps, db: nuevaDb(), disparador: new DisparadorDoble() }, { tenantId: T, para: 1 })).toBe('sin-constructor');
    expect(almacen.estadoDe('rec-a')).toBe('pendiente');
    expect(almacen.bloqueo).toBeNull();
  });
});

describe('disparador: tarea con nombre idempotente', () => {
  const firestoreFalso = () => {
    const creados: string[] = [];
    return { creados, doc: (ruta: string) => ({ create: (): Promise<void> => { creados.push(ruta); return Promise.resolve(); } }) };
  };
  it('encola además del prog-*, con nombre por tenant y para', async () => {
    const f = firestoreFalso();
    const tareas: unknown[] = [];
    const d = crearDisparadorSitio(f as never, () => 0, { encolar: (t) => { tareas.push(t); return Promise.resolve(); } });
    await d.programar('t-1', 1234);
    expect(f.creados).toEqual(['tenants/t-1/reconstrucciones/prog-1234']);
    expect(tareas).toEqual([{ nombre: 'sitio-t-1-1234', tenantId: 't-1', para: 1234 }]);
    expect(nombreTareaSitio('a.b', 1)).toBe('sitio-a_b-1');
  });
  it('sin cola solo escribe prog-*; si encolar falla, programar no falla', async () => {
    const f = firestoreFalso();
    await crearDisparadorSitio(f as never, () => 0).programar('t', 1);
    expect(f.creados).toHaveLength(1);
    const g = firestoreFalso();
    await expect(crearDisparadorSitio(g as never, () => 0, { encolar: () => Promise.reject(new Error('x')) }).programar('t', 2)).resolves.toBeUndefined();
    expect(g.creados).toHaveLength(1);
  });
});

describe('tarea temprana', () => {
  it('llega 5 s antes de la hora: crea el trabajo y lanza; llega antes: espera sin lanzar', async () => {
    const { almacen, reloj, constructor, deps } = montar();
    const db = nuevaDb();
    const ruta = `tenants/${T}/publicado/estado`;
    const para = reloj.ms + 60_000;
    db.poner(ruta, { version: 3, reconstruccion: { programadaPara: para, primerCambioEnMs: reloj.ms, ultima: null } });
    // El disparador de prueba deja el trabajo en el almacén, como el real en Firestore.
    const disparador = { programar: () => Promise.resolve(), reconstruir: (_t: string, version: number) => { almacen.poner('rec-publicacion', 'pendiente', reloj.ms, { version }); return Promise.resolve(); } };
    const tareaDeps = { ...deps, db, disparador };

    reloj.ms = para - 5_001; // más de la tolerancia
    expect(await manejarTareaConstruccion(tareaDeps, { tenantId: T, para })).toBe('temprana');
    expect(constructor.lanzados).toEqual([]);

    reloj.ms = para - 5_000;
    expect(await manejarTareaConstruccion(tareaDeps, { tenantId: T, para })).toBe('lanzado');
    expect(constructor.lanzados).toEqual(['rec-publicacion']);
    expect(almacen.bloqueo).toMatchObject({ trabajoId: 'rec-publicacion', buildId: 'b1', desdeMs: reloj.ms, imagen: 'img@sha256:aaa' });
  });
});

describe('publicación durante una construcción', () => {
  it('queda pendiente, no se pierde, y sale apenas termina la anterior', async () => {
    const { almacen, reloj, constructor, deps } = montar();
    almacen.poner('rec-1', 'pendiente', reloj.ms);
    expect(await lanzarSiguiente(deps, T)).toBe('lanzado');
    almacen.poner('rec-1', 'en_curso', reloj.ms); // el script tomó el trabajo
    reloj.ms += 30_000;
    almacen.poner('rec-2', 'pendiente', reloj.ms);
    expect(await lanzarSiguiente(deps, T)).toBe('esperar');
    expect(constructor.lanzados).toEqual(['rec-1']);
    expect(almacen.estadoDe('rec-2')).toBe('pendiente');

    reloj.ms += 60_000;
    expect(await manejarAvisoConstruccion(deps, { tenantId: T, buildId: 'b1', estado: 'SUCCESS' })).toBe('completado');
    expect(almacen.estadoDe('rec-1')).toBe('completada');
    // rec-2 se pidió después del inicio de la construcción: no se completa, se lanza.
    expect(almacen.estadoDe('rec-2')).toBe('pendiente');
    expect(constructor.lanzados).toEqual(['rec-1', 'rec-2']);
    expect(almacen.bloqueo).toMatchObject({ trabajoId: 'rec-2', buildId: 'b2' });
    expect(almacen.ultimaImagen).toBe('img@sha256:aaa');
  });
  it('un aviso de otro build (duplicado o viejo) se ignora', async () => {
    const { almacen, reloj, deps } = montar();
    almacen.poner('rec-1', 'pendiente', reloj.ms);
    await lanzarSiguiente(deps, T);
    expect(await manejarAvisoConstruccion(deps, { tenantId: T, buildId: 'otro', estado: 'FAILURE' })).toBe('ignorado');
    expect(await manejarAvisoConstruccion(deps, { tenantId: T, buildId: 'b1', estado: 'WORKING' })).toBe('ignorado');
    expect(almacen.bloqueo?.trabajoId).toBe('rec-1');
  });
});

describe('éxito: completa los pendientes anteriores al inicio', () => {
  it('solo los de solicitadaEnMs menor que el inicio de la construcción', async () => {
    const { almacen, reloj, constructor, deps } = montar();
    almacen.poner('rec-a', 'pendiente', reloj.ms - 20_000);
    almacen.poner('rec-b', 'pendiente', reloj.ms - 10_000);
    await lanzarSiguiente(deps, T); // lanza rec-a
    almacen.poner('rec-a', 'en_curso', reloj.ms - 20_000);
    reloj.ms += 30_000;
    almacen.poner('rec-c', 'pendiente', reloj.ms - 5_000); // posterior al inicio
    await manejarAvisoConstruccion(deps, { tenantId: T, buildId: 'b1', estado: 'SUCCESS' });
    expect(almacen.estadoDe('rec-a')).toBe('completada');
    expect(almacen.estadoDe('rec-b')).toBe('completada');
    expect(almacen.estadoDe('rec-c')).toBe('pendiente');
    expect(constructor.lanzados).toEqual(['rec-a', 'rec-c']);
  });
});

describe('falla y reintento único', () => {
  it('TIMEOUT: marca fallida, encola un reintento y lo lanza; si el reintento falla de nuevo no se repite', async () => {
    const { almacen, reloj, constructor, deps } = montar();
    almacen.poner('rec-1', 'pendiente', reloj.ms, { version: 7 });
    await lanzarSiguiente(deps, T);
    almacen.poner('rec-1', 'en_curso', reloj.ms, { version: 7 });
    reloj.ms += 5 * MIN;
    await manejarAvisoConstruccion(deps, { tenantId: T, buildId: 'b1', estado: 'TIMEOUT' });
    expect(almacen.estadoDe('rec-1')).toBe('fallida');
    expect(almacen.trabajos.get('rec-reintento-rec-1')).toMatchObject({ estado: 'pendiente', motivo: 'reintento', version: 7 });
    expect(constructor.lanzados).toEqual(['rec-1', 'rec-reintento-rec-1']);

    almacen.poner('rec-reintento-rec-1', 'en_curso', reloj.ms, { version: 7, motivo: 'reintento' });
    await manejarAvisoConstruccion(deps, { tenantId: T, buildId: 'b2', estado: 'INTERNAL_ERROR' });
    expect(almacen.estadoDe('rec-reintento-rec-1')).toBe('fallida');
    expect([...almacen.trabajos.keys()]).toEqual(['rec-1', 'rec-reintento-rec-1']); // sin un segundo reintento
    expect(almacen.bloqueo).toBeNull();
  });
  it('EXPIRED (no arrancó en queueTtl) alerta y reintenta una sola vez, como TIMEOUT; CANCELLED no reintenta', async () => {
    const alertar = vi.fn();
    const { almacen, reloj, constructor, deps } = montar({ alertar });
    almacen.poner('rec-1', 'pendiente', reloj.ms, { version: 3 });
    await lanzarSiguiente(deps, T);
    reloj.ms += 2 * MIN;
    await manejarAvisoConstruccion(deps, { tenantId: T, buildId: 'b1', estado: 'EXPIRED' });
    expect(almacen.estadoDe('rec-1')).toBe('fallida');
    expect(alertar).toHaveBeenCalledWith({ tenantId: T, trabajoId: 'rec-1', minutos: 2 });
    expect(constructor.lanzados).toEqual(['rec-1', 'rec-reintento-rec-1']);
    await manejarAvisoConstruccion(deps, { tenantId: T, buildId: 'b2', estado: 'EXPIRED' });
    expect([...almacen.trabajos.keys()]).toEqual(['rec-1', 'rec-reintento-rec-1']);
    const c = montar();
    c.almacen.poner('rec-9', 'pendiente', c.reloj.ms);
    await lanzarSiguiente(c.deps, T);
    await manejarAvisoConstruccion(c.deps, { tenantId: T, buildId: 'b1', estado: 'CANCELLED' });
    expect(c.almacen.trabajos.size).toBe(1);
  });
  it('FAILURE (p. ej. certificación fallida) no se reintenta, y libera el bloqueo', async () => {
    const { almacen, reloj, constructor, deps } = montar();
    almacen.poner('rec-1', 'pendiente', reloj.ms);
    await lanzarSiguiente(deps, T);
    almacen.poner('rec-1', 'en_curso', reloj.ms);
    await manejarAvisoConstruccion(deps, { tenantId: T, buildId: 'b1', estado: 'FAILURE' });
    expect(almacen.estadoDe('rec-1')).toBe('fallida');
    expect(almacen.trabajos.size).toBe(1);
    expect(almacen.bloqueo).toBeNull();
    expect(almacen.ultimaImagen).toBeUndefined(); // solo un éxito fija la imagen
    expect(constructor.lanzados).toEqual(['rec-1']);
  });
  it('si lanzar falla, el bloqueo se libera, el trabajo sigue pendiente y el error sube', async () => {
    const { almacen, reloj, constructor, deps } = montar();
    almacen.poner('rec-1', 'pendiente', reloj.ms);
    constructor.falla = true;
    await expect(lanzarSiguiente(deps, T)).rejects.toThrow('sin cuota');
    expect(almacen.bloqueo).toBeNull();
    expect(almacen.estadoDe('rec-1')).toBe('pendiente');
  });
});

describe('bloqueo vencido', () => {
  it('con más de 12 min se da por muerto: su trabajo pasa a fallida y se relanza el pendiente', async () => {
    const { almacen, reloj, constructor, deps } = montar();
    almacen.poner('rec-1', 'pendiente', reloj.ms);
    await lanzarSiguiente(deps, T);
    almacen.poner('rec-1', 'en_curso', reloj.ms);
    reloj.ms += 12 * MIN;
    almacen.poner('rec-2', 'pendiente', reloj.ms);
    expect(await lanzarSiguiente(deps, T)).toBe('esperar'); // justo en el límite todavía espera
    reloj.ms += 1;
    expect(await lanzarSiguiente(deps, T)).toBe('relanzado');
    expect(almacen.estadoDe('rec-1')).toBe('fallida');
    expect(constructor.lanzados).toEqual(['rec-1', 'rec-2']);
    expect(almacen.bloqueo).toMatchObject({ trabajoId: 'rec-2', buildId: 'b2' });
  });
  it('vencido y sin pendientes: libera el bloqueo', async () => {
    const { almacen, reloj, deps } = montar();
    almacen.poner('rec-1', 'pendiente', reloj.ms);
    await lanzarSiguiente(deps, T);
    almacen.poner('rec-1', 'en_curso', reloj.ms);
    reloj.ms += 13 * MIN;
    expect(await lanzarSiguiente(deps, T)).toBe('nada');
    expect(almacen.bloqueo).toBeNull();
    expect(almacen.estadoDe('rec-1')).toBe('fallida');
  });
});

describe('temporizador de red', () => {
  it('relanza un pendiente sin construcción', async () => {
    const { almacen, reloj, constructor, deps } = montar();
    almacen.poner('rec-1', 'pendiente', reloj.ms);
    expect(await redConstruccion(deps, T)).toBe('lanzado');
    expect(constructor.lanzados).toEqual(['rec-1']);
  });
  it('si cambió la imagen respecto de ultimaImagen encola un trabajo con motivo `codigo` (una sola vez) y lo lanza', async () => {
    const { almacen, constructor, deps } = montar({ imagenActual: 'img@sha256:bbb' });
    almacen.ultimaImagen = 'img@sha256:aaa';
    expect(await redConstruccion(deps, T)).toBe('lanzado');
    const id = [...almacen.trabajos.keys()][0] as string;
    expect(id).toBe('rec-codigo-bbb');
    expect(almacen.trabajos.get(id)).toMatchObject({ motivo: 'codigo', version: 5 });
    expect(constructor.lanzados).toEqual([id]);
    await redConstruccion(deps, T);
    expect(almacen.trabajos.size).toBe(1);
  });
  it('sin ultimaImagen (primera vez) o sin nada publicado no encola `codigo`', async () => {
    const a = montar({ imagenActual: 'img@sha256:bbb' });
    expect(await redConstruccion(a.deps, T)).toBe('nada');
    const b = montar({ imagenActual: 'img@sha256:bbb' });
    b.almacen.ultimaImagen = 'img@sha256:aaa';
    b.almacen.version = undefined;
    expect(await redConstruccion(b.deps, T)).toBe('nada');
    expect(b.almacen.trabajos.size).toBe(0);
  });
  it('alerta `sitio` si un trabajo lleva más de 10 minutos', async () => {
    const alertar = vi.fn();
    const { almacen, reloj, deps } = montar({ alertar });
    almacen.poner('rec-1', 'en_curso', reloj.ms - 10 * MIN);
    almacen.bloqueo = { buildId: 'b1', trabajoId: 'rec-1', desdeMs: reloj.ms - 1 * MIN, imagen: '' };
    await redConstruccion(deps, T);
    expect(alertar).not.toHaveBeenCalled();
    reloj.ms += 1;
    await redConstruccion(deps, T);
    expect(alertar).toHaveBeenCalledWith({ tenantId: T, trabajoId: 'rec-1', minutos: 10 });
  });
});
