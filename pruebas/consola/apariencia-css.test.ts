import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const leer = (ruta: string): string => readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8');

describe('vistas previas de las plantillas (CSS)', () => {
  it('apariencia.css define cada plantilla vigente con los colores de plantillas.ts', () => {
    const a = leer('paquetes/panel/src/pantallas/consola/apariencia.css');
    const plantillas = leer('paquetes/website/src/plantillas/plantillas.ts');
    for (const [id, acento] of [['cielo', '#0077b3'], ['bosque', '#1b7a49'], ['ambar', '#a84f00'], ['grafito', '#374151'], ['ciruela', '#8f2a8a']] as const) {
      expect(a).toMatch(new RegExp(`\\.vp-${id}-claro\\{[^}]*--vp-acento:${acento}`));
      expect(a).toMatch(new RegExp(`\\.vp-${id}-oscuro\\{`));
      expect(plantillas).toContain(`acento: '${acento}'`); // procedencia: el color sigue siendo el de la plantilla
    }
    expect(a).not.toMatch(/marfil|oceano|terracota/);
  });
  it('panel.css ya no trae las reglas .vp-* de los nombres viejos (solo .vp, el contenedor)', () => {
    expect(leer('paquetes/panel/src/estilos/panel.css')).not.toMatch(/\.vp-(barra|cuerpo|titulo|boton|marfil|oceano|terracota|cielo|bosque|ambar|grafito|ciruela)/);
  });
});
