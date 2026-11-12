// El panel lateral (diálogo) ocupa la pantalla completa bajo 1024 px; el diálogo centrado sigue en 768 px.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../paquetes/panel/src/estilos/capas.css', import.meta.url), 'utf8');

describe('panel lateral en tablets', () => {
  it('ocupa la pantalla completa bajo 1024 px y el diálogo centrado sigue en 768 px', () => {
    const bloque = (consulta: string): string => {
      const ini = css.indexOf(consulta);
      expect(ini).toBeGreaterThanOrEqual(0);
      const fin = css.indexOf('\n}', ini);
      return css.slice(ini, fin);
    };
    const tablet = bloque('@media (max-width: 1023.98px)');
    expect(tablet).toContain('.dialogo-lateral .dialogo');
    expect(tablet).not.toContain('.dialogo-centro');
    const celular = bloque('@media (max-width: 767.98px)');
    expect(celular).toContain('.dialogo-centro .dialogo');
    expect(celular).not.toContain('.dialogo-lateral');
  });
});
