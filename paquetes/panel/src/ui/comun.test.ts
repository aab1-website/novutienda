// @vitest-environment jsdom
import { h, type JSX } from 'preact';
import { cleanup, render, screen } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Area, Boton, Campo, ConCarga, Selector } from './comun.js';
import type { Carga } from './hooks.js';

afterEach(cleanup);

describe('Boton', () => {
  it('sin motivo se comporta como siempre: deshabilitado y ocupado apagan el botón de verdad', () => {
    render(h('div', null, h(Boton, { deshabilitado: true }, 'Uno'), h(Boton, { ocupado: true }, 'Dos')));
    expect((screen.getByRole('button', { name: 'Uno' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Procesando…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('con motivo: sigue enfocable, el motivo se ve y está enlazado, y al pulsar no ejecuta onClick sino onIntento', async () => {
    const alPulsar = vi.fn();
    const alIntentar = vi.fn();
    const u = userEvent.setup();
    render(h(Boton, { motivo: 'Falta el nombre', onClick: alPulsar, onIntento: alIntentar }, 'Guardar'));
    const b = screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    expect(b.getAttribute('aria-disabled')).toBe('true');
    const motivo = screen.getByText('Falta el nombre');
    expect(b.getAttribute('aria-describedby')).toBe(motivo.id);
    await u.tab();
    expect(document.activeElement).toBe(b);
    await u.click(b);
    expect(alPulsar).not.toHaveBeenCalled();
    expect(alIntentar).toHaveBeenCalledTimes(1);
  });

  it('con motivo, un botón de envío no envía el formulario', async () => {
    const alEnviar = vi.fn((e: Event) => e.preventDefault());
    const alIntentar = vi.fn();
    const u = userEvent.setup();
    render(h('form', { onSubmit: alEnviar }, h(Boton, { tipo: 'submit', motivo: 'Falta algo', onIntento: alIntentar }, 'Enviar')));
    await u.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(alEnviar).not.toHaveBeenCalled();
    expect(alIntentar).toHaveBeenCalledTimes(1);
  });

  it('sin motivo ejecuta onClick', async () => {
    const alPulsar = vi.fn();
    render(h(Boton, { onClick: alPulsar }, 'Ir'));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ir' }));
    expect(alPulsar).toHaveBeenCalledTimes(1);
  });
});

describe('campos', () => {
  it('Campo: ayuda, error con prefijo, aria-invalid y aria-describedby con ambos', () => {
    render(h(Campo, { etiqueta: 'Nombre', valor: '', onInput: () => undefined, ayuda: 'Como en la factura', error: 'Es obligatorio' }));
    const c = screen.getByLabelText('Nombre');
    expect(c.getAttribute('aria-invalid')).toBe('true');
    const ids = (c.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids[0] ?? '')?.textContent).toBe('Como en la factura');
    expect(document.getElementById(ids[1] ?? '')?.textContent).toBe('Error: Es obligatorio');
  });

  it('Campo sin error ni ayuda no marca nada', () => {
    render(h(Campo, { etiqueta: 'Nombre', valor: '', onInput: () => undefined }));
    const c = screen.getByLabelText('Nombre');
    expect(c.getAttribute('aria-invalid')).toBeNull();
    expect(c.getAttribute('aria-describedby')).toBeNull();
  });

  it('tope pone maxLength y muestra «32 de 70»; solo se anuncia desde el 90 %', async () => {
    const { rerender } = render(h(Campo, { etiqueta: 'Nombre', valor: 'a'.repeat(32), onInput: () => undefined, tope: 70 }));
    expect(screen.getByLabelText('Nombre').getAttribute('maxlength')).toBe('70');
    expect(screen.getByText('32 de 70')).toBeTruthy();
    const viva = (): string => document.querySelector('[aria-live="polite"]')?.textContent ?? '';
    expect(viva()).toBe('');
    rerender(h(Campo, { etiqueta: 'Nombre', valor: 'a'.repeat(63), onInput: () => undefined, tope: 70 }));
    expect(screen.getByText('63 de 70')).toBeTruthy();
    expect(viva()).toBe('63 de 70 caracteres');
  });

  it('Area: ayuda, tope y error', () => {
    render(h(Area, { etiqueta: 'Descripción', valor: 'hola', onInput: () => undefined, ayuda: 'Breve', tope: 100, error: 'Muy corta' }));
    const a = screen.getByLabelText('Descripción');
    expect(a.getAttribute('maxlength')).toBe('100');
    expect(a.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('4 de 100')).toBeTruthy();
    expect(screen.getByText('Breve')).toBeTruthy();
    expect(screen.getByText('Error: Muy corta')).toBeTruthy();
  });

  it('Selector: ayuda y error', () => {
    render(h(Selector, { etiqueta: 'Moneda', valor: 'a', opciones: [{ valor: 'a', texto: 'A' }], onCambio: () => undefined, ayuda: 'Elija una', error: 'Falta' }));
    const s = screen.getByLabelText('Moneda');
    expect(s.getAttribute('aria-invalid')).toBe('true');
    expect((s.getAttribute('aria-describedby') ?? '').split(' ')).toHaveLength(2);
    expect(screen.getByText('Error: Falta')).toBeTruthy();
  });
});

describe('ConCarga', () => {
  const carga = (o: Partial<Carga<string>>): Carga<string> => ({ datos: undefined, error: null, cargando: false, recargar: () => undefined, ...o });
  const vista = (c: Carga<string>): JSX.Element => h(ConCarga<string>, { carga: c, children: (d: string) => h('p', null, `Datos: ${d}`) });

  it('sin datos y cargando muestra «Cargando»', () => {
    render(vista(carga({ cargando: true })));
    expect(screen.getByText('Cargando…')).toBeTruthy();
  });

  it('sin datos y con error muestra el error con «Reintentar»', async () => {
    const recargar = vi.fn();
    render(vista(carga({ error: 'Sin conexión', recargar })));
    expect(screen.getByText('Sin conexión')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(recargar).toHaveBeenCalledTimes(1);
  });

  it('con datos los muestra; si una recarga falla, conserva el contenido y avisa «No se pudo actualizar»', async () => {
    const recargar = vi.fn();
    const { rerender } = render(vista(carga({ datos: 'uno' })));
    expect(screen.getByText('Datos: uno')).toBeTruthy();
    expect(screen.queryByText(/No se pudo actualizar/)).toBeNull();
    rerender(vista(carga({ datos: 'uno', error: 'Sin conexión', recargar })));
    expect(screen.getByText('Datos: uno')).toBeTruthy();
    expect(screen.getByText(/No se pudo actualizar/)).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(recargar).toHaveBeenCalledTimes(1);
  });
});
