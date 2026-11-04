import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cargarContenido } from './cargar.js';
import { contenidoEjemplo } from './ejemplo.js';

describe('cargarContenido', () => {
  it('sin configuración carga el ejemplo en staging y en desarrollo', () => {
    expect(cargarContenido(undefined, 'staging').config.esEjemplo).toBe(true);
    expect(cargarContenido('', undefined).config.esEjemplo).toBe(true);
  });

  it('el build de producción FALLA con el contenido de ejemplo, venga por defecto o por archivo', () => {
    expect(() => cargarContenido(undefined, 'production')).toThrow(/ejemplo/);
    const dir = mkdtempSync(join(tmpdir(), 'sitio-'));
    try {
      const archivo = join(dir, 'ejemplo.json');
      writeFileSync(archivo, JSON.stringify(contenidoEjemplo));
      expect(() => cargarContenido(archivo, 'production')).toThrow(/ejemplo/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('el build de producción acepta contenido publicado (esEjemplo: false) con su propio redondeo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sitio-'));
    try {
      const archivo = join(dir, 'publicado.json');
      const redondeo = { BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' }, ARS: { tipo: 'multiplo', multiplo: 100, modo: 'cercano' } };
      writeFileSync(archivo, JSON.stringify({ ...contenidoEjemplo, config: { ...contenidoEjemplo.config, esEjemplo: false, redondeo } }));
      const c = cargarContenido(archivo, 'production');
      expect(c.config.esEjemplo).toBe(false);
      expect(c.config.redondeo).toEqual(redondeo);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
