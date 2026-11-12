// Conformidad del contrato del panel con los módulos reales: los tipos que el panel re-declara deben encajar con los de
// las entradas públicas de cada módulo (la comprobación de tipos corre con `pnpm typecheck`), y las listas cerradas
// (roles, monedas, almacenes, plantillas, límites) deben coincidir.
import { describe, expect, it } from 'vitest';
import { PERMISOS } from '@novutienda/inventarios';
import { ALMACENES_POS, MEDIOS_PAGO as MEDIOS_POS, MONEDAS_POS } from '@novutienda/pos';
import { LIMITES_CONSOLA, PANTALLAS, PLANTILLAS } from '@novutienda/consola';
import { UBICACIONES } from '@novutienda/inventarios';
import { manifiestoPanel, MEDIOS_PAGO, MONEDAS, NOMBRES_CALLABLE, PLANTILLAS_SITIO, LIMITES_PANEL, ROLES_CALLABLE, UBICACIONES as UBIC_PANEL } from '@novutienda/panel';
import type * as Panel from '@novutienda/panel';
import type * as Pos from '@novutienda/pos';
import type * as Inv from '@novutienda/inventarios';
import type * as Rec from '@novutienda/recibos';
import type * as Con from '@novutienda/consola';

/** `true` si todo valor de D sirve donde se espera O. */
type Cabe<D, O> = [D] extends [O] ? true : false;
const afirmar = <T extends true>(valor: T): T => valor;

describe('tipos del contrato frente a los módulos', () => {
  it('lo que el servidor devuelve encaja en los tipos de lectura del panel (módulo → panel)', () => {
    afirmar<Cabe<Pos.TurnoPos, Panel.TurnoPos>>(true);
    afirmar<Cabe<Pos.VentaPos, Panel.VentaPos>>(true);
    afirmar<Cabe<Pos.ConfigPos, Panel.ConfigPos>>(true);
    afirmar<Cabe<Pos.AprobacionPos, Panel.AprobacionPos>>(true);
    afirmar<Cabe<Pos.ResultadoAnulacion, Panel.ResultadoAnulacion>>(true);
    afirmar<Cabe<Pos.MovimientoCaja, Panel.MovimientoCaja>>(true);
    afirmar<Cabe<Pos.CobroCredito, Panel.CobroCredito>>(true);
    afirmar<Cabe<Rec.Recibo, Panel.Recibo>>(true);
    afirmar<Cabe<Rec.PlantillaRecibo, Panel.PlantillaRecibo>>(true);
    afirmar<Cabe<Con.FichaWeb, Panel.FichaWeb>>(true);
    afirmar<Cabe<Con.Seccion, Panel.Seccion>>(true);
    afirmar<Cabe<Con.ConfigSitio, Panel.ConfigSitio>>(true);
    afirmar<Cabe<Con.Carrusel, Panel.Carrusel>>(true);
    afirmar<Cabe<Con.Tablero, Panel.Tablero>>(true);
    afirmar<Cabe<Con.ResultadoPublicacion, Panel.ResultadoPublicacion>>(true);
    afirmar<Cabe<Con.Reserva, Panel.Reserva>>(true);
    afirmar<Cabe<Inv.Simulacion, Panel.Simulacion>>(true);
    afirmar<Cabe<Inv.ResultadoImportacion, Panel.ResultadoImportacion>>(true);
    expect(true).toBe(true);
  });

  it('lo que el panel envía encaja en las entradas de los módulos (panel → módulo)', () => {
    afirmar<Cabe<Panel.Carrito, Pos.Carrito>>(true);
    afirmar<Cabe<Panel.SolicitudAprobacion, Pos.SolicitudAprobacion>>(true);
    afirmar<Cabe<Panel.MovimientoCajaEntrada, Pos.MovimientoCajaEntrada>>(true);
    afirmar<Cabe<Panel.CobroCreditoEntrada, Pos.CobroCreditoEntrada>>(true);
    afirmar<Cabe<Panel.ConfigPos, Pos.ConfigPos>>(true);
    afirmar<Cabe<Panel.EntradaProducto, Inv.EntradaProducto>>(true);
    afirmar<Cabe<Panel.CambiosProducto, Inv.CambiosProducto>>(true);
    afirmar<Cabe<Panel.LineaIngreso, Inv.LineaIngreso>>(true);
    afirmar<Cabe<Panel.LineaAjuste, Inv.LineaAjuste>>(true);
    afirmar<Cabe<Panel.ConsultaArchivo, Rec.ConsultaArchivo>>(true);
    afirmar<Cabe<Panel.PlantillaRecibo, Rec.PlantillaRecibo>>(true);
    afirmar<Cabe<Panel.FichaWeb, Con.FichaWeb>>(true);
    afirmar<Cabe<Panel.Seccion, Con.Seccion>>(true);
    afirmar<Cabe<Panel.ConfigSitio, Con.ConfigSitio>>(true);
    afirmar<Cabe<Panel.Carrusel, Con.Carrusel>>(true);
    expect(true).toBe(true);
  });
});

