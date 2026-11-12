import { describe, expect, it } from 'vitest';
import { convertirDescripcion, descripcionPlana, nivelesReales, recortar, tramosDe } from './descripcion.js';

const n = (t: string) => ({ texto: t, negrita: false });
const b = (t: string) => ({ texto: t, negrita: true });

describe('convertirDescripcion', () => {
  it('títulos de nivel 2 a 4, párrafos y negrita', () => {
    expect(convertirDescripcion('## Qué incluye\nUn **gran** equipo\n\n### Detalle\n#### Menor')).toEqual([
      { tipo: 'titulo', nivel: 2, tramos: [n('Qué incluye')] },
      { tipo: 'parrafo', tramos: [n('Un '), b('gran'), n(' equipo')] },
      { tipo: 'titulo', nivel: 3, tramos: [n('Detalle')] },
      { tipo: 'titulo', nivel: 4, tramos: [n('Menor')] },
    ]);
  });

  it('listas con *, - y la forma `* - texto`', () => {
    expect(convertirDescripcion('* uno\n- dos\n* - tres\n* **cuatro**')).toEqual([
      { tipo: 'lista', items: [[n('uno')], [n('dos')], [n('tres')], [b('cuatro')]] },
    ]);
  });

  it('un <script> se conserva como texto literal y los enlaces Markdown no se convierten', () => {
    const r = convertirDescripcion('<script>alert(1)</script> [x](https://evil.invalid) <img src=x onerror=1>');
    expect(r).toEqual([{ tipo: 'parrafo', tramos: [n('<script>alert(1)</script> [x](https://evil.invalid) <img src=x onerror=1>')] }]);
  });

  it('entrada vacía o solo espacios: sin bloques', () => {
    expect(convertirDescripcion('')).toEqual([]);
    expect(convertirDescripcion('  \n\n ')).toEqual([]);
  });

  it('un texto sin marcas queda igual, con sus saltos de línea', () => {
    expect(convertirDescripcion('Línea uno.\nLínea dos.\n\nOtro párrafo.')).toEqual([
      { tipo: 'parrafo', tramos: [n('Línea uno.\nLínea dos.')] },
      { tipo: 'parrafo', tramos: [n('Otro párrafo.')] },
    ]);
  });

  it('marcas sin cierre o sin sentido quedan literales', () => {
    expect(tramosDe('a **b')).toEqual([n('a **b')]);
    expect(tramosDe('2 ** 3 ** 4')).toEqual([n('2 ** 3 ** 4')]);
    expect(convertirDescripcion('#sin-espacio\n*cursiva*')).toEqual([{ tipo: 'parrafo', tramos: [n('#sin-espacio\n*cursiva*')] }]);
  });

  it('acepta saltos de línea de Windows', () => {
    expect(convertirDescripcion('## A\r\n* x\r\n* y')).toHaveLength(2);
  });
});

describe('descripcionPlana y recortar', () => {
  it('sin marcas, con espacios colapsados', () => {
    expect(descripcionPlana('## Título\n\nTexto **fuerte**\n* - uno\n* dos')).toBe('Título Texto fuerte uno dos');
    expect(descripcionPlana('Texto sin marcas.')).toBe('Texto sin marcas.');
    expect(descripcionPlana('')).toBe('');
  });
  it('el recorte conserva el criterio anterior', () => {
    expect(recortar('a'.repeat(140), 140)).toBe('a'.repeat(140));
    expect(recortar('a'.repeat(141), 140)).toBe(`${'a'.repeat(137)}…`);
  });
});

describe('nivelesReales', () => {
  it('el menor nivel presente es la base y no se saltan niveles', () => {
    const bl = convertirDescripcion('### A\n#### B');
    expect([...nivelesReales(bl, 2)]).toEqual([[3, 2], [4, 3]]);
    expect([...nivelesReales(convertirDescripcion('## A\n#### B'), 2)]).toEqual([[2, 2], [4, 3]]);
  });

  it('título con marcas de cierre: `C#` se conserva y `## X ##` se limpia', () => {
    expect(convertirDescripcion('## Lenguaje C#')).toEqual([{ tipo: 'titulo', nivel: 2, tramos: [n('Lenguaje C#')] }]);
    expect(convertirDescripcion('## Texto ##  ')).toEqual([{ tipo: 'titulo', nivel: 2, tramos: [n('Texto')] }]);
    expect(convertirDescripcion('### ###')).toEqual([{ tipo: 'parrafo', tramos: [n('### ###')] }]);
  });

  it('`* * *` es un separador (se omite) y `+ 591…` es un párrafo, no una lista', () => {
    expect(convertirDescripcion('* uno\n* * *\n* dos')).toEqual([{ tipo: 'lista', items: [[n('uno')], [n('dos')]] }]);
    expect(convertirDescripcion('* * *')).toEqual([]);
    expect(convertirDescripcion('+ 591 70000000')).toEqual([{ tipo: 'parrafo', tramos: [n('+ 591 70000000')] }]);
  });

  it('negrita: no cruza líneas, un `**` sin cierre queda literal', () => {
    expect(tramosDe('a **b\nc** d')).toEqual([n('a **b\nc** d')]);
    expect(tramosDe('**a** y **b**')).toEqual([b('a'), n(' y '), b('b')]);
    expect(tramosDe('** a**')).toEqual([n('** a**')]);
  });

  it('tiempo lineal con líneas largas y marcas repetidas', () => {
    const entradas = [
      `# a${' '.repeat(4000)}x`,
      `# a${'\t '.repeat(2000)}x`,
      `#${' '.repeat(4000)}`,
      `## ${'# '.repeat(2000)}x`,
      `${'*'.repeat(4000)}`,
      `${'** '.repeat(1300)}`,
      `**${'a '.repeat(2000)}`,
      `${'* '.repeat(2000)}x`,
      `- ${'- '.repeat(2000)}`,
      ` ${' '.repeat(4000)}x`,
      `${'**a '.repeat(1000)}`,
    ];
    for (const e of entradas) {
      const t0 = performance.now();
      convertirDescripcion(e);
      descripcionPlana(e);
      expect(performance.now() - t0).toBeLessThan(200);
    }
  });
});
