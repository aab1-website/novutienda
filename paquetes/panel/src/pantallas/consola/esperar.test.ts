import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../../api/errores.js';
import type { ClienteApi } from '../../api/cliente.js';
import type { Medio, ResultadoEstadoSubida } from '../../api/tipos.js';
import { ESPERA_INICIAL_MS, ESPERA_TOPE_MS, RESPALDO_TRAS_MS, esperarSubida, mensajeDeSubida } from './esperar.js';

const MEDIO: Medio = { id: 'sub-12345678', productoId: 'tv-55', tipo: 'foto', bytesOriginal: 10, ancho: 1, alto: 1, creadoEn: 0, por: 'u' };

/** Reloj simulado: `esperar` solo lo adelanta. */
function reloj(): { esperas: number[]; opciones: { esperar(ms: number): Promise<void>; ahora(): number } } {
  let t = 0;
  const esperas: number[] = [];
  return { esperas, opciones: { esperar: (ms) => { esperas.push(ms); t += ms; return Promise.resolve(); }, ahora: () => t } };
}

function cliente(estados: (n: number) => ResultadoEstadoSubida | ErrorApi, medio: Medio | ErrorApi = MEDIO): { api: ClienteApi; llamadas: string[] } {
  const llamadas: string[] = [];
  let n = 0;
  const api = {
    llamar: (nombre: string) => {
      llamadas.push(nombre);
      if (nombre === 'finalizarSubida') return medio instanceof ErrorApi ? Promise.reject(medio) : Promise.resolve(medio);
      const r = estados((n += 1));
      return r instanceof ErrorApi ? Promise.reject(r) : Promise.resolve(r);
    },
  } as unknown as ClienteApi;
  return { api, llamadas };
}

describe('esperarSubida', () => {
  it('consulta con retroceso creciente (con tope) hasta que el disparador la procesa y no llama a finalizarSubida', async () => {
    const { api, llamadas } = cliente((n) => (n <= 9 ? { estado: 'reservada' } : { estado: 'procesada', medio: MEDIO }));
    const r = reloj();
    expect(await esperarSubida(api, 'sub-12345678', r.opciones)).toEqual(MEDIO);
    expect(r.esperas).toEqual([200, 300, 450, 675, 1013, 1520, 2280, 3420, 5000]);
    expect(r.esperas[0]).toBe(ESPERA_INICIAL_MS);
    expect(Math.max(...r.esperas)).toBeLessThanOrEqual(ESPERA_TOPE_MS);
    expect(llamadas.filter((x) => x === 'finalizarSubida')).toHaveLength(0);
    expect(llamadas).toHaveLength(10);
  });
  it('una subida rechazada lanza el error del procesamiento sin forzar nada', async () => {
    const { api, llamadas } = cliente((n) => (n < 2 ? { estado: 'reservada' } : { estado: 'rechazada', motivo: 'no es una imagen' }));
    await expect(esperarSubida(api, 'sub-12345678', reloj().opciones)).rejects.toMatchObject({ codigoHttps: 'failed-precondition', detalle: { codigo: 'procesamiento' } });
    expect(llamadas).not.toContain('finalizarSubida');
  });
  it('si tras 30 s el disparador no resolvió la subida, llama una sola vez a finalizarSubida como respaldo', async () => {
    const { api, llamadas } = cliente(() => ({ estado: 'reservada' }));
    const r = reloj();
    expect(await esperarSubida(api, 'sub-12345678', r.opciones)).toEqual(MEDIO);
    expect(r.esperas.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(RESPALDO_TRAS_MS);
    expect(llamadas.filter((x) => x === 'finalizarSubida')).toHaveLength(1);
    expect(llamadas.at(-1)).toBe('finalizarSubida');
  });
  it('el error del respaldo sube tal cual', async () => {
    const { api } = cliente(() => ({ estado: 'reservada' }), new ErrorApi('failed-precondition', 'x', { codigo: 'estado' }));
    await expect(esperarSubida(api, 'sub-12345678', reloj().opciones)).rejects.toMatchObject({ detalle: { codigo: 'estado' } });
  });
  it('si el respaldo responde «en curso» (otro la procesa), sigue consultando y no vuelve a llamar a finalizarSubida', async () => {
    const enCurso = new ErrorApi('failed-precondition', 'La subida se está procesando; vuelva a consultar en unos segundos', { codigo: 'estado' });
    let llamadasFinalizar = 0;
    const c = cliente(() => (llamadasFinalizar > 0 ? { estado: 'procesada', medio: MEDIO } : { estado: 'reservada' }), enCurso);
    const base = c.api.llamar.bind(c.api) as (n: string, d: unknown) => Promise<unknown>;
    (c.api as unknown as { llamar: unknown }).llamar = (n: string, d: unknown) => { if (n === 'finalizarSubida') llamadasFinalizar += 1; return base(n, d); };
    expect(await esperarSubida(c.api, 'sub-12345678', reloj().opciones)).toEqual(MEDIO);
    expect(llamadasFinalizar).toBe(1);
  });
  it('los cortes de red o de tiempo de una consulta no interrumpen la espera; los demás errores sí', async () => {
    const corte = cliente((n) => (n === 1 ? new ErrorApi('unavailable', 'x') : n === 2 ? new ErrorApi('deadline-exceeded', 'x') : { estado: 'procesada', medio: MEDIO }));
    expect(await esperarSubida(corte.api, 'sub-12345678', reloj().opciones)).toEqual(MEDIO);
    const definitivo = cliente(() => new ErrorApi('permission-denied', 'x'));
    await expect(esperarSubida(definitivo.api, 'sub-12345678', reloj().opciones)).rejects.toMatchObject({ codigoHttps: 'permission-denied' });
    expect(definitivo.llamadas).toHaveLength(1);
  });
});

describe('mensajeDeSubida', () => {
  it('muestra el motivo que guardó el servidor, sin códigos', async () => {
    const { api } = cliente(() => ({ estado: 'rechazada', motivo: 'El video dura más de 60 segundos' }));
    const e = await esperarSubida(api, MEDIO.id, reloj().opciones).catch((x: unknown) => x);
    expect(mensajeDeSubida(e)).toBe('El video dura más de 60 segundos');
  });
  it('conserva el mensaje del servidor si el servicio no está disponible y cae al genérico sin motivo', () => {
    expect(mensajeDeSubida(new ErrorApi('unavailable', 'El procesamiento de video no está disponible por ahora.', { codigo: 'no-disponible' }))).toBe('El procesamiento de video no está disponible por ahora.');
    expect(mensajeDeSubida(new ErrorApi('failed-precondition', 'Formato de video no admitido: use MP4, MOV o WebM', { codigo: 'tipo-no-permitido' }))).toBe('Formato de video no admitido: use MP4, MOV o WebM');
    expect(mensajeDeSubida(new ErrorApi('failed-precondition', '', { codigo: 'procesamiento' }))).toBe('No se pudo procesar el archivo. Pruebe con otro o vuelva a intentarlo más tarde.');
  });
});