describe('listas cerradas y límites', () => {
  it('medios de pago, monedas y almacenes del POS', () => {
    expect([...MEDIOS_PAGO]).toEqual([...MEDIOS_POS]);
    expect([...MONEDAS]).toEqual([...MONEDAS_POS]);
    expect([...UBIC_PANEL]).toEqual([...ALMACENES_POS]);
    expect([...UBIC_PANEL]).toEqual([...UBICACIONES]);
  });
  it('plantillas y límites de la consola', () => {
    expect([...PLANTILLAS_SITIO]).toEqual([...PLANTILLAS]);
    expect(LIMITES_PANEL.productos).toBe(LIMITES_CONSOLA.productos);
    expect(LIMITES_PANEL.usuarios).toBe(LIMITES_CONSOLA.usuarios);
    expect(LIMITES_PANEL.fotosPorProducto).toBe(LIMITES_CONSOLA.fotosPorProducto);
    expect(LIMITES_PANEL.videosPorProducto).toBe(LIMITES_CONSOLA.videosPorProducto);
    expect(LIMITES_PANEL.bytesFoto).toBe(LIMITES_CONSOLA.bytesFoto);
    expect(LIMITES_PANEL.bytesVideo).toBe(LIMITES_CONSOLA.bytesVideo);
    expect(LIMITES_PANEL.duracionVideoSeg).toBe(LIMITES_CONSOLA.duracionVideoSeg);
    expect(LIMITES_PANEL.seccionesMax).toBe(LIMITES_CONSOLA.seccionesMax);
    expect(LIMITES_PANEL.cuotaOriginalesBytes).toBe(LIMITES_CONSOLA.cuotaOriginalesBytes);
  });
  it('los roles de cada callable de Inventarios son los de su tabla de permisos', () => {
    expect([...ROLES_CALLABLE.ingresar]).toEqual([...PERMISOS.ingreso]);
    expect([...ROLES_CALLABLE.traspasar]).toEqual([...PERMISOS.traspaso]);
    expect([...ROLES_CALLABLE.ajustar]).toEqual([...PERMISOS.ajuste]);
    expect([...ROLES_CALLABLE.solicitarMerma]).toEqual([...PERMISOS.mermaSolicitar]);
    expect([...ROLES_CALLABLE.resolverMerma]).toEqual([...PERMISOS.mermaResolver]);
    expect([...ROLES_CALLABLE.abrirConteo]).toEqual([...PERMISOS.conteoAbrir]);
    expect([...ROLES_CALLABLE.registrarLineaConteo]).toEqual([...PERMISOS.conteoRegistrar]);
    expect([...ROLES_CALLABLE.cerrarConteo]).toEqual([...PERMISOS.conteoCerrar]);
    expect([...ROLES_CALLABLE.crearProducto]).toEqual([...PERMISOS.producto]);
    expect([...ROLES_CALLABLE.actualizarProducto]).toEqual([...PERMISOS.producto]);
    expect([...ROLES_CALLABLE.importarProductosCsv]).toEqual([...PERMISOS.importacion]);
    expect([...ROLES_CALLABLE.simularImportacionProductos]).toEqual([...PERMISOS.importacion]);
  });
});

describe('cobertura de las pantallas de la consola', () => {
  // Funciones puras de la consola que el panel resuelve en el navegador con la misma lógica (no son callables).
  const PURAS = new Set(['preciosDelDia']);
  // Nombres con que el panel pide lo mismo (el alta y la edición de productos de la consola se piden como `crearProducto` y
  // `actualizarProducto`; `real.ts` los traduce a `consola.crearProducto` y `consola.editarProducto`).
  const RENOMBRADAS: Readonly<Record<string, string>> = {
    exportarProductosCsv: 'exportarProductosCsvSitio', crearProductoConsola: 'crearProducto', editarProductoConsola: 'actualizarProducto',
  };
  it('cada llamada declarada en PANTALLAS existe como callable del contrato', () => {
    const faltan: string[] = [];
    for (const p of PANTALLAS) {
      for (const llamada of p.llamadas) {
        if (PURAS.has(llamada)) continue;
        const nombre = RENOMBRADAS[llamada] ?? llamada;
        if (!(NOMBRES_CALLABLE as readonly string[]).includes(nombre)) faltan.push(`${p.id}: ${llamada}`);
      }
    }
    expect(faltan).toEqual([]);
  });
  it('los roles del contrato no son más amplios que los de la pantalla correspondiente', () => {
    expect([...ROLES_CALLABLE.obtenerTablero]).toEqual(['sup', 'adm']);
    expect([...ROLES_CALLABLE.publicarSitio]).toEqual(['adm']);
    expect([...ROLES_CALLABLE.guardarConfigSitio]).toEqual(['adm']);
    expect([...ROLES_CALLABLE.guardarFicha]).toEqual(['sup', 'adm']);
    expect([...ROLES_CALLABLE.cambiarPrecioUSD]).toEqual(['adm']);
  });
});

describe('manifiesto del panel', () => {
  it('no es dueño de datos: sin colecciones, ni eventos', () => {
    expect(manifiestoPanel.id).toBe('panel');
    expect(manifiestoPanel.colecciones).toEqual([]);
    expect(manifiestoPanel.emite).toEqual([]);
    expect(manifiestoPanel.consume).toEqual([]);
    expect(manifiestoPanel.dependeDe).toEqual(['nucleo']);
  });
});
