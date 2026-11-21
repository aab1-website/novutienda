// scripts/latencia-sitio.mjs: publicar → completada por trabajo, p50, máximo y marca de más de 10 minutos.
import { describe, expect, it } from 'vitest';
import { calcularLatencias, formatear, leerArgumentos, mediana } from '../../scripts/latencia-sitio.mjs';

const MIN = 60_000;
const T0 = Date.parse('2026-11-21T12:00:00Z');
const estadoPublicado = { version: 3, publicadoEn: new Date(T0).toISOString() };
const op = { desdeMs: T0 - 60 * MIN, ahoraMs: T0 + 60 * MIN };

describe('mediana', () => {
  it('impar, par y vacía', () => {
    expect(mediana([5, 1, 3])).toBe(3);
    expect(mediana([4, 1, 3, 2])).toBe(2.5);
    expect(mediana([])).toBeNull();
  });
});

describe('calcularLatencias', () => {
  it('mide la publicación vigente desde publicadoEn y los demás desde su solicitud', () => {
    const r = calcularLatencias(
      [
        { id: 'rec-publicacion-v3', estado: 'completada', version: 3, motivo: 'publicacion', solicitadaEnMs: T0 + MIN, completadaEnMs: T0 + 4 * MIN },
        { id: 'rec-diaria-v2', estado: 'completada', version: 2, motivo: 'diaria', solicitadaEnMs: T0 - 30 * MIN, completadaEnMs: T0 - 27 * MIN },
      ],
      estadoPublicado,
      op,
    );
    expect(r.filas).toEqual([
      { id: 'rec-diaria-v2', estado: 'completada', base: 'solicitud', ms: 3 * MIN, atrasado: false },
      { id: 'rec-publicacion-v3', estado: 'completada', base: 'publicacion', ms: 4 * MIN, atrasado: false },
    ]);
    expect(r.medidos).toBe(2);
    expect(r.p50Ms).toBe(3.5 * MIN);
    expect(r.maxMs).toBe(4 * MIN);
    expect(r.atrasadas).toBe(0);
  });
  it('marca lo que supera 10 minutos y lo sin cerrar que ya pasó el límite', () => {
    const r = calcularLatencias(
      [
        { id: 'a', estado: 'completada', version: 3, motivo: 'publicacion', solicitadaEnMs: T0 + MIN, completadaEnMs: T0 + 11 * MIN },
        { id: 'b', estado: 'en_curso', motivo: 'diaria', solicitadaEnMs: T0 - 20 * MIN },
        { id: 'c', estado: 'pendiente', motivo: 'diaria', solicitadaEnMs: T0 + 55 * MIN },
        { id: 'd', estado: 'fallida', motivo: 'diaria', solicitadaEnMs: T0 - 5 * MIN },
      ],
      estadoPublicado,
      op,
    );
    const porId = Object.fromEntries(r.filas.map((f) => [f.id, f]));
    expect(porId['a']?.atrasado).toBe(true);
    expect(porId['b']?.atrasado).toBe(true);
    expect(porId['c']?.atrasado).toBe(false);
    expect(porId['d']?.atrasado).toBe(false);
    expect(r.atrasadas).toBe(2);
    expect(r.fallidas).toBe(1);
    expect(r.medidos).toBe(1);
    expect(formatear(r)).toContain('> a  completada  base publicacion  11.0 min');
    expect(formatear(r)).toContain('p50: 11.0 min');
  });
  it('ignora lo anterior a --desde y lo sin hora de solicitud; sin datos no hay p50', () => {
    const r = calcularLatencias(
      [{ id: 'viejo', estado: 'completada', solicitadaEnMs: op.desdeMs - 1, completadaEnMs: op.desdeMs + MIN }, { id: 'sin-hora', estado: 'completada' }],
      undefined,
      op,
    );
    expect(r.filas).toEqual([]);
    expect(r.p50Ms).toBeNull();
    expect(r.maxMs).toBeNull();
  });
  it('el límite es configurable', () => {
    const r = calcularLatencias([{ id: 'a', estado: 'completada', solicitadaEnMs: T0, completadaEnMs: T0 + 6 * MIN }], undefined, { ...op, limiteMin: 5 });
    expect(r.atrasadas).toBe(1);
  });
});

describe('leerArgumentos', () => {
  it('acepta tenant y fecha ISO', () => {
    const o = leerArgumentos(['--tenant', 'tienda-a', '--desde', '2026-11-21T00:00:00Z', '--json']);
    expect(o.tenant).toBe('tienda-a');
    expect(o.desdeMs).toBe(Date.parse('2026-11-21T00:00:00Z'));
    expect(o.json).toBe(true);
    expect(o.limiteMin).toBe(10);
  });
  it.each([
    [['--desde', '2026-11-21T00:00:00Z']],
    [['--tenant', 'MAL', '--desde', '2026-11-21T00:00:00Z']],
    [['--tenant', 'tienda-a']],
    [['--tenant', 'tienda-a', '--desde', 'ayer']],
    [['--tenant', 'tienda-a', '--desde', '2026-11-21T00:00:00Z', '--limite-min', '0']],
    [['--tenant', '--desde', '2026-11-21T00:00:00Z']],
    [['--tenant', 'tienda-a', '--desde', '2026-11-21T00:00:00Z', '--otra']],
  ])('rechaza %j', (args) => {
    expect(() => leerArgumentos(args)).toThrow();
  });
});
