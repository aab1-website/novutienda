import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAMPOS_RESERVA, reservarSubida, type DepsMedios } from '@novutienda/consola';
import { actor, CatalogoDoble, nuevaDb, RelojFijo, T } from './dobles.js';

const GENERADOR = new URL('../../scripts/generar-reglas.mjs', import.meta.url);

/**
 * Campos que la plantilla `reservaValida` lee del documento de la reserva. Si el generador ya exporta
 * `CAMPOS_PLANTILLA_RESERVA`, se usa; si no, se extraen del texto de la función (`r.<campo>` sobre la variable `r`).
 */
async function camposDePlantilla(): Promise<string[]> {
  const modulo = (await import(GENERADOR.href)) as { CAMPOS_PLANTILLA_RESERVA?: readonly string[] };
  if (modulo.CAMPOS_PLANTILLA_RESERVA !== undefined) return [...modulo.CAMPOS_PLANTILLA_RESERVA];
  const texto = readFileSync(GENERADOR, 'utf8');
  const inicio = texto.indexOf('function funcionReserva');
  const fin = texto.indexOf('export function generarReglasAlmacenamiento');
  expect(inicio).toBeGreaterThan(-1);
  expect(fin).toBeGreaterThan(inicio);
  return [...texto.slice(inicio, fin).matchAll(/\br\.(\w+)/g)].map((m) => m[1] as string);
}

describe('contrato de la reserva de subida (consola <-> storage.rules)', () => {
  it('los campos que la plantilla reservaValida nombra son exactamente CAMPOS_RESERVA', async () => {
    const campos = [...new Set(await camposDePlantilla())].sort();
    expect(campos).toEqual([...CAMPOS_RESERVA].sort());
  });

  it('reservarSubida escribe todos los campos de CAMPOS_RESERVA; el resto son de identificación y auditoría', async () => {
    const db = nuevaDb();
    const catalogo = new CatalogoDoble(db);
    catalogo.agregar('cam-1');
    const deps = { db, catalogo, reloj: new RelojFijo() } as unknown as DepsMedios;
    await reservarSubida(deps, { tenantId: T, actor: actor('adm'), subidaId: 'subida-0001', productoId: 'cam-1', tipo: 'foto', bytes: 1000 });
    const doc = db.dato(`tenants/${T}/subidas/subida-0001`);
    expect(doc).toBeDefined();
    const claves = Object.keys(doc ?? {});
    for (const c of CAMPOS_RESERVA) expect(claves, c).toContain(c);
    // Lo que no es contrato con las reglas: identificador, ruta del original y marca de creación.
    expect(claves.filter((k) => !(CAMPOS_RESERVA as readonly string[]).includes(k)).sort()).toEqual(['creadaEn', 'id', 'rutaOriginal']);
    expect(doc).toMatchObject({ estado: 'reservada', productoId: 'cam-1', por: 'u-adm', bytes: 1000, tipo: 'foto' });
  });
});
