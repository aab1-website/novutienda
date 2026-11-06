// Prueba de tipos: si los contratos del POS y las exportaciones reales de Inventarios divergen, este
// archivo deja de compilar (`pnpm typecheck`). Lo que se ejecuta aquí es solo la forma en tiempo de
// ejecución del cableado; las afirmaciones de tipos viven en las llamadas a `expectTypeOf`.
import * as inventarios from '@novutienda/inventarios';
import type { Autor, LineaSalida as LineaInventarios, ReferenciaSalida } from '@novutienda/inventarios';
import type { Mercado } from '@novutienda/nucleo';
import type { LineaSalida as LineaPos, ProductoCatalogo, PuertoCatalogo, PuertoInventarios, QuienMueve, ReferenciaMovimiento } from '@novutienda/pos';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { catalogoParaPos, inventariosParaPos } from '../../plataforma/coordinador/index.js';

type ParametrosDe<F> = F extends (...args: infer P) => unknown ? P : never;

describe('contrato de tipos POS <-> Inventarios', () => {
  it('las líneas y la referencia son idénticas en ambos lados', () => {
    expectTypeOf<LineaPos>().toEqualTypeOf<LineaInventarios>();
    expectTypeOf<ReferenciaMovimiento>().toEqualTypeOf<ReferenciaSalida>();
  });

  it('cada argumento que el POS entrega es aceptado por la función real de Inventarios (salvo plan y autor, que se validan en el adaptador)', () => {
    type P = PuertoInventarios;
    // prepararSalida(tx, tenantId, lineas)
    expectTypeOf<ParametrosDe<P['prepararSalida']>>().toExtend<ParametrosDe<typeof inventarios.prepararSalida>>();
    // prepararReversion(tx, tenantId, ref)
    expectTypeOf<ParametrosDe<P['prepararReversion']>>().toExtend<ParametrosDe<typeof inventarios.prepararReversion>>();
    // aplicarSalida / aplicarReversion: tx y ref
    expectTypeOf<ParametrosDe<P['aplicarSalida']>[0]>().toEqualTypeOf<ParametrosDe<typeof inventarios.aplicarSalida>[0]>();
    expectTypeOf<ParametrosDe<P['aplicarSalida']>[2]>().toExtend<ParametrosDe<typeof inventarios.aplicarSalida>[2]>();
    expectTypeOf<ParametrosDe<P['aplicarReversion']>[2]>().toExtend<ParametrosDe<typeof inventarios.aplicarReversion>[2]>();
  });

  it('lo que devuelven las preparaciones sirve de plan para las aplicaciones', () => {
    type PlanSalida = Awaited<ReturnType<typeof inventarios.prepararSalida>>;
    type PlanReversion = Awaited<ReturnType<typeof inventarios.prepararReversion>>;
    expectTypeOf<PlanSalida>().toEqualTypeOf<ParametrosDe<typeof inventarios.aplicarSalida>[1]>();
    expectTypeOf<PlanReversion>().toEqualTypeOf<ParametrosDe<typeof inventarios.aplicarReversion>[1]>();
    expectTypeOf<Awaited<ReturnType<PuertoInventarios['prepararSalida']>>>().toBeUnknown();
  });

  it('quien mueve: Inventarios exige Rol y el POS declara string (divergencia conocida, cubierta por el adaptador)', () => {
    // Autor -> QuienMueve compila; QuienMueve -> Autor NO. Si alguien alinea los tipos, esta línea avisa.
    expectTypeOf<Autor>().toExtend<QuienMueve>();
    expectTypeOf<QuienMueve>().not.toExtend<Autor>();
  });

  it('el cableado completo es asignable al puerto del POS', () => {
    expectTypeOf(inventariosParaPos).toExtend<PuertoInventarios>();
    expectTypeOf(catalogoParaPos).toExtend<PuertoCatalogo>();
    expect(Object.keys(inventariosParaPos).sort()).toEqual(['aplicarReversion', 'aplicarSalida', 'prepararReversion', 'prepararSalida']);
  });

  it('el producto del catálogo del POS usa los mismos mercados que el núcleo', () => {
    expectTypeOf<keyof NonNullable<ProductoCatalogo['preciosUsd']>>().toEqualTypeOf<Mercado>();
  });
});

describe('guardas del adaptador', () => {
  it('rechaza un rol fuera de caj/sup/adm y un plan de otro tipo antes de tocar Inventarios', () => {
    const tx = {} as never;
    expect(() => inventariosParaPos.aplicarSalida(tx, { tipo: 'salida' }, { tipo: 'venta', id: 'v1' }, { uid: 'u', rol: 'dueno' })).toThrow(/Rol inválido/);
    expect(() => inventariosParaPos.aplicarSalida(tx, { tipo: 'reversion' }, { tipo: 'venta', id: 'v1' }, { uid: 'u', rol: 'caj' })).toThrow(/no es de tipo salida/);
    expect(() => inventariosParaPos.aplicarReversion(tx, undefined, { tipo: 'venta', id: 'v1' }, { uid: 'u', rol: 'caj' })).toThrow(/no es de tipo reversion/);
  });
});
