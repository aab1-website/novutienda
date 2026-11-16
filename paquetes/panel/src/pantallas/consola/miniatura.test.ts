import { describe, expect, it } from 'vitest';
import type { Medio, VersionMedio } from '../../api/tipos.js';
import { rutaSegura, urlMiniatura } from './miniatura.js';

const BASE = 'https://medios.ejemplo.test';
const v = (clase: VersionMedio['clase'], lado: number, formato: VersionMedio['formato'], ruta: string, bytes = lado * 10): VersionMedio => ({ clase, lado, formato, ruta, bytes });
const medio = (tipo: Medio['tipo'], versiones?: readonly VersionMedio[]): Medio => ({ id: 'm1', productoId: 'p1', tipo, bytesOriginal: 1, ancho: 10, alto: 10, creadoEn: 0, por: 'u', ...(versiones !== undefined ? { versiones } : {}) });

describe('urlMiniatura', () => {
  it('elige la WebP más chica de una foto', () => {
    const m = medio('foto', [v('imagen', 960, 'webp', 'a/960.webp'), v('imagen', 480, 'avif', 'a/480.avif'), v('imagen', 480, 'webp', 'a/480.webp'), v('imagen', 240, 'avif', 'a/240.avif')]);
    expect(urlMiniatura(BASE, m)).toBe(`${BASE}/a/480.webp`);
  });
  it('en un video usa el póster más chico, no el mp4', () => {
    const m = medio('video', [v('video', 720, 'mp4', 'a/v.mp4'), v('poster', 960, 'webp', 'a/p960.webp'), v('poster', 480, 'webp', 'a/p480.webp')]);
    expect(urlMiniatura(BASE, m)).toBe(`${BASE}/a/p480.webp`);
  });
  it('tolera una barra final en la base', () => {
    expect(urlMiniatura(`${BASE}/`, medio('foto', [v('imagen', 480, 'webp', 'a.webp')]))).toBe(`${BASE}/a.webp`);
  });
  it('sin base, sin versiones o sin WebP devuelve null', () => {
    const m = medio('foto', [v('imagen', 480, 'webp', 'a.webp')]);
    expect(urlMiniatura('', m)).toBeNull();
    expect(urlMiniatura(undefined, m)).toBeNull();
    expect(urlMiniatura(BASE, medio('foto'))).toBeNull();
    expect(urlMiniatura(BASE, medio('foto', []))).toBeNull();
    expect(urlMiniatura(BASE, medio('foto', [v('imagen', 480, 'avif', 'a.avif')]))).toBeNull();
    expect(urlMiniatura(BASE, medio('video', [v('video', 720, 'mp4', 'a.mp4')]))).toBeNull();
  });
  it.each(['/abs/a.webp', 'https://malo.test/a.webp', 'javascript:alert(1)', 'data:image/webp;base64,AA', 'a/../b.webp', '../b.webp', 'a//b.webp', 'a\\b.webp', 'a.webp?x=1', 'a.webp#x', '', '%2e%2e/x.webp', 'a%2fb.webp', 'a b/x.webp', 'a/b c.webp', 'a%20b.webp', './x.webp', 'a/./x.webp', 'a/', 'a/b.webp/'])('rechaza la ruta %j', (ruta) => {
    expect(rutaSegura(ruta)).toBe(false);
    expect(urlMiniatura(BASE, medio('foto', [v('imagen', 480, 'webp', ruta)]))).toBeNull();
  });
  it('acepta una ruta con hash de contenido', () => {
    expect(rutaSegura('t/p/m-480-3fa9c1.webp')).toBe(true);
    // Forma real del servidor: tenants/<t>/publico/medios/<producto>/<hash32>-<clase><lado>.<formato>
    expect(rutaSegura('tenants/t-1/publico/medios/tv-55/0123456789abcdef0123456789abcdef-imagen480.webp')).toBe(true);
  });
});
