import { describe, expect, it } from 'vitest';
import { LIMITES_PANEL } from '../../api/tipos.js';
import { validarArchivo } from './validar-archivo.js';

const archivo = (name: string, type: string, size = 1000): File => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const dura = (s: number | undefined) => (): Promise<number | undefined> => Promise.resolve(s);

describe('validarArchivo', () => {
  it('acepta una foto y un video válidos', async () => {
    expect(await validarArchivo(archivo('a.jpg', 'image/jpeg'), 'foto')).toBeUndefined();
    expect(await validarArchivo(archivo('v.mp4', 'video/mp4'), 'video', dura(30))).toBeUndefined();
  });
  it('acepta por extensión cuando el navegador no informa el tipo', async () => {
    expect(await validarArchivo(archivo('v.mov', ''), 'video', dura(10))).toBeUndefined();
  });
  it('acepta HEIC, M4V y un MIME genérico por su extensión; rechaza AVIF', async () => {
    expect(await validarArchivo(archivo('f.heic', 'image/heic'), 'foto')).toBeUndefined();
    expect(await validarArchivo(archivo('f.HEIC', ''), 'foto')).toBeUndefined();
    expect(await validarArchivo(archivo('v.m4v', 'video/x-m4v'), 'video', dura(5))).toBeUndefined();
    expect(await validarArchivo(archivo('v.m4v', 'application/octet-stream'), 'video', dura(5))).toBeUndefined();
    expect(await validarArchivo(archivo('f.avif', 'image/avif'), 'foto')).toMatch(/JPG, PNG, WebP o HEIC/);
    expect(await validarArchivo(archivo('f.avif', 'application/octet-stream'), 'foto')).toMatch(/JPG, PNG/);
  });
  it('el mensaje de duración redondea hacia arriba', async () => {
    expect(await validarArchivo(archivo('v.mp4', 'video/mp4'), 'video', dura(60.4))).toMatch(/dura 61 segundos/);
  });
  it('rechaza un tipo no permitido y dice los formatos', async () => {
    expect(await validarArchivo(archivo('a.gif', 'image/gif'), 'foto')).toMatch(/JPG, PNG, WebP o HEIC/);
    expect(await validarArchivo(archivo('v.avi', 'video/x-msvideo'), 'video', dura(1))).toMatch(/MP4, MOV o WebM/);
  });
  it('rechaza por tamaño con el límite', async () => {
    expect(await validarArchivo(archivo('a.jpg', 'image/jpeg', LIMITES_PANEL.bytesFoto + 1), 'foto')).toMatch(/máximo es 15/);
    expect(await validarArchivo(archivo('v.mp4', 'video/mp4', LIMITES_PANEL.bytesVideo + 1), 'video', dura(1))).toMatch(/máximo es 200/);
  });
  it('rechaza un video de más de 60 s sin subir, y deja decidir al servidor si no se puede leer la duración', async () => {
    expect(await validarArchivo(archivo('v.mp4', 'video/mp4'), 'video', dura(61))).toMatch(/dura 61 segundos.*60 segundos/);
    expect(await validarArchivo(archivo('v.mp4', 'video/mp4'), 'video', dura(undefined))).toBeUndefined();
  });
});
