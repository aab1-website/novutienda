import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { simbolosDeNucleoUsados } from './verificador.js';

// Compuerta «solo se achica» del plan «mercados y monedas son configuración del tenant» (plano §6.10), al estilo de deuda.json.
// `legado-mercados.json` lista, por símbolo legado del núcleo, los archivos que aún lo importan. Un archivo nuevo no puede
// apoyarse en el legado; uno que ya no lo usa se quita de la lista. Llega a cero al cerrar el plan.
// Símbolos vigilados: todo lo que `tipo-cambio/` y `tenant/` del núcleo exportan con `@deprecated`, más una lista explícita
// para lo que deba vigilarse aunque no lleve la marca (o aún no la lleve).
// Alcance: código de producción de `paquetes/` (salvo `nucleo`), `plataforma/` (incluye `funciones/scripts`) y `scripts/`,
// con `.astro`; no se cuentan pruebas (`*.test.*`, `*.spec.*`).
const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const lista = JSON.parse(readFileSync(fileURLToPath(new URL('./legado-mercados.json', import.meta.url)), 'utf8')) as {
  readonly simbolos: Readonly<Record<string, readonly string[]>>;
};
const SIMBOLOS = Object.keys(lista.simbolos);

const EXPLICITOS = ['COMERCIAL_LEGADO_TRES_MONEDAS', 'comercialLegado', 'precioFinal', 'esMercado'];
const CARPETAS_NUCLEO = ['paquetes/nucleo/src/tipo-cambio', 'paquetes/nucleo/src/tenant'];

/** Exportaciones del núcleo marcadas `@deprecated`, leídas con el compilador de TypeScript. */
function deprecadosDelNucleo(): string[] {
  const nombres = new Set<string>();
  for (const carpeta of CARPETAS_NUCLEO) {
    for (const archivo of readdirSync(`${RAIZ}${carpeta}`).filter((f) => f.endsWith('.ts'))) {
      const fuente = ts.createSourceFile(archivo, readFileSync(`${RAIZ}${carpeta}/${archivo}`, 'utf8'), ts.ScriptTarget.Latest, true);
      const exportado = (n: ts.Node): boolean => ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      for (const n of fuente.statements) {
        if (!exportado(n)) continue;
        if (ts.isVariableStatement(n)) {
          if (ts.getJSDocDeprecatedTag(n) !== undefined) for (const d of n.declarationList.declarations) if (ts.isIdentifier(d.name)) nombres.add(d.name.text);
        } else if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isEnumDeclaration(n))
          && n.name !== undefined && ts.getJSDocDeprecatedTag(n) !== undefined) nombres.add(n.name.text);
      }
    }
  }
  return [...nombres];
}

const EN_ALCANCE = /^(paquetes|plataforma|scripts)\/.*\.(ts|tsx|mts|cts|mjs|cjs|js|astro)$/;
const ES_PRUEBA = /\.(test|spec)\.[a-z]+$/;
const archivos = execFileSync('git', ['ls-files', '-z'], { cwd: RAIZ, encoding: 'utf8' }).split('\0')
  .filter((f) => EN_ALCANCE.test(f) && !f.startsWith('paquetes/nucleo/') && !ES_PRUEBA.test(f));

function usosReales(leer: (f: string) => string, fuentes: readonly string[]): Record<string, string[]> {
  const usos: Record<string, string[]> = Object.fromEntries(SIMBOLOS.map((s) => [s, []]));
  for (const f of fuentes) for (const s of simbolosDeNucleoUsados(leer(f), SIMBOLOS)) usos[s]?.push(f);
  return usos;
}

describe('legado de mercados: el conjunto vigilado cubre todo lo deprecado del núcleo', () => {
  it('todo export @deprecated de tipo-cambio/ y tenant/ está vigilado', () => {
    const deprecados = deprecadosDelNucleo();
    expect(deprecados.length).toBeGreaterThan(10); // el análisis encuentra la marca
    expect(deprecados.filter((d) => !SIMBOLOS.includes(d))).toEqual([]);
  });

  it('los símbolos de la lista explícita están vigilados y cada vigilado existe como exportación del núcleo', () => {
    expect(EXPLICITOS.filter((e) => !SIMBOLOS.includes(e))).toEqual([]);
    const permitidos = new Set([...deprecadosDelNucleo(), ...EXPLICITOS]);
    expect(SIMBOLOS.filter((s) => !permitidos.has(s))).toEqual([]);
  });
});

