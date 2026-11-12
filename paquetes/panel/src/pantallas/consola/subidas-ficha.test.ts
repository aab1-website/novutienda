// @vitest-environment jsdom
import { h, type JSX } from 'preact';
import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi } from '../../api/errores.js';
import type { Medio } from '../../api/tipos.js';
import { crearEntorno, type Entorno } from '../../ayuda-pruebas.js';
import { cupoLibre, tipoDeArchivo, useSubidas, type Subida, type Subidas } from './subidas-ficha.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const medio = (id: string, tipo: 'foto' | 'video' = 'foto'): Medio => ({ id, productoId: 'tv-55', tipo, bytesOriginal: 1, ancho: 1, alto: 1, creadoEn: 1, por: 'u' });
const subida = (c: Partial<Subida>): Subida => ({ id: 's', nombre: 'a.jpg', tipo: 'foto', fase: 'subiendo', progreso: 0, segundos: 0, motivo: undefined, reintentable: false, reservada: false, medioId: undefined, ...c });
const jpg = (n: string): File => new File(['x'], n, { type: 'image/jpeg' });

describe('cupoLibre', () => {
  it('es el tope menos lo subido al producto menos las subidas en curso', () => {
    expect(cupoLibre('foto', [], [])).toBe(5);
    expect(cupoLibre('foto', [medio('a'), medio('b')], [])).toBe(3);
    expect(cupoLibre('foto', [medio('a'), medio('b')], [subida({ fase: 'subiendo' }), subida({ id: 't', fase: 'procesando' })])).toBe(1);
    expect(cupoLibre('video', [medio('a')], [])).toBe(1);
    expect(cupoLibre('video', [medio('v', 'video')], [])).toBe(0);
  });
  it('no cuenta dos veces lo que ya está en la lista del servidor ni lo que falló sin reserva', () => {
    expect(cupoLibre('foto', [medio('a')], [subida({ fase: 'listo', medioId: 'a' })])).toBe(4);
    expect(cupoLibre('foto', [], [subida({ fase: 'listo', medioId: 'a' })])).toBe(4);
    expect(cupoLibre('foto', [], [subida({ fase: 'error', reservada: false })])).toBe(5);
    expect(cupoLibre('foto', [], [subida({ fase: 'error', reservada: true, reintentable: false })])).toBe(5);
  });
  it('una subida que falló con la reserva puesta y se puede reintentar sigue ocupando lugar', () => {
    expect(cupoLibre('foto', [], [subida({ fase: 'error', reservada: true, reintentable: true })])).toBe(4);
  });
  it('nunca baja de cero', () => {
    expect(cupoLibre('foto', Array.from({ length: 6 }, (_, i) => medio(String(i))), [])).toBe(0);
  });
});

describe('tipoDeArchivo', () => {
  it('distingue video de foto por el tipo o la extensión', () => {
    expect(tipoDeArchivo({ name: 'a.mp4', type: 'video/mp4' })).toBe('video');
    expect(tipoDeArchivo({ name: 'a.MOV', type: '' })).toBe('video');
    expect(tipoDeArchivo({ name: 'a.jpg', type: 'image/jpeg' })).toBe('foto');
    expect(tipoDeArchivo({ name: 'a.heic', type: '' })).toBe('foto');
  });
});

/** Muestra el estado del hook y expone sus acciones. */
function Probador({ medios, alListo, salida }: { medios: readonly Medio[]; alListo: (m: Medio) => void; salida: { actual?: Subidas } }): JSX.Element {
  const s = useSubidas({ productoId: 'tv-55', medios, alListo });
  salida.actual = s;
  return h('ul', null, s.subidas.map((x) => h('li', { key: x.id }, `${x.nombre}|${x.fase}|${x.reintentable ? 'reintentable' : 'fijo'}|${x.motivo ?? ''}`)));
}
const montar = (e: Entorno, medios: readonly Medio[] = [], alListo: (m: Medio) => void = () => undefined): { actual?: Subidas } => {
  const salida: { actual?: Subidas } = {};
  render(e.envolver(h(Probador, { medios, alListo, salida })));
  return salida;
};

