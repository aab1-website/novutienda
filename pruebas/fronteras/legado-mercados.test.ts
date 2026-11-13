import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { simbolosDeNucleoUsados } from './verificador.js';

// Compuerta «solo se achica» del plan «mercados y monedas son configuración del tenant» (plano §6.10), al estilo de deuda.json.
// `legado-mercados.json` lista, por símbolo legado del núcleo, los archivos que aún lo importan. Un archivo nuevo no puede
// apoyarse en el legado; uno que ya no lo usa se quita de la lista. Llega a cero al cerrar el plan.
// Alcance: código de producción de `paquetes/` (salvo `nucleo`) y `plataforma/`; no se cuentan pruebas (`*.test.*`, `*.spec.*`).
const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const lista = JSON.parse(readFileSync(fileURLToPath(new URL('./legado-mercados.json', import.meta.url)), 'utf8')) as {
  readonly simbolos: Readonly<Record<string, readonly string[]>>;
};
const SIMBOLOS = Object.keys(lista.simbolos);

const EN_ALCANCE = /^(paquetes|plataforma)\/.*\.(ts|tsx|mjs|js)$/;
const ES_PRUEBA = /\.(test|spec)\.[a-z]+$/;
const archivos = execFileSync('git', ['ls-files', '-z'], { cwd: RAIZ, encoding: 'utf8' }).split('\0')
  .filter((f) => EN_ALCANCE.test(f) && !f.startsWith('paquetes/nucleo/') && !ES_PRUEBA.test(f));

function usosReales(leer: (f: string) => string, fuentes: readonly string[]): Record<string, string[]> {
  const usos: Record<string, string[]> = Object.fromEntries(SIMBOLOS.map((s) => [s, []]));
  for (const f of fuentes) for (const s of simbolosDeNucleoUsados(leer(f), SIMBOLOS)) usos[s]?.push(f);
  return usos;
}

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
  it('no da falso positivo con nombres locales, otros paquetes ni comentarios', () => {
    expect(simbolosDeNucleoUsados('const MERCADOS = [1]; function leerCotizacion() {}', S)).toEqual([]);
    expect(simbolosDeNucleoUsados("import { MERCADOS } from './local.js';", S)).toEqual([]);
    expect(simbolosDeNucleoUsados("import { MERCADOS } from '@novutienda/pos';", S)).toEqual([]);
    expect(simbolosDeNucleoUsados("// import { MERCADOS } from '@novutienda/nucleo';", S)).toEqual([]);
  });
});
