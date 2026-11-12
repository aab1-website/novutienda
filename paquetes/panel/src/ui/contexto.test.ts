// @vitest-environment jsdom
import { h, type JSX } from 'preact';
import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { crearEntorno } from '../ayuda-pruebas.js';
import { useApp } from './contexto.js';

afterEach(cleanup);

function Sonda({ seccion }: { seccion: string }): JSX.Element {
  return h('p', null, `${seccion}:${useApp().puedeVer(seccion) ? 'si' : 'no'}`);
}

describe('puedeVer en el contexto', () => {
  it('depende del rol y de los módulos activos; Central no depende de módulos', () => {
    const e = crearEntorno('adm');
    e.modulos = ['pos'];
    render(e.envolver(h('div', null, h(Sonda, { seccion: 'catalogo' }), h(Sonda, { seccion: 'usuarios' }), h(Sonda, { seccion: 'inexistente' }))));
    expect(screen.getByText('catalogo:no')).toBeTruthy();
    expect(screen.getByText('usuarios:si')).toBeTruthy();
    expect(screen.getByText('inexistente:no')).toBeTruthy();
    cleanup();
    e.modulos = ['pos', 'consola'];
    render(e.envolver(h(Sonda, { seccion: 'catalogo' })));
    expect(screen.getByText('catalogo:si')).toBeTruthy();
  });

  it('falla cerrado sin módulos y respeta el rol', () => {
    const e = crearEntorno('caj');
    e.modulos = null;
    render(e.envolver(h('div', null, h(Sonda, { seccion: 'catalogo' }), h(Sonda, { seccion: 'usuarios' }))));
    expect(screen.getByText('catalogo:no')).toBeTruthy();
    expect(screen.getByText('usuarios:no')).toBeTruthy();
  });
});
