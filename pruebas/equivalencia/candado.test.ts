// Candado de la batería: las referencias no cambian en silencio. El sello guardado debe corresponder a las referencias
// actuales y CAMBIOS.md debe tener, para el sello vigente, un motivo escrito por una persona (no «PENDIENTE»).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { actualizando, CARPETA_REFERENCIAS } from './foto.js';
import { calcularSello, leerCambios, leerSello } from './sello.js';

const cambios = (): ReturnType<typeof leerCambios> => leerCambios(readFileSync(fileURLToPath(new URL('./CAMBIOS.md', import.meta.url)), 'utf8'));

describe.skipIf(actualizando())('registro de cambios de las referencias', () => {
  it('el sello guardado corresponde a las referencias actuales (nadie las editó o regeneró sin registrarlo)', () => {
    expect(leerSello(CARPETA_REFERENCIAS), 'falta referencias/SELLO').toBeDefined();
    expect(calcularSello(CARPETA_REFERENCIAS)).toBe(leerSello(CARPETA_REFERENCIAS));
  });

  it('CAMBIOS.md explica la versión vigente de las referencias', () => {
    const entradas = cambios();
    const sello = leerSello(CARPETA_REFERENCIAS);
    const ultima = entradas[entradas.length - 1];
    expect(ultima?.sello, 'la última entrada de CAMBIOS.md debe llevar el sello vigente').toBe(sello);
    expect(ultima?.motivo).not.toMatch(/PENDIENTE/);
    expect(ultima?.motivo.length ?? 0).toBeGreaterThanOrEqual(30);
  });

  it('cada sello aparece una sola vez', () => {
    const sellos = cambios().map((c) => c.sello);
    expect(new Set(sellos).size).toBe(sellos.length);
  });
});
