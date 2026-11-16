// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { EntradaAuditoriaVista } from '../../api/tipos.js';
import { crearEntorno, uuid } from '../../ayuda-pruebas.js';
import { ACCIONES_AUDITORIA, nombreDeAccion } from './nombres-auditoria.js';
import { PantallaSupervision } from './supervision.js';

afterEach(() => cleanup());

/** Código de los paquetes de POS y Recibos, leído como texto (sin sus pruebas). */
const FUENTES = import.meta.glob<string>(['../../../../pos/src/**/*.ts', '../../../../recibos/src/**/*.ts', '!../../../../*/src/**/*.test.ts'], { query: '?raw', import: 'default', eager: true });

/** Acciones `pos.*` y `recibos.*` que los paquetes escriben en la auditoría (se leen del código, no de una lista a mano). */
function accionesEmitidas(): string[] {
  const hallados = new Set<string>();
  for (const texto of Object.values(FUENTES)) {
    for (const m of texto.matchAll(/accion:\s*(?:[^'\n]*\?\s*)?'((?:pos|recibos)\.[a-z_.-]+)'(?:\s*:\s*'((?:pos|recibos)\.[a-z_.-]+)')?/g)) {
      if (m[1] !== undefined) hallados.add(m[1]);
      if (m[2] !== undefined) hallados.add(m[2]);
    }
  }
  return [...hallados].sort();
}

describe('nombres de las acciones de auditoría (S-01, G-10)', () => {
  it('cada acción pos.* y recibos.* que los paquetes emiten tiene nombre legible', () => {
    const emitidas = accionesEmitidas();
    expect(emitidas.length).toBeGreaterThanOrEqual(15);
    for (const codigo of emitidas) expect(nombreDeAccion(codigo), codigo).not.toBe(codigo);
  });

  it('no hay dos acciones con el mismo nombre ni nombres que se parezcan a un código', () => {
    const nombres = ACCIONES_AUDITORIA.map((a) => a.nombre);
    expect(new Set(nombres).size).toBe(nombres.length);
    for (const n of nombres) expect(n).not.toMatch(/^[a-z]+\.[a-z]/);
  });

  it('una acción desconocida se muestra con su código', () => {
    expect(nombreDeAccion('pos.algo.nuevo')).toBe('pos.algo.nuevo');
  });
});

describe('supervisión: auditoría legible', () => {
  it('muestra el nombre de la acción y el correo, no el código ni el uid; el filtro manda el código exacto', async () => {
    const e = crearEntorno('caj');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 0 } });
    e.como('sup');
    render(e.envolver(h(PantallaSupervision, { sub: 'auditoria' })));
    const u = userEvent.setup();
    const tabla = await screen.findByRole('table', { name: 'Registro de auditoría' });
    expect(within(tabla).getByText('Apertura de turno')).toBeTruthy();
    expect(tabla.textContent).toContain('caj@ejemplo.test (Vendedor)');
    expect(tabla.textContent).not.toContain('pos.turno.abrir');
    expect(tabla.textContent).not.toContain('u-caj');
    expect(screen.queryByLabelText(/contiene/i)).toBeNull();
    await u.selectOptions(screen.getByLabelText('Acción'), 'Apertura de turno');
    await u.click(screen.getByRole('button', { name: 'Filtrar' }));
    await waitFor(() => expect(e.api.llamadas.some((l) => l.nombre === 'listarAuditoria' && (l.entrada as { accion?: string }).accion === 'pos.turno.abrir')).toBe(true));
    const opciones = [...(screen.getByLabelText('Acción') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(opciones).toContain('Venta confirmada');
    expect(opciones).toContain('Recibo emitido');
  });

  it('avisa que la lista está cortada al llegar al tope', async () => {
    const e = crearEntorno('sup');
    const muchas = Array.from({ length: 100 }, (_, i): EntradaAuditoriaVista => ({ id: `a-${i}`, fecha: '2026-11-04T15:00:00.000Z', uid: 'u-caj', rol: 'caj', accion: 'pos.venta.confirmar', ruta: `ventas/${i}` }));
    const original = e.api.llamar.bind(e.api);
    (e.api as { llamar: unknown }).llamar = async (n: string, entrada: unknown) => (n === 'listarAuditoria' ? muchas : original(n as never, entrada as never));
    render(e.envolver(h(PantallaSupervision, { sub: 'auditoria' })));
    expect(await screen.findByText(/Se muestran los 100 registros más recientes y puede haber más/)).toBeTruthy();
  });
});
