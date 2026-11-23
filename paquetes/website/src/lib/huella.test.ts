import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { contenidoEjemplo } from '../contenido/ejemplo.js';
import { unificarMarcas } from '../contenido/consultas.js';
import { huellaContenido, huellaSinDisponibilidad, jsonCanonico, versionContenido } from './huella.js';

describe('huella del contenido', () => {
  it('JSON canónico: claves ordenadas recursivamente, sin espacios, sin undefined', () => {
    expect(jsonCanonico({ b: 1, a: { d: [3, { y: 1, x: undefined }], c: 'é' } })).toBe('{"a":{"c":"é","d":[3,{"y":1}]},"b":1}');
  });
  it('no depende del orden de las claves y cambia con el contenido', () => {
    expect(huellaContenido({ a: 1, b: 2 })).toBe(huellaContenido({ b: 2, a: 1 }));
    expect(huellaContenido({ a: 1 })).not.toBe(huellaContenido({ a: 2 }));
    expect(huellaContenido({ a: 1 })).toBe(createHash('sha256').update('{"a":1}', 'utf8').digest('hex'));
  });
  it('versionContenido: conteos, huella hex y nulos sin publicación', () => {
    const v = versionContenido(contenidoEjemplo);
    expect(v).toEqual({ esquema: 2, version: null, publicadoEn: null, productos: contenidoEjemplo.productos.length, secciones: contenidoEjemplo.secciones.length, huella: expect.stringMatching(/^[0-9a-f]{64}$/), huellaSinDisponibilidad: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const con = versionContenido({ ...contenidoEjemplo, publicacion: { version: 4, publicadoEn: '2026-11-10T00:00:00.000Z' } });
    expect(con.version).toBe(4);
    expect(con.huella).not.toBe(v.huella);
  });

  it('huellaSinDisponibilidad ignora solo `disponible`; huella lo incluye', () => {
    const base = versionContenido(contenidoEjemplo);
    const cambia = (f: (p: (typeof contenidoEjemplo.productos)[number]) => (typeof contenidoEjemplo.productos)[number]) =>
      versionContenido({ ...contenidoEjemplo, productos: contenidoEjemplo.productos.map((p, i) => (i === 0 ? f(p) : p)) });
    const stock = cambia((p) => ({ ...p, disponible: !p.disponible }));
    expect(stock.huella).not.toBe(base.huella);
    expect(stock.huellaSinDisponibilidad).toBe(base.huellaSinDisponibilidad);
    const precio = cambia((p) => ({ ...p, precioUsd: { ...p.precioUsd, BO: p.precioUsd.BO + 1 } }));
    expect(precio.huella).not.toBe(base.huella);
    expect(precio.huellaSinDisponibilidad).not.toBe(base.huellaSinDisponibilidad);
  });

  it('la huella «sin disponibilidad» no cambia porque un producto esté agotado', () => {
    const base = contenidoEjemplo.productos;
    const conAgotado = { ...contenidoEjemplo, productos: base.map((p, i) => (i === 0 ? { ...p, disponible: !p.disponible } : p)) };
    expect(huellaSinDisponibilidad(conAgotado)).toBe(huellaSinDisponibilidad(contenidoEjemplo));
    expect(versionContenido(conAgotado).huellaSinDisponibilidad).toBe(versionContenido(contenidoEjemplo).huellaSinDisponibilidad);
  });

  it('unificar marcas cambia la huella: por eso /version-contenido.json se calcula sobre el contenido publicado, no el unificado', () => {
    const p = contenidoEjemplo.productos;
    const publicado = { ...contenidoEjemplo, productos: [{ ...p[0]!, marca: 'samsung' }, { ...p[1]!, marca: 'Samsung' }, ...p.slice(2)] };
    const unificado = { ...publicado, productos: unificarMarcas(publicado.productos) };
    expect(huellaSinDisponibilidad(unificado)).not.toBe(huellaSinDisponibilidad(publicado));
  });
});
