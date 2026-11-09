import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { registroPlataforma } from '../../plataforma/registro.js';
import { buscarTermino, extraerImportaciones, verificarFronteras, type Arbol } from './verificador.js';
import {
  CARPETAS_CON_ZONA, archivosSinZona, claveDeCruce, crucesDeZona, importacionesDe, permitido, zonaDe, zonaDeImportacion,
} from './zonas.js';

interface EntradaDeuda {
  readonly archivo: string;
  readonly importacion: string;
  readonly zona: string;
  readonly destino: string;
  readonly resuelveEn: string;
  readonly nota?: string;
}
// Se lee con fs y no con `import ... with { type: 'json' }` para no tocar pruebas/tsconfig.json (fuera de la zona de método).
const deuda = JSON.parse(readFileSync(fileURLToPath(new URL('./deuda.json', import.meta.url)), 'utf8')) as { readonly cruces: readonly EntradaDeuda[] };

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

// El alta del primer administrador no pasa por actor autorizado: solo puede alcanzarlo el operador (scripts) y el núcleo, nunca un callable ni el sitio.
describe('asignarPrimerAdministrador solo lo referencian el núcleo, el operador, scripts y pruebas', () => {
  const PERMITIDOS = ['paquetes/nucleo/', 'plataforma/operador/', 'scripts/', 'pruebas/'];
  const arbol: Arbol = Object.assign({}, ...['paquetes', 'plataforma', 'scripts', 'tenants', 'pruebas'].map((c) => leerArbol(c)));
  const referencia = /\basignarPrimerAdministrador\b/;

  it('no aparece fuera de las rutas permitidas (llamadas del servidor, panel, sitio)', () => {
    const fuera = Object.entries(arbol)
      .filter(([ruta, codigo]) => referencia.test(codigo) && !PERMITIDOS.some((p) => ruta.startsWith(p)))
      .map(([ruta]) => ruta);
    expect(fuera).toEqual([]);
  });

  it('la regla detecta una referencia en un callable del servidor o en el panel', () => {
    const inventado = { 'plataforma/funciones/servidor/llamadas/x.ts': 'asignarPrimerAdministrador(d)', 'paquetes/panel/src/x.ts': 'asignarPrimerAdministrador' };
    const fuera = Object.entries(inventado).filter(([ruta, c]) => referencia.test(c) && !PERMITIDOS.some((p) => ruta.startsWith(p)));
    expect(fuera).toHaveLength(2);
  });
});

// Frontera por zona declarada (plano §3, enmienda H0): cubre plataforma/, pruebas/, scripts/ y el panel por pieza.
describe('zonas del repositorio real', () => {
  const arbol: Arbol = Object.assign({}, ...CARPETAS_CON_ZONA.map((c) => leerArbol(c)));
  const cruces = crucesDeZona(arbol, dependencias);
  const enDeuda = new Map(deuda.cruces.map((d) => [claveDeCruce(d), d]));

  it('ningún archivo de código está sin zona', () => {
    expect(archivosSinZona(Object.keys(arbol))).toEqual([]);
  });

  it('todo cruce de importación entre zonas está en deuda.json (la deuda no sube)', () => {
    const nuevos = cruces.filter((c) => !enDeuda.has(claveDeCruce(c)));
    expect(nuevos.map((c) => `${claveDeCruce(c)} [${c.motivo}]`)).toEqual([]);
  });

  it('ninguna entrada de deuda.json sigue cuando su cruce ya no existe (la deuda solo baja)', () => {
    const vigentes = new Set(cruces.map(claveDeCruce));
    expect([...enDeuda.keys()].filter((k) => !vigentes.has(k))).toEqual([]);
  });

  it('cada entrada de deuda.json declara la zona real del archivo y la del destino', () => {
    const existe = (r: string): boolean => r in arbol;
    for (const d of deuda.cruces) {
      expect(zonaDe(d.archivo), d.archivo).toBe(d.zona);
      expect(zonaDeImportacion(d.archivo, d.importacion, existe)?.zona, claveDeCruce(d)).toBe(d.destino);
    }
  });

  it('el extractor de importaciones de zonas.ts coincide con el del verificador', () => {
    const muestra = "import a from 'a'; export * from \"b\"; import('c'); require('d'); import 'e'; import type { T } from './t.js';";
    expect(importacionesDe(muestra)).toEqual(extraerImportaciones(muestra));
  });
});

