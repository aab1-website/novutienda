// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { crearEntorno } from '../../ayuda-pruebas.js';
import { PestanaPlantillaRecibo } from './plantilla.js';

afterEach(cleanup);

describe('Plantilla del recibo: vista previa', () => {
  it('la vista previa cambia mientras se escribe el pie', async () => {
    const e = crearEntorno('adm');
    const u = userEvent.setup();
    render(e.envolver(h(PestanaPlantillaRecibo, {})));
    const campo = await screen.findByLabelText('Pie de página');
    const vista = screen.getByRole('region', { name: 'Vista previa del recibo' });
    expect(within(vista).getByText('Producto de ejemplo con serie')).toBeTruthy();
    expect(within(vista).queryByText('Gracias por su compra, vuelva pronto')).toBeNull();
    await u.clear(campo);
    await u.type(campo, 'Gracias por su compra, vuelva pronto');
    expect(await within(vista).findByText('Gracias por su compra, vuelva pronto')).toBeTruthy();
    const garantia = screen.getByLabelText('Política de garantía');
    await u.clear(garantia);
    await u.type(garantia, 'Garantia de doce meses');
    expect(await within(vista).findByText(/Garantia de doce meses/)).toBeTruthy();
    const cambios = screen.getByLabelText('Política de cambios');
    await u.clear(cambios);
    await u.type(cambios, 'Cambios dentro de siete dias');
    expect(await within(vista).findByText(/Cambios dentro de siete dias/)).toBeTruthy();
  });
});
