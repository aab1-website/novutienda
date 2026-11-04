import { describe, expect, it } from 'vitest';
import { IDS_PLANTILLA } from '../contenido/tipos.js';
import { contraste, hexARgb, luminancia } from './contraste.js';
import { cssPlantillas } from './css.js';
import { esIdPlantilla, PLANTILLAS, verificarPlantilla } from './plantillas.js';

describe('contraste WCAG', () => {
  it('valores de referencia', () => {
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contraste('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(luminancia('#000000')).toBe(0);
    expect(hexARgb('#0077b3')).toEqual([0, 119, 179]);
    expect(() => hexARgb('rojo')).toThrow(RangeError);
  });
  it('el acento aprobado #0077b3 cumple AA sobre blanco', () => {
    expect(contraste('#0077b3', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(PLANTILLAS.cielo.claro.acento).toBe('#0077b3');
  });
});

describe('plantillas de color', () => {
  it('son exactamente 5, una lista cerrada', () => {
    expect(IDS_PLANTILLA).toHaveLength(5);
    expect(Object.keys(PLANTILLAS).sort()).toEqual([...IDS_PLANTILLA].sort());
    expect(esIdPlantilla('cielo')).toBe(true);
    expect(esIdPlantilla('rosa')).toBe(false);
  });

  it.each(IDS_PLANTILLA)('%s cumple AA en claro y oscuro (texto, acento, botones, errores) y 3:1 en controles', (id) => {
    expect(verificarPlantilla(PLANTILLAS[id])).toEqual([]);
  });

  it('detecta un par que no cumple', () => {
    const mala = { ...PLANTILLAS.cielo, claro: { ...PLANTILLAS.cielo.claro, textoSuave: '#bbbbbb' } };
    const fallos = verificarPlantilla(mala);
    expect(fallos.length).toBeGreaterThan(0);
    expect(fallos[0]).toMatchObject({ plantilla: 'cielo', tema: 'claro' });
  });

  it('todos los colores son hexadecimales de 6 dígitos', () => {
    for (const p of Object.values(PLANTILLAS)) {
      for (const tema of [p.claro, p.oscuro]) for (const v of Object.values(tema)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('la hoja de estilos cubre las 5 plantillas, sigue al dispositivo y admite forzar el tema', () => {
    const css = cssPlantillas();
    for (const id of IDS_PLANTILLA) {
      expect(css).toContain(`html[data-plantilla="${id}"]{`);
      expect(css).toContain(`html[data-plantilla="${id}"][data-tema="oscuro"]`);
    }
    expect(css).toContain('@media (prefers-color-scheme:dark)');
    expect(css).not.toContain('url(');
  });
});