describe('legado de mercados: la lista solo se achica', () => {
  const reales = usosReales((f) => readFileSync(`${RAIZ}${f}`, 'utf8'), archivos);

  it('ningún archivo nuevo usa un símbolo legado (falla cerrado: no se asume el tenant de referencia)', () => {
    const nuevos = SIMBOLOS.flatMap((s) => (reales[s] ?? []).filter((f) => !(lista.simbolos[s] ?? []).includes(f)).map((f) => `${f} usa ${s}`));
    expect(nuevos).toEqual([]);
  });

  it('ningún archivo de la lista sigue en ella cuando ya no usa el símbolo', () => {
    const sobran = SIMBOLOS.flatMap((s) => (lista.simbolos[s] ?? []).filter((f) => !(reales[s] ?? []).includes(f)).map((f) => `${f} ya no usa ${s}`));
    expect(sobran).toEqual([]);
  });

  it('la lista está ordenada y sin repetidos', () => {
    for (const s of SIMBOLOS) expect(lista.simbolos[s], s).toEqual([...new Set(lista.simbolos[s])].sort());
  });
});

describe('detector de símbolos legado con código inventado', () => {
  const S = ['leerCotizacion', 'MERCADOS'];
  it('detecta importaciones nombradas, con alias, type y subpath', () => {
    expect(simbolosDeNucleoUsados("import { leerCotizacion as l, type X } from '@novutienda/nucleo';", S)).toEqual(['leerCotizacion']);
    expect(simbolosDeNucleoUsados("import {\n  MERCADOS,\n} from '@novutienda/nucleo/tipo-cambio';", S)).toEqual(['MERCADOS']);
    expect(simbolosDeNucleoUsados("export { MERCADOS } from '@novutienda/nucleo';", S)).toEqual(['MERCADOS']);
  });
  it('detecta el espacio de nombres con uso del símbolo', () => {
    expect(simbolosDeNucleoUsados("import * as n from '@novutienda/nucleo'; n.MERCADOS.map(f);", S)).toEqual(['MERCADOS']);
    expect(simbolosDeNucleoUsados("import * as n from '@novutienda/nucleo'; n.otra();", S)).toEqual([]);
  });
  it('cubre import() dinámico, export *, export { X } from, desestructuración y corchetes', () => {
    const n = "'@novutienda/nucleo'";
    expect(simbolosDeNucleoUsados(`const m = await import(${n}); m.MERCADOS;`, S)).toEqual(['MERCADOS']);
    expect(simbolosDeNucleoUsados(`const { MERCADOS: M } = await import(${n});`, S)).toEqual(['MERCADOS']);
    expect(simbolosDeNucleoUsados(`const x = (await import(${n})).leerCotizacion;`, S)).toEqual(['leerCotizacion']);
    expect(simbolosDeNucleoUsados(`import * as n from ${n}; const { MERCADOS } = n;`, S)).toEqual(['MERCADOS']);
    expect(simbolosDeNucleoUsados(`import * as n from ${n}; n['MERCADOS'];`, S)).toEqual(['MERCADOS']);
    expect(simbolosDeNucleoUsados(`import * as n from ${n}; n?.MERCADOS;`, S)).toEqual(['MERCADOS']);
  });
  it('falla cerrado: corchetes no literales, export * o import() sin seguir cuentan como todos', () => {
    const n = "'@novutienda/nucleo'";
    expect(simbolosDeNucleoUsados(`import * as n from ${n}; n[clave];`, S)).toEqual([...S].sort());
    expect(simbolosDeNucleoUsados(`export * from ${n};`, S)).toEqual([...S].sort());
    expect(simbolosDeNucleoUsados(`export * as todo from ${n};`, S)).toEqual([...S].sort());
    expect(simbolosDeNucleoUsados(`import(${n}).then((m) => m.x);`, S)).toEqual([...S].sort());
    expect(simbolosDeNucleoUsados(`import * as n from ${n}; n.otra; n['otra'];`, S)).toEqual([]);
  });
  it('no da falso positivo con nombres locales, otros paquetes ni comentarios', () => {
    expect(simbolosDeNucleoUsados('const MERCADOS = [1]; function leerCotizacion() {}', S)).toEqual([]);
    expect(simbolosDeNucleoUsados("import { MERCADOS } from './local.js';", S)).toEqual([]);
    expect(simbolosDeNucleoUsados("import { MERCADOS } from '@novutienda/pos';", S)).toEqual([]);
    expect(simbolosDeNucleoUsados("// import { MERCADOS } from '@novutienda/nucleo';", S)).toEqual([]);
  });
});
