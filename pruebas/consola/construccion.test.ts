// Construcción inmediata del sitio (DR-CB, P3): ventana de 60 s, tarea temprana, bloqueo por sitio, aviso de `cloud-builds`,
// reintento único y temporizador de red. Todo con puertos en memoria; sin constructor (modo `github`) no hay efecto.
import { describe, expect, it, vi } from 'vitest';
import { decidirBloqueo, decidirReconstruccion, ejecutarReconstruccion, LIMITES_CONSOLA, type ConstructorSitio } from '@novutienda/consola';
import {
  almacenConstruccionFirestore, lanzarSiguiente, manejarAvisoConstruccion, manejarTareaConstruccion, redConstruccion, type AlmacenConstruccion, type BloqueoSitio,
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
  readonly causas = new Map<string, string>();
  contador: { dia: string; n: number; alertado?: boolean } | undefined;
  /** Número de transacción (1 = la primera) que falla, para simular un error al guardar el `buildId`. */
  fallarTransaccionN: number | undefined;
  private transacciones = 0;

  poner(id: string, estado: string, solicitadaEnMs: number, extra: Partial<TrabajoSitio> = {}): void {
    this.trabajos.set(id, { id, estado, solicitadaEnMs, version: 1, ...extra });
  }
  estadoDe(id: string): string | undefined {
    return this.trabajos.get(id)?.estado;
  }
  async transaccion<R>(_t: string, fn: (tx: TxConstruccion) => Promise<R>): Promise<R> {
    this.transacciones += 1;
    if (this.transacciones === this.fallarTransaccionN) throw new Error('escritura fallida');
    const escrituras: (() => void)[] = [];
    const tx: TxConstruccion = {
      estado: () => Promise.resolve({ bloqueo: this.bloqueo, ...(this.contador === undefined ? {} : { contador: this.contador }), ...(this.ultimaImagen === undefined ? {} : { ultimaImagen: this.ultimaImagen }) }),
      pendientes: () => Promise.resolve([...this.trabajos.values()].filter((j) => j.estado === 'pendiente').sort((a, b) => a.solicitadaEnMs - b.solicitadaEnMs)),
      trabajo: (id) => Promise.resolve(this.trabajos.get(id)),
      fijarBloqueo: (b, u) => escrituras.push(() => { this.bloqueo = b; this.ultimaImagen = u; }),
      liberar: (u) => escrituras.push(() => { this.bloqueo = null; this.ultimaImagen = u; }),
      fijarContador: (c) => escrituras.push(() => { this.contador = c; }),
      marcar: (id, estado, _a, causa) => escrituras.push(() => { const j = this.trabajos.get(id); if (j) this.trabajos.set(id, { ...j, estado }); if (causa !== undefined) this.causas.set(id, causa); }),
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
    almacen.poner('rec-1', 'completada', 0); // el script cerró su trabajo
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
    almacen.poner('rec-a', 'completada', 0); // el script cerró su trabajo
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
    expect(alertar).toHaveBeenCalledWith({ tenantId: T, trabajoId: 'rec-1', estado: 'EXPIRED', minutos: 2 });
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

describe('SUCCESS sin despliegue (el script salió con código 10)', () => {
  it('con el trabajo propio aún pendiente (o fallida): no completa pendientes, no reintenta, libera y lanza el siguiente', async () => {
    for (const estadoPropio of ['pendiente', 'fallida']) {
      const { almacen, reloj, constructor, deps } = montar();
      almacen.poner('rec-1', 'pendiente', reloj.ms - 20_000);
      almacen.poner('rec-0', 'pendiente', reloj.ms - 30_000);
      await lanzarSiguiente(deps, T); // lanza rec-0, el más antiguo
      almacen.poner('rec-0', estadoPropio, reloj.ms - 30_000);
      reloj.ms += 1_000;
      expect(await manejarAvisoConstruccion(deps, { tenantId: T, buildId: 'b1', estado: 'SUCCESS' })).toBe('sin-desplegar');
      expect(almacen.estadoDe('rec-0')).toBe(estadoPropio);
      expect(almacen.estadoDe('rec-1')).not.toBe('completada');
      expect([...almacen.trabajos.keys()].some((k) => k.startsWith('rec-reintento'))).toBe(false);
      expect(almacen.ultimaImagen).toBeUndefined();
      expect(constructor.lanzados).toHaveLength(2); // el siguiente pendiente sale
      expect(almacen.bloqueo).not.toBeNull();
    }
  });
});

describe('bloqueo vencido', () => {
  it('con más de 12 min el trabajo atascado se cierra fallida (bloqueo_vencido), se alerta y se encola un reintento; el pendiente sale primero', async () => {
    const alertar = vi.fn();
    const { almacen, reloj, constructor, deps } = montar({ alertar });
    almacen.poner('rec-1', 'pendiente', reloj.ms, { version: 4 });
    await lanzarSiguiente(deps, T);
    almacen.poner('rec-1', 'en_curso', reloj.ms, { version: 4 });
    reloj.ms += 12 * MIN;
    almacen.poner('rec-2', 'pendiente', reloj.ms);
    expect(await lanzarSiguiente(deps, T)).toBe('esperar'); // justo en el límite todavía espera
    reloj.ms += 1;
    expect(await lanzarSiguiente(deps, T)).toBe('relanzado');
    expect(almacen.estadoDe('rec-1')).toBe('fallida');
    expect(almacen.causas.get('rec-1')).toBe('bloqueo_vencido');
    expect(alertar).toHaveBeenCalledWith({ tenantId: T, trabajoId: 'rec-1', estado: 'bloqueo_vencido', minutos: 12 });
    expect(almacen.trabajos.get('rec-reintento-rec-1')).toMatchObject({ estado: 'pendiente', motivo: 'reintento', version: 4 });
    expect(constructor.lanzados).toEqual(['rec-1', 'rec-2']); // nunca se relanza el mismo trabajo
    expect(almacen.bloqueo).toMatchObject({ trabajoId: 'rec-2', buildId: 'b2' });
  });
  it('vencido y sin otros pendientes: lanza el reintento nuevo, no el mismo trabajo', async () => {
    const { almacen, reloj, constructor, deps } = montar();
    almacen.poner('rec-1', 'pendiente', reloj.ms);
    await lanzarSiguiente(deps, T);
    almacen.poner('rec-1', 'en_curso', reloj.ms);
    reloj.ms += 13 * MIN;
    expect(await lanzarSiguiente(deps, T)).toBe('lanzado');
    expect(almacen.estadoDe('rec-1')).toBe('fallida');
    expect(constructor.lanzados).toEqual(['rec-1', 'rec-reintento-rec-1']);
    expect(almacen.bloqueo).toMatchObject({ trabajoId: 'rec-reintento-rec-1' });
  });
  it('un reintento que también queda atascado no genera otro (una sola vez por trabajo original)', async () => {
    const { almacen, reloj, constructor, deps } = montar();
    almacen.poner('rec-1', 'pendiente', reloj.ms);
    await lanzarSiguiente(deps, T);
    almacen.poner('rec-1', 'en_curso', reloj.ms);
    reloj.ms += 13 * MIN;
    await lanzarSiguiente(deps, T); // lanza rec-reintento-rec-1
    almacen.poner('rec-reintento-rec-1', 'en_curso', reloj.ms, { motivo: 'reintento' });
    reloj.ms += 13 * MIN;
    expect(await lanzarSiguiente(deps, T)).toBe('nada');
    expect(almacen.estadoDe('rec-reintento-rec-1')).toBe('fallida');
    expect([...almacen.trabajos.keys()]).toEqual(['rec-1', 'rec-reintento-rec-1']);
    expect(almacen.bloqueo).toBeNull();
    expect(constructor.lanzados).toHaveLength(2);
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

describe('SUCCESS con el trabajo propio aún en_curso (lo tiene otro corredor)', () => {
  it('mantiene el bloqueo y no lanza la siguiente: sin doble construcción ni vuelta atrás del sitio', async () => {
    const { almacen, reloj, constructor, deps } = montar();
    almacen.poner('rec-0', 'pendiente', reloj.ms - 30_000);
    almacen.poner('rec-1', 'pendiente', reloj.ms - 20_000);
    await lanzarSiguiente(deps, T); // build b1 para rec-0
    almacen.poner('rec-0', 'en_curso', reloj.ms - 30_000); // el script respondió `repetido`: otro corredor lo tiene
    reloj.ms += 1_000;
    expect(await manejarAvisoConstruccion(deps, { tenantId: T, buildId: 'b1', estado: 'SUCCESS' })).toBe('en-curso');
    // Sin el arreglo se liberaba y salía rec-1 mientras el corredor viejo seguía desplegando: dos construcciones a la vez, y la
    // más vieja, al terminar última, deshacía lo publicado.
    expect(constructor.lanzados).toEqual(['rec-0']);
    expect(almacen.bloqueo).toMatchObject({ trabajoId: 'rec-0', buildId: 'b1' });
    expect(almacen.estadoDe('rec-1')).toBe('pendiente');
    expect(await lanzarSiguiente(deps, T)).toBe('esperar');
    // Si el trabajo nunca se cierra, el bloqueo vence a los 12 min: se cierra fallida y sale el reintento y el pendiente.
    reloj.ms += 12 * MIN;
    expect(await lanzarSiguiente(deps, T)).toBe('relanzado');
    expect(almacen.estadoDe('rec-0')).toBe('fallida');
  });
});

describe('D7: alerta ante cualquier estado terminal distinto de SUCCESS', () => {
  it.each(['FAILURE', 'INTERNAL_ERROR', 'TIMEOUT', 'CANCELLED', 'EXPIRED'])('%s alerta `sitio`', async (estado) => {
    const alertar = vi.fn();
    const { almacen, reloj, deps } = montar({ alertar });
    almacen.poner('rec-1', 'pendiente', reloj.ms);
    await lanzarSiguiente(deps, T);
    await manejarAvisoConstruccion(deps, { tenantId: T, buildId: 'b1', estado });
    expect(alertar).toHaveBeenCalledWith({ tenantId: T, trabajoId: 'rec-1', estado, minutos: 0 });
  });
  it('SUCCESS no alerta', async () => {
    const alertar = vi.fn();
    const { almacen, reloj, deps } = montar({ alertar });
    almacen.poner('rec-1', 'pendiente', reloj.ms);
    await lanzarSiguiente(deps, T);
    almacen.poner('rec-1', 'completada', reloj.ms);
    await manejarAvisoConstruccion(deps, { tenantId: T, buildId: 'b1', estado: 'SUCCESS' });
    expect(alertar).not.toHaveBeenCalled();
  });
});

describe('tope duro de 60 construcciones por sitio y día de La Paz', () => {
  /** Hace `n` construcciones fallidas (cada una libera el bloqueo) con trabajos nuevos. */
  const construir = async (m: ReturnType<typeof montar>, desde: number, hasta: number): Promise<void> => {
    for (let i = desde; i <= hasta; i += 1) {
      m.almacen.poner(`rec-${String(i)}`, 'pendiente', m.reloj.ms);
      await lanzarSiguiente(m.deps, T);
      await manejarAvisoConstruccion(m.deps, { tenantId: T, buildId: `b${String(i)}`, estado: 'CANCELLED' });
      m.almacen.trabajos.clear();
    }
  };
  it('la 60 se lanza, la 61 no (queda pendiente, una sola alerta con construccionesDia) y la primera del día siguiente sí', async () => {
    const alertar = vi.fn();
    const m = montar({ alertar });
    await construir(m, 1, 59);
    m.almacen.poner('rec-60', 'pendiente', m.reloj.ms);
    expect(await lanzarSiguiente(m.deps, T)).toBe('lanzado'); // la 60
    await manejarAvisoConstruccion(m.deps, { tenantId: T, buildId: 'b60', estado: 'CANCELLED' });
    m.almacen.trabajos.clear();
    expect(m.constructor.lanzados).toHaveLength(60);
    alertar.mockClear();
    m.almacen.poner('rec-61', 'pendiente', m.reloj.ms);
    expect(await lanzarSiguiente(m.deps, T)).toBe('tope-diario');
    expect(await lanzarSiguiente(m.deps, T)).toBe('tope-diario');
    expect(m.constructor.lanzados).toHaveLength(60); // no se lanza
    expect(m.almacen.estadoDe('rec-61')).toBe('pendiente'); // no se pierde
    expect(m.almacen.bloqueo).toBeNull();
    const exceso = alertar.mock.calls.map((c) => c[0] as { construccionesDia?: number }).filter((x) => x.construccionesDia !== undefined);
    expect(exceso).toEqual([{ tenantId: T, trabajoId: 'rec-61', construccionesDia: 60 }]); // una sola vez por día
    m.reloj.ms += 24 * 60 * MIN; // el día siguiente
    expect(await lanzarSiguiente(m.deps, T)).toBe('lanzado');
    expect(m.constructor.lanzados.at(-1)).toBe('rec-61');
    expect(m.almacen.contador).toMatchObject({ n: 1 });
  });
  it('si lanzar() falla, la construcción no cuenta: una racha de fallas no agota el tope', async () => {
    const m = montar();
    m.constructor.falla = true;
    for (let i = 1; i <= 70; i += 1) {
      m.almacen.poner('rec-1', 'pendiente', m.reloj.ms);
      await expect(lanzarSiguiente(m.deps, T)).rejects.toThrow('sin cuota');
    }
    expect(m.almacen.contador?.n).toBe(0);
    m.constructor.falla = false;
    expect(await lanzarSiguiente(m.deps, T)).toBe('lanzado'); // sigue habiendo cupo
    expect(m.almacen.contador?.n).toBe(1);
  });
  it('el tope también rige en modo delegar: no encola', async () => {
    const encolar = vi.fn(() => Promise.resolve());
    const almacen = new AlmacenDoble();
    const reloj = new RelojFijo();
    almacen.contador = { dia: '2026-11-04', n: 60 }; // RelojFijo: 4/11/2026 12:00 UTC = 08:00 en La Paz
    almacen.poner('rec-1', 'pendiente', reloj.ms);
    const deps: DepsConstruccion = { almacen, reloj, encolarLanzamiento: encolar, alertar: vi.fn() };
    expect(await redConstruccion(deps, T)).toBe('tope-diario');
    expect(encolar).not.toHaveBeenCalled();
    expect(almacen.estadoDe('rec-1')).toBe('pendiente');
  });
  it('el tope libera un bloqueo cerrado, sin lanzar', async () => {
    const m = montar();
    m.almacen.contador = { dia: '2026-11-04', n: 60, alertado: true };
    m.almacen.poner('rec-0', 'completada', 0);
    m.almacen.bloqueo = { buildId: 'b0', trabajoId: 'rec-0', desdeMs: m.reloj.ms - 1_000, imagen: 'img@sha256:aaa' };
    m.almacen.poner('rec-1', 'pendiente', m.reloj.ms);
    expect(await lanzarSiguiente(m.deps, T)).toBe('tope-diario');
    expect(m.almacen.bloqueo).toBeNull();
  });
});

describe('modo delegar (el temporizador no crea builds)', () => {
  it('encola el trabajo sin tomar el bloqueo ni llamar al constructor; los errores de encolar suben', async () => {
    const encolar = vi.fn(() => Promise.resolve());
    const almacen = new AlmacenDoble();
    const reloj = new RelojFijo();
    const deps: DepsConstruccion = { almacen, reloj, encolarLanzamiento: encolar };
    almacen.poner('rec-1', 'pendiente', reloj.ms);
    expect(await redConstruccion(deps, T)).toBe('encolado');
    expect(encolar).toHaveBeenCalledWith(T, 'rec-1');
    expect(almacen.bloqueo).toBeNull();
    expect(almacen.contador).toBeUndefined();
    await expect(lanzarSiguiente({ ...deps, encolarLanzamiento: () => Promise.reject(new Error('cola caída')) }, T)).rejects.toThrow('cola caída');
  });
  it('con un bloqueo vivo espera; con uno vencido cierra el atascado, crea el reintento y lo encola', async () => {
    const encolar = vi.fn(() => Promise.resolve());
    const almacen = new AlmacenDoble();
    const reloj = new RelojFijo();
    const deps: DepsConstruccion = { almacen, reloj, encolarLanzamiento: encolar, alertar: vi.fn() };
    almacen.poner('rec-1', 'en_curso', reloj.ms);
    almacen.bloqueo = { buildId: 'b1', trabajoId: 'rec-1', desdeMs: reloj.ms, imagen: '' };
    expect(await lanzarSiguiente(deps, T)).toBe('esperar');
    reloj.ms += 13 * MIN;
    expect(await lanzarSiguiente(deps, T)).toBe('encolado');
    expect(encolar).toHaveBeenCalledWith(T, 'rec-reintento-rec-1');
    expect(almacen.bloqueo).toBeNull();
    expect(almacen.estadoDe('rec-1')).toBe('fallida');
  });
});

/** Firestore mínimo en memoria: lo justo para `almacenConstruccionFirestore` (doc, colección con where/limit, transacción). */
function firestoreEnMemoria() {
  const docs = new Map<string, Record<string, unknown>>();
  const ref = (ruta: string) => ({ ruta });
  const consulta = (col: string, campo?: string, valor?: unknown, tope?: number) => ({
    col, campo, valor, tope,
    where: (c: string, _o: string, v: unknown) => consulta(col, c, v, tope),
    limit: (n: number) => consulta(col, campo, valor, n),
    get: () => Promise.resolve(resolverConsulta(consulta(col, campo, valor, tope))),
  });
  function resolverConsulta(q: { col: string; campo?: string | undefined; valor?: unknown; tope?: number | undefined }) {
    const todos = [...docs].filter(([r, d]) => r.startsWith(`${q.col}/`) && !r.slice(q.col.length + 1).includes('/') && (q.campo === undefined || d[q.campo] === q.valor));
    const lista = q.tope === undefined ? todos : todos.slice(0, q.tope);
    return { docs: lista.map(([r, d]) => ({ id: r.split('/').pop() as string, data: () => d })) };
  }
  const leer = (x: { ruta?: string; get?: unknown }) => {
    if ('ruta' in x && x.ruta !== undefined) { const d = docs.get(x.ruta); return { exists: d !== undefined, data: () => d }; }
    return resolverConsulta(x as never);
  };
  const firestore = {
    doc: (ruta: string) => ({ ...ref(ruta), get: () => Promise.resolve(leer(ref(ruta))), create: (d: Record<string, unknown>) => { docs.set(ruta, d); return Promise.resolve(); } }),
    collection: (col: string) => consulta(col),
    runTransaction: <R>(fn: (tx: unknown) => Promise<R>) => fn({
      get: (x: never) => Promise.resolve(leer(x)),
      set: (r: { ruta: string }, d: Record<string, unknown>) => { docs.set(r.ruta, d); },
      update: (r: { ruta: string }, d: Record<string, unknown>) => { docs.set(r.ruta, { ...docs.get(r.ruta), ...d }); },
    }),
  };
  return { docs, firestore };
}

describe('almacenConstruccionFirestore.pendientes', () => {
  it('no pierde el trabajo más antiguo aunque haya más de 50 pendientes, y los devuelve ordenados', async () => {
    const { docs, firestore } = firestoreEnMemoria();
    // El más antiguo se inserta el último: con un `limit(50)` quedaba fuera.
    for (let i = 1; i <= 60; i += 1) docs.set(`tenants/${T}/reconstrucciones/rec-${String(i)}`, { estado: 'pendiente', solicitadaEnMs: 1_000 + i });
    docs.set(`tenants/${T}/reconstrucciones/rec-viejo`, { estado: 'pendiente', solicitadaEnMs: 5 });
    const almacen = almacenConstruccionFirestore(firestore as never);
    const p = await almacen.transaccion(T, (tx) => tx.pendientes());
    expect(p).toHaveLength(61);
    expect(p[0]?.id).toBe('rec-viejo');
    expect(p.map((x) => x.solicitadaEnMs)).toEqual([...p.map((x) => x.solicitadaEnMs)].sort((a, b) => a - b));
  });
  it('el contador diario se guarda aparte y no pisa el bloqueo', async () => {
    const { docs, firestore } = firestoreEnMemoria();
    const almacen = almacenConstruccionFirestore(firestore as never);
    await almacen.transaccion(T, async (tx) => {
      await tx.estado();
      tx.fijarBloqueo({ buildId: '', trabajoId: 'rec-1', desdeMs: 1, imagen: 'i' }, undefined);
      tx.fijarContador({ dia: '2026-11-21', n: 3 });
    });
    const e = await almacen.transaccion(T, (tx) => tx.estado());
    expect(e.bloqueo?.trabajoId).toBe('rec-1');
    expect(e.contador).toEqual({ dia: '2026-11-21', n: 3 });
    expect(docs.has(`tenants/${T}/sitio/construcciones`)).toBe(true);
  });
});

describe('buildId que no se pudo guardar', () => {
  it('el build ya existe: se conserva el bloqueo, se alerta y no sale un segundo build', async () => {
    const alertar = vi.fn();
    const { almacen, reloj, constructor, deps } = montar({ alertar });
    almacen.poner('rec-1', 'pendiente', reloj.ms);
    almacen.fallarTransaccionN = 2; // la 1.ª toma el bloqueo; la 2.ª guarda el buildId
    expect(await lanzarSiguiente(deps, T)).toBe('lanzado');
    expect(constructor.lanzados).toEqual(['rec-1']);
    expect(almacen.bloqueo).toMatchObject({ trabajoId: 'rec-1', buildId: '' });
    expect(alertar).toHaveBeenCalledWith({ tenantId: T, trabajoId: 'rec-1', estado: 'build_id_no_guardado' });
    almacen.poner('rec-2', 'pendiente', reloj.ms);
    expect(await lanzarSiguiente(deps, T)).toBe('esperar'); // el reintento de la tarea no lanza otro build
    expect(constructor.lanzados).toEqual(['rec-1']);
  });
  it('si falla `lanzar()` sí se libera el bloqueo', async () => {
    const { almacen, reloj, constructor, deps } = montar();
    almacen.poner('rec-1', 'pendiente', reloj.ms);
    constructor.falla = true;
    await expect(lanzarSiguiente(deps, T)).rejects.toThrow();
    expect(almacen.bloqueo).toBeNull();
  });
});

describe('trabajo cerrado `completada` con el bloqueo aún puesto', () => {
  it('sin aviso de Cloud Build: se libera en cuanto se detecta, cubre los pendientes anteriores y lanza el posterior', async () => {
    const { almacen, reloj, constructor, deps } = montar();
    almacen.poner('rec-0', 'pendiente', reloj.ms - 20_000);
    almacen.poner('rec-a', 'pendiente', reloj.ms - 10_000);
    await lanzarSiguiente(deps, T); // build b1 para rec-0, desdeMs = ahora
    reloj.ms += 30_000;
    almacen.poner('rec-0', 'completada', 0);
    almacen.poner('rec-b', 'pendiente', reloj.ms); // pedido después del inicio del build
    expect(await lanzarSiguiente(deps, T)).toBe('lanzado'); // el bloqueo (30 s) no vencía: lo libera el cierre del trabajo
    expect(almacen.estadoDe('rec-a')).toBe('completada');
    expect(almacen.estadoDe('rec-b')).toBe('pendiente');
    expect(constructor.lanzados).toEqual(['rec-0', 'rec-b']);
    expect(almacen.ultimaImagen).toBe('img@sha256:aaa');
  });
  it('sin pendientes posteriores: solo libera y fija ultimaImagen', async () => {
    const { almacen, reloj, constructor, deps } = montar();
    almacen.poner('rec-0', 'pendiente', reloj.ms - 20_000);
    almacen.poner('rec-a', 'pendiente', reloj.ms - 10_000);
    await lanzarSiguiente(deps, T);
    almacen.poner('rec-0', 'completada', 0);
    expect(await lanzarSiguiente(deps, T)).toBe('nada');
    expect(almacen.estadoDe('rec-a')).toBe('completada');
    expect(almacen.bloqueo).toBeNull();
    expect(almacen.ultimaImagen).toBe('img@sha256:aaa');
    expect(constructor.lanzados).toEqual(['rec-0']);
  });
  it('con el bloqueo vencido y el trabajo completada: cubre los pendientes anteriores en vez de reconstruir, y no reintenta', async () => {
    const { almacen, reloj, constructor, deps } = montar();
    almacen.poner('rec-0', 'pendiente', reloj.ms - 20_000);
    almacen.poner('rec-a', 'pendiente', reloj.ms - 10_000);
    await lanzarSiguiente(deps, T);
    reloj.ms += 13 * MIN;
    almacen.poner('rec-0', 'completada', 0);
    expect(await lanzarSiguiente(deps, T)).toBe('nada');
    expect(almacen.estadoDe('rec-a')).toBe('completada');
    expect([...almacen.trabajos.keys()].some((k) => k.startsWith('rec-reintento'))).toBe(false);
    expect(constructor.lanzados).toEqual(['rec-0']);
  });
  it('un trabajo en_curso sigue bloqueando', async () => {
    const { almacen, reloj, constructor, deps } = montar();
    almacen.poner('rec-0', 'pendiente', reloj.ms);
    await lanzarSiguiente(deps, T);
    almacen.poner('rec-0', 'en_curso', reloj.ms);
    almacen.poner('rec-1', 'pendiente', reloj.ms);
    expect(await lanzarSiguiente(deps, T)).toBe('esperar');
    expect(constructor.lanzados).toEqual(['rec-0']);
  });
});
