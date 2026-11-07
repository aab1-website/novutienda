// El compositor (`ui/app.tsx`) monta cada pantalla del registro: las claves de su mapa id → componente son exactamente los
// ids de pantalla de los manifiestos. (`app.tsx` no es entrada pública del paquete: se lee su texto.)
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { registroPlataforma } from '../../plataforma/registro.js';

describe('pantallas del panel frente al registro', () => {
  it('las claves del mapa id → componente son los ids de pantalla del registro', () => {
    const fuente = readFileSync(new URL('../../paquetes/panel/src/ui/app.tsx', import.meta.url), 'utf8');
    const bloque = /COMPONENTES_PANTALLA[^\n]*= \{([\s\S]*?)\n\};/.exec(fuente)?.[1] ?? '';
    const claves = [...bloque.matchAll(/^ {2}([a-z]+):/gm)].map((m) => m[1]);
    expect(claves.length).toBeGreaterThan(0);
    expect([...claves].sort()).toEqual(registroPlataforma.pantallas().map((p) => p.id).sort());
  });
});