describe('reglas de zona con árboles inventados', () => {
  const sinDeps = {};
  const pkg = (zona: string) => ({ zona, relativa: false });
  const rel = (zona: string) => ({ zona, relativa: true });

  it('asigna la zona por ruta, con módulo y prueba', () => {
    expect(zonaDe('paquetes/nucleo/src/index.ts')).toBe('nucleo');
    expect(zonaDe('paquetes/pos/src/venta.ts')).toBe('modulo:pos');
    expect(zonaDe('paquetes/panel/src/ui/app.tsx')).toBe('central');
    expect(zonaDe('paquetes/panel/src/pantallas/pos/venta-cobro.tsx')).toBe('modulo:pos');
    expect(zonaDe('paquetes/panel/src/pantallas/pos/venta.test.ts')).toBe('pruebas:modulo:pos');
    expect(zonaDe('paquetes/panel/src/doble/doble.test.ts')).toBe('pruebas:central');
    expect(zonaDe('paquetes/panel/src/doble/arranque.tsx')).toBe('pruebas:central');
    expect(zonaDe('paquetes/panel/src/montar.tsx')).toBe('central');
    expect(zonaDe('plataforma/funciones/servidor/llamadas/recibos.ts')).toBe('modulo:recibos');
    expect(zonaDe('plataforma/funciones/servidor/http/sitio.ts')).toBe('conector:sitio');
    expect(zonaDe('plataforma/conectores/firebase/auth.ts')).toBe('conector:firebase');
    expect(zonaDe('plataforma/funciones/servidor/redondeo.ts')).toBe('nucleo');
    expect(zonaDe('pruebas/inventarios/pedido.test.ts')).toBe('pruebas:modulo:inventarios');
    expect(zonaDe('pruebas/reglas/matriz.ts')).toBe('pruebas:nucleo');
    expect(zonaDe('scripts/build.mjs')).toBe('plataforma');
    expect(zonaDe('tenants/t1/extension.ts')).toBe('tenant');
    expect(zonaDe('pruebas/fronteras/zonas.ts')).toBe('metodo');
    expect(zonaDe('otra-carpeta/x.ts')).toBeUndefined();
  });

  it('señala los archivos de código sin zona y deja pasar lo que no es código', () => {
    expect(archivosSinZona(['plataforma/nuevo/x.ts', 'plataforma/README.md', 'docs/a.ts', 'paquetes/pos/src/a.ts'])).toEqual(['plataforma/nuevo/x.ts']);
  });

  it('núcleo solo importa núcleo; central importa núcleo y coordinador, no módulos', () => {
    expect(permitido('nucleo', pkg('nucleo'), 'paquetes/nucleo/src/a.ts', sinDeps)).toBe(true);
    expect(permitido('nucleo', pkg('modulo:pos'), 'paquetes/nucleo/src/a.ts', sinDeps)).toBe(false);
    expect(permitido('central', pkg('nucleo'), 'paquetes/panel/src/a.ts', sinDeps)).toBe(true);
    expect(permitido('central', rel('coordinador'), 'paquetes/panel/src/a.ts', sinDeps)).toBe(true);
    expect(permitido('central', rel('modulo:pos'), 'paquetes/panel/src/ui/login.tsx', sinDeps)).toBe(false);
    expect(permitido('central', rel('modulo:pos'), 'paquetes/panel/src/ui/app.tsx', sinDeps)).toBe(true); // compositor
  });

  it('el coordinador importa paquetes de módulo solo desde compositores, y bordes de módulo siempre', () => {
    const marco = 'plataforma/funciones/servidor/llamadas/marco.ts';
    expect(permitido('coordinador', pkg('modulo:pos'), marco, sinDeps)).toBe(false);
    expect(permitido('coordinador', rel('modulo:pos'), 'plataforma/funciones/servidor/index.ts', sinDeps)).toBe(true);
    expect(permitido('coordinador', pkg('modulo:pos'), 'plataforma/funciones/servidor/entorno.ts', sinDeps)).toBe(true);
    expect(permitido('coordinador', pkg('modulo:pos'), 'plataforma/coordinador/inventarios-pos.ts', sinDeps)).toBe(true);
    expect(permitido('coordinador', rel('conector:firebase'), marco, sinDeps)).toBe(true);
    expect(permitido('coordinador', pkg('nucleo'), marco, sinDeps)).toBe(true);
  });

  it('un borde de módulo importa su módulo, núcleo, central, coordinador, firebase y lo que declare', () => {
    const borde = 'plataforma/funciones/servidor/llamadas/pos.ts';
    expect(permitido('modulo:pos', pkg('modulo:pos'), borde, sinDeps)).toBe(true);
    expect(permitido('modulo:pos', rel('coordinador'), borde, sinDeps)).toBe(true);
    expect(permitido('modulo:pos', rel('conector:firebase'), borde, sinDeps)).toBe(true);
    expect(permitido('modulo:pos', pkg('modulo:inventarios'), borde, sinDeps)).toBe(false);
    expect(permitido('modulo:pos', pkg('modulo:inventarios'), borde, { pos: ['inventarios'] })).toBe(true);
    expect(permitido('modulo:pos', rel('conector:novuchat'), borde, sinDeps)).toBe(false);
  });

  it('un conector importa núcleo, coordinador y solo las zonas a las que sirve', () => {
    const nc = 'plataforma/funciones/servidor/http/novuchat.ts';
    expect(permitido('conector:novuchat', pkg('modulo:inventarios'), nc, sinDeps)).toBe(true);
    expect(permitido('conector:novuchat', pkg('modulo:website'), nc, sinDeps)).toBe(false);
    expect(permitido('conector:novuchat', rel('coordinador'), nc, sinDeps)).toBe(true);
    expect(permitido('conector:firebase', pkg('modulo:website'), 'plataforma/conectores/firebase/x.ts', sinDeps)).toBe(true);
    expect(permitido('conector:firebase', rel('conector:sitio'), 'plataforma/conectores/firebase/x.ts', sinDeps)).toBe(false);
  });

  it('las pruebas importan su zona, dobles, plataforma y coordinador; las del coordinador y central, módulos', () => {
    expect(permitido('pruebas:modulo:pos', pkg('modulo:pos'), 'pruebas/pos/a.test.ts', sinDeps)).toBe(true);
    expect(permitido('pruebas:modulo:pos', rel('pruebas:coordinador'), 'pruebas/pos/a.test.ts', sinDeps)).toBe(true);
    expect(permitido('pruebas:modulo:pos', pkg('modulo:recibos'), 'pruebas/pos/a.test.ts', sinDeps)).toBe(false);
    expect(permitido('pruebas:nucleo', rel('plataforma'), 'pruebas/reglas/a.test.ts', sinDeps)).toBe(true);
    expect(permitido('pruebas:nucleo', pkg('modulo:pos'), 'pruebas/limites/a.test.ts', sinDeps)).toBe(false);
    expect(permitido('pruebas:coordinador', pkg('modulo:pos'), 'pruebas/integracion/a.test.ts', sinDeps)).toBe(true);
    expect(permitido('pruebas:central', rel('modulo:pos'), 'pruebas/panel/a.test.ts', sinDeps)).toBe(true);
  });

  it('nadie importa un tenant; un tenant solo importa núcleo', () => {
    expect(permitido('coordinador', pkg('tenant'), 'plataforma/registro.ts', sinDeps)).toBe(false);
    expect(permitido('tenant', pkg('nucleo'), 'tenants/t1/e.ts', sinDeps)).toBe(true);
    expect(permitido('tenant', pkg('modulo:pos'), 'tenants/t1/e.ts', sinDeps)).toBe(false);
  });

  it('resuelve importaciones relativas .js → .ts/.tsx e index, e ignora lo externo', () => {
    const arbol: Arbol = {
      'plataforma/funciones/servidor/llamadas/marco.ts': "import type { ActorPos } from '@novutienda/pos'; import { x } from '../redondeo.js'; import y from './estilos.css'; import z from 'zod';",
      'plataforma/funciones/servidor/redondeo.ts': '',
      'paquetes/panel/src/ui/login.tsx': "import { P } from '../pantallas/pos/venta.js'; import { C } from './comun.js';",
      'paquetes/panel/src/pantallas/pos/venta.tsx': '',
      'paquetes/panel/src/ui/comun.tsx': '',
    };
    expect(crucesDeZona(arbol).map(claveDeCruce)).toEqual([
      'paquetes/panel/src/ui/login.tsx → ../pantallas/pos/venta.js',
      'plataforma/funciones/servidor/llamadas/marco.ts → @novutienda/pos',
    ]);
  });

  it('la entrada pública de la interfaz de un módulo en el panel (@novutienda/panel/<m>) es de ese módulo', () => {
    const nunca = (): boolean => false;
    expect(zonaDeImportacion('pruebas/panel/a.test.ts', '@novutienda/panel/consola', nunca)).toEqual({ zona: 'modulo:consola', relativa: false });
    expect(zonaDeImportacion('pruebas/panel/a.test.ts', '@novutienda/panel', nunca)).toEqual({ zona: 'central', relativa: false });
    expect(zonaDeImportacion('plataforma/registro.ts', '@novutienda/panel/manifiesto', nunca)).toEqual({ zona: 'central', relativa: false });
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

  it('/servidor del núcleo: permitido a módulos de servidor, prohibido al panel (navegador)', () => {
    const arbol: Arbol = {
      'paquetes/inventarios/src/a.ts': "import { v } from '@novutienda/nucleo/servidor';",
      'paquetes/panel/src/b.ts': "import { v } from '@novutienda/nucleo/servidor';",
    };
    expect(motivos(arbol)).toEqual(['@novutienda/nucleo/servidor']);
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
