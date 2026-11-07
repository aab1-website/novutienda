// Lo versionado en el panel (roles de acciones y pantallas) es exactamente lo que genera el registro:
// `pnpm registro:generar` lo reescribe y esta prueba falla si alguien lo edita a mano o cambia un manifiesto sin regenerar.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const raiz = new URL('../../', import.meta.url);
const leer = (ruta: string): string => readFileSync(new URL(ruta, raiz), 'utf8');

describe('tablas generadas del panel', () => {
  it('registro:verificar confirma que lo versionado es igual a lo generado', () => {
    const salida = execFileSync('node', ['scripts/registro-panel.mjs', 'verificar'], { cwd: raiz, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    expect(salida).toContain('acciones.generado.ts coincide');
    expect(salida).toContain('pantallas.generado.ts coincide');
  });

  it('las dos tablas llevan la cabecera GENERADO', () => {
    expect(leer('paquetes/panel/src/api/acciones.generado.ts')).toMatch(/^\/\/ GENERADO/);
    expect(leer('paquetes/panel/src/util/pantallas.generado.ts')).toMatch(/^\/\/ GENERADO/);
  });
});
