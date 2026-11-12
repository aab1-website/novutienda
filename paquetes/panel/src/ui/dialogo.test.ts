// @vitest-environment jsdom
import { h, type JSX } from 'preact';
import { useState } from 'preact/hooks';
import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cuentaDeCapas } from './capas.js';
import { BotonConfirmado } from './comun.js';
import { Dialogo } from './dialogo.js';

afterEach(() => {
  cleanup();
  document.documentElement.className = '';
});

interface Opciones {
  sucio?: boolean;
  foco?: 'campo' | 'cerrar' | 'seguro';
  alCerrarEnfocar?: () => HTMLElement | null;
  quitarAlCerrar?: boolean;
  alCerrar?: () => void;
}

/** Página con un botón que abre el diálogo, un enlace de fondo y una región viva. */
function Pagina(o: Opciones): JSX.Element {
  const [abierto, setAbierto] = useState(false);
  const [hay, setHay] = useState(true);
  return h(
    'div',
    null,
    h('header', null, h('a', { href: '#/x' }, 'Enlace de fondo')),
    h('main', null, h('h1', null, 'Pantalla'), hay && h('button', { type: 'button', onClick: () => setAbierto(true) }, 'Abrir')),
    h('div', { 'data-capa-viva': '' }, h('span', null, 'aviso vivo')),
    abierto &&
      h(
        Dialogo,
        {
          titulo: 'Editar ficha',
          descripcion: 'Cambie lo que necesite.',
          sucio: o.sucio,
          foco: o.foco,
          alCerrarEnfocar: o.alCerrarEnfocar,
          onCerrar: () => {
            o.alCerrar?.();
            setAbierto(false);
            if (o.quitarAlCerrar === true) setHay(false);
          },
          pie: h('button', { type: 'button' }, 'Guardar'),
        },
        h('label', null, 'Nombre', h('input', { type: 'text' })),
        h('label', null, 'Nota', h('input', { type: 'text' })),
      ),
  );
}

async function abrir(o: Opciones = {}): Promise<ReturnType<typeof userEvent.setup>> {
  const u = userEvent.setup();
  render(h(Pagina, o));
  await u.click(screen.getByRole('button', { name: 'Abrir' }));
  return u;
}