describe('useSubidas', () => {
  it('recorre las fases hasta «listo» y avisa con el medio', async () => {
    const e = crearEntorno('sup');
    const fases: string[] = [];
    const llamar = e.api.llamar.bind(e.api);
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, x: never) => {
      fases.push(n);
      return llamar(n as never, x);
    }) as never);
    const listos: Medio[] = [];
    const s = montar(e, [], (m) => listos.push(m));
    s.actual?.agregar([jpg('a.jpg')]);
    await waitFor(() => expect(screen.getByText('a.jpg|listo|fijo|')).toBeTruthy());
    expect(listos).toHaveLength(1);
    expect(fases.slice(0, 2)).toEqual(['reservarSubida', 'estadoSubida']);
    expect(e.almacen.subidos).toHaveLength(1);
  });
  it('un archivo inválido se rechaza al revisar, sin reservar ni reintento', async () => {
    const e = crearEntorno('sup');
    const s = montar(e);
    s.actual?.agregar([new File(['x'], 'nota.txt', { type: 'text/plain' })], 'foto');
    await waitFor(() => expect(screen.getByText(/^nota.txt\|error\|fijo\|«nota.txt» no es una foto permitido/)).toBeTruthy());
    expect(e.api.llamadas.some((l) => l.nombre === 'reservarSubida')).toBe(false);
  });
  it('el rechazo de la reserva por el servidor no se puede reintentar; el corte de red sí', async () => {
    const e = crearEntorno('sup');
    const llamar = e.api.llamar.bind(e.api);
    const errores: ErrorApi[] = [new ErrorApi('resource-exhausted', 'Máximo 5 fotos por producto', { codigo: 'limite' }), new ErrorApi('unavailable', 'sin conexión')];
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, x: never) => {
      const falla = n === 'reservarSubida' ? errores.shift() : undefined;
      return falla ? Promise.reject(falla) : llamar(n as never, x);
    }) as never);
    const s = montar(e);
    s.actual?.agregar([jpg('uno.jpg')]);
    await waitFor(() => expect(screen.getByText(/^uno.jpg\|error\|fijo\|Máximo 5 fotos por producto/)).toBeTruthy());
    s.actual?.agregar([jpg('dos.jpg')]);
    await waitFor(() => expect(screen.getByText(/^dos.jpg\|error\|reintentable\|/)).toBeTruthy());
  });
  it('reintentar repite con el mismo identificador y vuelve a empezar desde la reserva', async () => {
    const e = crearEntorno('sup');
    const original = e.almacen.subir.bind(e.almacen);
    let n = 0;
    e.almacen.subir = (ruta, a, p) => (++n === 1 ? Promise.reject(new Error('corte')) : original(ruta, a, p));
    const s = montar(e);
    s.actual?.agregar([jpg('a.jpg')]);
    await waitFor(() => expect(screen.getByText(/^a.jpg\|error\|reintentable/)).toBeTruthy());
    const id = s.actual?.subidas[0]?.id ?? '';
    s.actual?.reintentar(id);
    await waitFor(() => expect(screen.getByText('a.jpg|listo|fijo|')).toBeTruthy());
    const ids = e.api.llamadas.filter((l) => l.nombre === 'reservarSubida').map((l) => (l.entrada as { subidaId: string }).subidaId);
    expect(ids).toEqual([id, id]);
  });
  it('sube lo que cabe y dice cuántos quedaron fuera; «descartar» libera la fila', async () => {
    const e = crearEntorno('sup');
    const s = montar(e, [medio('a'), medio('b'), medio('c'), medio('d')]);
    s.actual?.agregar([jpg('1.jpg'), jpg('2.jpg'), jpg('3.jpg')]);
    await waitFor(() => expect(s.actual?.subidas).toHaveLength(1));
    expect(s.actual?.avisoCupo).toBe('Se suben 1 foto y 2 fotos quedaron fuera: el máximo es 5 fotos por producto.');
    await waitFor(() => expect(screen.getByText('1.jpg|listo|fijo|')).toBeTruthy());
    s.actual?.descartar(s.actual.subidas[0]?.id ?? '');
    await waitFor(() => expect(s.actual?.subidas).toHaveLength(0));
  });
});
