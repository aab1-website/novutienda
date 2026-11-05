import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { registroPlataforma } from '../../plataforma/registro.js';
import { buscarTermino, extraerImportaciones, verificarFronteras, type Arbol } from './verificador.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

function leerArbol(carpeta: string): Arbol {
  const arbol: Record<string, string> = {};
  const recorrer = (dir: string): void => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const nombre = entrada.name;
      if (nombre === 'node_modules' || nombre === 'dist' || nombre === 'coverage') continue;
      const ruta = join(dir, nombre);
      if (entrada.isDirectory()) recorrer(ruta);
      else arbol[relative(RAIZ, ruta).split(sep).join('/')] = readFileSync(ruta, 'utf8');
    }
  };
  recorrer(join(RAIZ, carpeta));
  return arbol;
}

const dependencias = Object.fromEntries(registroPlataforma.listar().map((m) => [m.id, m.dependeDe]));

describe('fronteras del repositorio real', () => {
  it('no hay violaciones en paquetes/ ni tenants/', () => {
    const arbol = { ...leerArbol('paquetes'), ...leerArbol('tenants') };
    expect(verificarFronteras(arbol, dependencias)).toEqual([]);
  });

  it('cada paquete de paquetes/ está registrado en plataforma/registro.ts', () => {
    const carpetas = readdirSync(join(RAIZ, 'paquetes'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    const registrados = registroPlataforma.listar().map((m) => m.id);
    expect(carpetas.filter((c) => !registrados.includes(c))).toEqual([]);
  });

  it('no aparece «bermejo» en paquetes/', () => {
    expect(buscarTermino(leerArbol('paquetes'), 'paquetes/', 'bermejo')).toEqual([]);
  });
});

describe('verificador con árboles inventados', () => {
  const motivos = (arbol: Arbol, deps = {}) => verificarFronteras(arbol, deps).map((v) => v.importacion);

  it('un árbol inventado con todas las infracciones falla', () => {
    const arbol: Arbol = {
      'paquetes/nucleo/src/a.ts': "import { x } from '@novutienda/pos';",
      'paquetes/pos/src/b.ts': "import { y } from '@novutienda/inventarios';",
      'paquetes/pos/src/c.ts': "import { z } from '@novutienda/nucleo/src/registro/registro.js';",
      'paquetes/pos/src/d.ts': "import { w } from '../../inventarios/src/x.js';",
      'tenants/t1/e.ts': "import { v } from '@novutienda/nucleo';",
    };
    expect(motivos(arbol)).toEqual([
      '@novutienda/pos',
      '@novutienda/inventarios',
      '@novutienda/nucleo/src/registro/registro.js',
      '../../inventarios/src/x.js',
      '@novutienda/nucleo',
    ]);
  });

  it('acepta las importaciones permitidas', () => {
    const arbol: Arbol = {
      'paquetes/nucleo/src/a.ts': "import { x } from './b.js'; import fs from 'node:fs';",
      'paquetes/pos/src/b.ts': "import { y } from '@novutienda/nucleo'; import { i } from '@novutienda/inventarios';",
      'tenants/t1/e.ts': "import type { Rol } from '@novutienda/nucleo/extension';",
    };
    expect(verificarFronteras(arbol, { pos: ['inventarios'] })).toEqual([]);
  });

  it('rechaza importar un tenant y dependencias no declaradas', () => {
    const arbol: Arbol = {
      'paquetes/pos/src/a.ts': "import '@tenant/casa';\nconst m = await import('@novutienda/recibos');",
    };
    expect(motivos(arbol)).toEqual(['@tenant/casa', '@novutienda/recibos']);
  });

  it('rechaza import() con plantilla de texto y analiza la plantilla sin interpolación', () => {
    const arbol: Arbol = {
      'paquetes/pos/src/a.ts': 'const m = await import(`@novutienda/${nombre}`);',
      'paquetes/pos/src/b.ts': 'const m = await import(`@novutienda/recibos`);',
      'paquetes/pos/src/c.ts': 'const m = await import(`@novutienda/nucleo`);',
    };
    expect(motivos(arbol)).toEqual(['@novutienda/${nombre}', '@novutienda/recibos']);
  });

  it('la búsqueda de «bermejo» detecta contenido y nombres de ruta', () => {
    expect(buscarTermino({ 'paquetes/x/a.ts': 'const n = "Casa Bermejo";' }, 'paquetes/', 'bermejo')).toEqual(['paquetes/x/a.ts']);
    expect(buscarTermino({ 'paquetes/bermejo/a.ts': '' }, 'paquetes/', 'bermejo')).toEqual(['paquetes/bermejo/a.ts']);
    expect(buscarTermino({ 'tenants/casa-bermejo/a.json': 'bermejo' }, 'paquetes/', 'bermejo')).toEqual([]);
  });

  it('extrae importaciones estáticas, dinámicas y require', () => {
    expect(extraerImportaciones("import a from 'a'; export * from \"b\"; import('c'); require('d'); import 'e';")).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