describe('Dialogo', () => {
  it('tiene rol, título y descripción asociados, y el foco inicial va al primer campo', async () => {
    await abrir();
    const d = screen.getByRole('dialog', { name: 'Editar ficha' });
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(d.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Cambie lo que necesite.');
    expect(document.activeElement).toBe(screen.getByLabelText('Nombre'));
  });

  it('con foco «cerrar» el foco inicial va al botón de cerrar', async () => {
    await abrir({ foco: 'cerrar' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cerrar' }));
  });

  it('el foco queda atrapado: Tab y Mayús+Tab son cíclicos', async () => {
    const u = await abrir();
    // Orden: Cerrar, Nombre, Nota, Guardar; se parte de Nombre.
    await u.tab();
    expect(document.activeElement).toBe(screen.getByLabelText('Nota'));
    await u.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Guardar' }));
    await u.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cerrar' }));
    await u.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Guardar' }));
  });

  it('Esc cierra y el foco vuelve al botón que lo abrió', async () => {
    const u = await abrir();
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abrir' }));
  });

  it('un control interno puede detener el Esc', async () => {
    const alCerrar = vi.fn();
    const u = userEvent.setup();
    render(h(Dialogo, { titulo: 'T', onCerrar: alCerrar }, h('input', { 'aria-label': 'Buscar', onKeyDown: (e: KeyboardEvent) => e.stopPropagation() })));
    screen.getByLabelText('Buscar').focus();
    await u.keyboard('{Escape}');
    expect(alCerrar).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Cerrar' }).focus();
    await u.keyboard('{Escape}');
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });

  it('el botón de cerrar y el clic en el fondo cierran', async () => {
    const u = await abrir();
    await u.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Abrir' }));
    await u.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('si el control de origen ya no existe, el foco va al respaldo o, a falta de él, al título', async () => {
    const u = await abrir({ quitarAlCerrar: true });
    await u.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Pantalla' })));
    cleanup();
    const respaldo = document.createElement('button');
    respaldo.textContent = 'Respaldo';
    document.body.appendChild(respaldo);
    const u2 = await abrir({ quitarAlCerrar: true, alCerrarEnfocar: () => respaldo });
    await u2.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(respaldo));
    respaldo.remove();
  });

  it('deja inerte el fondo (menos las regiones vivas) y lo restaura al cerrar', async () => {
    const u = await abrir();
    const fondo = screen.getByText('Enlace de fondo').closest('header') as HTMLElement;
    const principal = screen.getByRole('heading', { name: 'Pantalla' }).closest('main') as HTMLElement;
    const viva = screen.getByText('aviso vivo').parentElement as HTMLElement;
    expect(fondo.hasAttribute('inert')).toBe(true);
    expect(principal.hasAttribute('inert')).toBe(true);
    expect(viva.hasAttribute('inert')).toBe(false);
    await u.keyboard('{Escape}');
    expect(fondo.hasAttribute('inert')).toBe(false);
    expect(principal.hasAttribute('inert')).toBe(false);
  });

  it('no restaura lo que ya estaba inerte antes de abrir', async () => {
    const u = userEvent.setup();
    render(h('div', null, h('aside', null, 'Lateral'), h(Pagina, { sucio: false })));
    const lateral = screen.getByText('Lateral');
    lateral.setAttribute('inert', '');
    await u.click(screen.getByRole('button', { name: 'Abrir' }));
    await u.keyboard('{Escape}');
    expect(lateral.hasAttribute('inert')).toBe(true);
  });

  it('bloquea el desplazamiento de la página con un contador (diálogos anidados)', async () => {
    const u = await abrir({ sucio: true });
    const html = document.documentElement;
    expect(html.classList.contains('sin-desplazar')).toBe(true);
    expect(cuentaDeCapas()).toBe(1);
    await u.keyboard('{Escape}');
    expect(cuentaDeCapas()).toBe(2);
    await u.click(screen.getByRole('button', { name: 'Seguir editando' }));
    expect(cuentaDeCapas()).toBe(1);
    expect(html.classList.contains('sin-desplazar')).toBe(true);
    await u.click(screen.getByRole('button', { name: 'Cerrar' }));
    await u.click(screen.getByRole('button', { name: 'Descartar cambios' }));
    expect(cuentaDeCapas()).toBe(0);
    expect(html.classList.contains('sin-desplazar')).toBe(false);
  });

  it('con cambios sin guardar, Esc, la X y el fondo preguntan antes de descartar', async () => {
    const alCerrar = vi.fn();
    const u = await abrir({ sucio: true, alCerrar });
    await u.keyboard('{Escape}');
    const pregunta = screen.getByRole('dialog', { name: '¿Descartar los cambios?' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Seguir editando' }));
    expect(alCerrar).not.toHaveBeenCalled();
    // Esc en la pregunta solo cierra la pregunta y el foco vuelve al diálogo de abajo.
    await u.keyboard('{Escape}');
    expect(pregunta.isConnected).toBe(false);
    expect(screen.getByRole('dialog', { name: 'Editar ficha' })).toBeTruthy();
    expect(alCerrar).not.toHaveBeenCalled();
    await u.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.getByRole('dialog', { name: '¿Descartar los cambios?' })).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Seguir editando' }));
    await u.click(screen.getByRole('dialog', { name: 'Editar ficha' }).parentElement as HTMLElement);
    expect(screen.getByRole('dialog', { name: '¿Descartar los cambios?' })).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Descartar cambios' }));
    expect(alCerrar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('el Tab del diálogo anidado no escapa al de abajo', async () => {
    const u = await abrir({ sucio: true });
    await u.keyboard('{Escape}');
    const pregunta = screen.getByRole('dialog', { name: '¿Descartar los cambios?' });
    await u.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Descartar cambios' }));
    await u.tab();
    expect(pregunta.contains(document.activeElement)).toBe(true);
  });
});

describe('BotonConfirmado', () => {
  function Caso(p: { alConfirmar: () => void; peligro?: boolean; resumen?: string }): JSX.Element {
    return h(
      'div',
      null,
      h('h1', null, 'Pantalla'),
      h(BotonConfirmado, { texto: 'Quitar acceso', pregunta: '¿Quitar el acceso?', textoConfirmar: 'Sí, quitar', onConfirmar: p.alConfirmar, peligro: p.peligro, resumen: p.resumen }),
    );
  }

  it('abre un diálogo centrado; «Sí, …» confirma y el foco vuelve al botón', async () => {
    const alConfirmar = vi.fn();
    const u = userEvent.setup();
    render(h(Caso, { alConfirmar, resumen: 'Perderá el ingreso.' }));
    await u.click(screen.getByRole('button', { name: 'Quitar acceso' }));
    const d = screen.getByRole('dialog', { name: '¿Quitar el acceso?' });
    expect(d.parentElement?.classList.contains('dialogo-centro')).toBe(true);
    expect(screen.getByText('Perderá el ingreso.')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Sí, quitar' }));
    expect(alConfirmar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Quitar acceso' }));
  });

  it('«Cancelar» no llama y devuelve el foco', async () => {
    const alConfirmar = vi.fn();
    const u = userEvent.setup();
    render(h(Caso, { alConfirmar }));
    await u.click(screen.getByRole('button', { name: 'Quitar acceso' }));
    await u.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(alConfirmar).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Quitar acceso' }));
  });

  it('si es peligroso, el foco inicial cae en «Cancelar»; Esc cancela', async () => {
    const alConfirmar = vi.fn();
    const u = userEvent.setup();
    render(h(Caso, { alConfirmar, peligro: true }));
    await u.click(screen.getByRole('button', { name: 'Quitar acceso' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }));
    await u.keyboard('{Escape}');
    expect(alConfirmar).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Quitar acceso' }));
  });
});
