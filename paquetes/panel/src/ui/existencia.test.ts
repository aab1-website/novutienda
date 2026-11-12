// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { AvisoConteoAbierto, ExistenciaOculta, conteoVencido, fechaHoraLaPaz } from './existencia.js';

afterEach(cleanup);
const AHORA = Date.parse('2026-11-13T12:00:00Z');
const hace = (horas: number): string => new Date(AHORA - horas * 3600_000).toISOString();

describe('ExistenciaOculta', () => {
  it('dice «Oculto» (nunca 0) con la descripción accesible', () => {
    const { container } = render(h(ExistenciaOculta, null));
    expect(container.textContent).toBe('Oculto');
    expect(screen.getByLabelText('Oculto mientras hay un conteo abierto')).toBeTruthy();
  });
});

describe('fechaHoraLaPaz y conteoVencido', () => {
  it('muestra la hora de La Paz (UTC-4)', () => {
    expect(fechaHoraLaPaz('2026-11-13T02:30:00Z')).toBe('12/11/2026 22:30');
    expect(fechaHoraLaPaz('no es fecha')).toBe('no es fecha');
  });
  it('vence pasadas 24 horas, no antes, y sin fecha no vence', () => {
    expect(conteoVencido({ ubicacionId: 'tienda', conteoId: 'c', abiertoEn: hace(23) }, AHORA)).toBe(false);
    expect(conteoVencido({ ubicacionId: 'tienda', conteoId: 'c', abiertoEn: hace(24) }, AHORA)).toBe(false);
    expect(conteoVencido({ ubicacionId: 'tienda', conteoId: 'c', abiertoEn: hace(25) }, AHORA)).toBe(true);
    expect(conteoVencido({ ubicacionId: 'tienda', conteoId: 'c', abiertoEn: null }, AHORA)).toBe(false);
  });
});

describe('AvisoConteoAbierto', () => {
  it('sin conteos no muestra nada', () => {
    expect(render(h(AvisoConteoAbierto, { conteos: [] })).container.textContent).toBe('');
    expect(render(h(AvisoConteoAbierto, { conteos: undefined })).container.textContent).toBe('');
  });
  it('conteo reciente: texto con almacén y fecha, tono informativo', () => {
    const { container } = render(h(AvisoConteoAbierto, { conteos: [{ ubicacionId: 'tienda', conteoId: 'c1', abiertoEn: hace(2) }], ahoraMs: AHORA }));
    expect(container.textContent).toContain('Hay un conteo abierto en Tienda desde 13/11/2026 06:00.');
    expect(container.textContent).toContain('Las existencias se ocultan hasta que se cierre.');
    expect(container.textContent).not.toContain('más de 24 horas');
    expect(container.querySelector('.alerta-info')).not.toBeNull();
    expect(container.querySelector('.alerta-error')).toBeNull();
  });
  it('pasadas 24 horas pasa a alerta (rojo) y lo dice con texto', () => {
    const { container } = render(h(AvisoConteoAbierto, { conteos: [{ ubicacionId: 'deposito-1', conteoId: 'c1', abiertoEn: hace(30) }], ahoraMs: AHORA }));
    expect(container.textContent).toContain('Depósito 1');
    expect(container.textContent).toContain('desde hace más de 24 horas');
    expect(container.querySelector('.alerta-error')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
  it('con abiertoEn nulo no inventa fecha ni alerta', () => {
    const { container } = render(h(AvisoConteoAbierto, { conteos: [{ ubicacionId: 'tienda', conteoId: 'c1', abiertoEn: null }], ahoraMs: AHORA }));
    expect(container.textContent).toContain('Hay un conteo abierto en Tienda.');
    expect(container.textContent).not.toContain(' desde ');
    expect(container.querySelector('.alerta-error')).toBeNull();
  });
  it('varios conteos: una línea por almacén y alerta si alguno venció; admite nombres propios', () => {
    const { container } = render(h(AvisoConteoAbierto, {
      conteos: [{ ubicacionId: 'tienda', conteoId: 'a', abiertoEn: hace(1) }, { ubicacionId: 'deposito-2', conteoId: 'b', abiertoEn: hace(48) }],
      nombreAlmacen: (id) => `Almacén ${id}`, ahoraMs: AHORA,
    }));
    expect(container.querySelectorAll('.aviso-conteo-linea').length).toBe(3);
    expect(container.textContent).toContain('Almacén tienda');
    expect(container.textContent).toContain('Almacén deposito-2');
    expect(container.querySelector('.alerta-error')).not.toBeNull();
  });
});
