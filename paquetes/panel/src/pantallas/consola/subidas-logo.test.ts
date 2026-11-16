import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../../api/errores.js';
import { BYTES_LOGO } from '../../api/tipos.js';
import { crearEntorno } from '../../ayuda-pruebas.js';
import { esperarSubidaLogo, validarLogo } from './subidas-logo.js';

const a = (name: string, type: string, size = 10): { name: string; type: string; size: number } => ({ name, type, size });

describe('validarLogo', () => {
  it('admite JPG, PNG y WebP', () => {
    expect(validarLogo(a('a.jpg', 'image/jpeg'))).toBeUndefined();
    expect(validarLogo(a('a.PNG', 'image/png'))).toBeUndefined();
    expect(validarLogo(a('a.webp', 'image/webp'))).toBeUndefined();
    expect(validarLogo(a('a.png', ''))).toBeUndefined();
  });
  it('rechaza SVG, otros tipos y un MIME que no coincide, con el motivo', () => {
    expect(validarLogo(a('a.svg', 'image/svg+xml'))).toMatch(/SVG/);
    expect(validarLogo(a('a.svg', ''))).toMatch(/SVG/);
    expect(validarLogo(a('a.gif', 'image/gif'))).toMatch(/JPG, PNG o WebP/);
    expect(validarLogo(a('a.heic', 'image/heic'))).toMatch(/formato permitido/);
    expect(validarLogo(a('a.pdf', 'application/pdf'))).toMatch(/formato permitido/);
  });
  it('rechaza vacío y lo que pasa de 2 MB, y acepta justo el tope', () => {
    expect(validarLogo(a('a.png', 'image/png', 0))).toMatch(/vacío/);
    expect(validarLogo(a('a.png', 'image/png', BYTES_LOGO + 1))).toMatch(/pesa .* y el máximo es 2/);
    expect(validarLogo(a('a.png', 'image/png', BYTES_LOGO))).toBeUndefined();
  });
});

describe('esperarSubidaLogo', () => {
  const sinPausa = { esperar: (): Promise<void> => Promise.resolve() };
  it('devuelve el medio cuando el disparador procesó el original', async () => {
    const e = crearEntorno('adm');
    const r = await e.api.llamar('reservarSubidaLogo', { subidaId: crypto.randomUUID(), bytes: 10 });
    await e.almacen.subir(r.rutaOriginal, new Blob(['x']), () => undefined);
    const m = await esperarSubidaLogo(e.api, r.subidaId, sinPausa);
    expect(m.tipo).toBe('logo');
  });
  it('lanza el motivo si el servidor rechaza el archivo', async () => {
    const e = crearEntorno('adm');
    e.api.estado.disparador.rechazo = 'No es una imagen';
    const r = await e.api.llamar('reservarSubidaLogo', { subidaId: crypto.randomUUID(), bytes: 10 });
    await e.almacen.subir(r.rutaOriginal, new Blob(['x']), () => undefined);
    await expect(esperarSubidaLogo(e.api, r.subidaId, sinPausa)).rejects.toThrow(ErrorApi);
  });
  it('si el disparador está caído, tras el respaldo finaliza una vez', async () => {
    const e = crearEntorno('adm');
    e.api.estado.disparador.demoraMs = Infinity;
    const r = await e.api.llamar('reservarSubidaLogo', { subidaId: crypto.randomUUID(), bytes: 10 });
    await e.almacen.subir(r.rutaOriginal, new Blob(['x']), () => undefined);
    let t = 0;
    const m = await esperarSubidaLogo(e.api, r.subidaId, { esperar: () => Promise.resolve(), ahora: () => (t += 20_000) });
    expect(m.id).toBe(r.subidaId);
    expect(e.api.llamadas.filter((l) => l.nombre === 'finalizarSubidaLogo')).toHaveLength(1);
  });
});
