// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearEntorno, type Entorno } from '../../ayuda-pruebas.js';
import { archivoExcelDoble } from '../../doble/inventario/importacion.js';
import { ProveedorGuardia } from '../../ui/guardia.js';
import { ImportarExportar } from './importar.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ver = (e: Entorno): void => void render(e.envolver(h(ProveedorGuardia, null, h(ImportarExportar, {}))));
const entradaArchivo = (): HTMLInputElement => screen.getByLabelText('Archivo de productos (CSV o Excel)') as HTMLInputElement;
const llamadas = (e: Entorno, nombre: string): { entrada: Record<string, unknown> }[] => e.api.llamadas.filter((l) => l.nombre === nombre) as never;
const CABECERA = 'id,nombre,categoria,sku,precioBO,precioAR\r\n';
const csv = (...filas: string[]): File => new File([CABECERA + filas.join('\r\n') + '\r\n'], 'productos.csv', { type: 'text/csv' });
/** 2 nuevos válidos, 1 sin SKU (error) y 1 existente sin cambios de precio. */
const mixto = (): File => csv('nuevo-a,Nuevo A,Cat,NA-1,10.50,11', 'nuevo-b,Nuevo B,Cat,NB-1,20,22.25', 'nuevo-c,Nuevo C,Cat,,5,6');

describe('importar: qué es y cómo se arma el archivo', () => {
  it('explica para qué sirve, el formato y ofrece plantilla y exportación', async () => {
    const e = crearEntorno('adm');
    ver(e);
    expect(await screen.findByText(/carga inicial/, { selector: 'strong' })).toBeTruthy();
    expect(screen.getByText(/actualizar muchos a la vez/)).toBeTruthy();
    expect(screen.getByText(/solo por Inventario/)).toBeTruthy();
    expect(screen.getByText('Qué columnas lleva el archivo')).toBeTruthy();
    expect(screen.getByText(/Una fila nueva sin SKU es un error/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Descargar plantilla' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Exportar productos' })).toBeTruthy();
    expect(entradaArchivo().accept).toContain('.xlsx');
  });

  it('un supervisor puede exportar pero no importar', async () => {
    const e = crearEntorno('sup');
    ver(e);
    expect(await screen.findByRole('button', { name: 'Exportar productos' })).toBeTruthy();
    expect(screen.queryByLabelText('Archivo de productos (CSV o Excel)')).toBeNull();
    expect(screen.getByText('La importación la hace un administrador.')).toBeTruthy();
  });

  it('rechaza antes de leer un archivo de otro tipo o de más de 2 MB, con el error junto al campo', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup({ applyAccept: false });
    await u.upload(entradaArchivo(), new File(['x'], 'foto.png', { type: 'image/png' }));
    expect(await screen.findByText(/Solo se admiten archivos CSV/)).toBeTruthy();
    const grande = new File(['x'], 'grande.csv', { type: 'text/csv' });
    Object.defineProperty(grande, 'size', { value: 3 * 1024 * 1024 });
    await u.upload(entradaArchivo(), grande);
    expect(await screen.findByText(/el máximo es 2,0 MB/)).toBeTruthy();
    expect(llamadas(e, 'simularImportacionProductos')).toHaveLength(0);
  });
});

describe('importar: siempre simulación primero', () => {
  it('elegir el archivo simula y no importa; muestra el resumen, errores primero y el error por columna', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    await u.upload(entradaArchivo(), mixto());
    expect(await screen.findByText('2 se crearán, 0 se actualizarán, 0 sin cambios, 1 con error.')).toBeTruthy();
    expect(llamadas(e, 'importarProductosCsv')).toHaveLength(0);
    const t = screen.getByRole('table', { name: 'Simulación de la importación' });
    const filas = within(t).getAllByRole('row');
    expect(filas[1]?.textContent).toContain('nuevo-c');
    expect(filas[1]?.textContent).toContain('Columna «sku»: es obligatorio para crear');
    expect(filas[1]?.textContent).toContain('Con error');
  });

  it('filtra por acción', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    await u.upload(entradaArchivo(), mixto());
    const t = await screen.findByRole('table', { name: 'Simulación de la importación' });
    await u.selectOptions(screen.getByLabelText('Acción'), 'error');
    expect(within(screen.getByRole('table', { name: 'Simulación de la importación' })).queryByText('nuevo-a')).toBeNull();
    expect(t).toBeTruthy();
  });

  it('avisa de las columnas ignoradas', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    await u.upload(entradaArchivo(), new File(['id,nombre,categoria,sku,precioBO,precioAR,color\r\nn-1,N,C,N-1,1,1,rojo\r\n'], 'p.csv'));
    expect(await screen.findByText(/Estas columnas no se usan y se ignoran: color/)).toBeTruthy();
  });

  it('con errores, importar todo queda con su motivo y omitir es una opción explícita que lo dice', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    await u.upload(entradaArchivo(), mixto());
    await screen.findByRole('table', { name: 'Simulación de la importación' });
    expect(screen.getByText(/El archivo tiene 1 fila con error/)).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Importar 2 filas' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Importar las filas válidas y omitir las 1 con error' }));
    const d = await screen.findByRole('dialog', { name: '¿Importar solo las filas válidas?' });
    expect(d.textContent).toContain('se omiten 1 fila con error');
    await u.click(within(d).getByRole('button', { name: 'Sí, importar y omitir las filas con error' }));
    await waitFor(() => expect(llamadas(e, 'importarProductosCsv')).toHaveLength(1));
    expect(llamadas(e, 'importarProductosCsv')[0]?.entrada).toMatchObject({ omitirErrores: true, cargaInicial: false });
    expect(await screen.findByText(/Importación terminada: 2 productos creados/, { selector: '.alerta' })).toBeTruthy();
    expect((await e.api.llamar('listarProductos', {})).some((p) => p.id === 'nuevo-a' && p.precioUSD.bo === 1050)).toBe(true);
  });

  it('sin errores, confirma en diálogo con el resumen y no importa antes', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    await u.upload(entradaArchivo(), csv('nuevo-a,Nuevo A,Cat,NA-1,10.50,11'));
    await u.click(await screen.findByRole('button', { name: 'Importar 1 fila' }));
    const d = await screen.findByRole('dialog', { name: '¿Importar este archivo?' });
    expect(d.textContent).toContain('1 se creará');
    expect(d.textContent).toContain('El archivo no modifica el stock');
    expect(llamadas(e, 'importarProductosCsv')).toHaveLength(0);
    await u.click(within(d).getByRole('button', { name: 'Sí, importar' }));
    expect(await screen.findByText(/Importación terminada/, { selector: '.alerta' })).toBeTruthy();
    expect(llamadas(e, 'importarProductosCsv')[0]?.entrada['omitirErrores']).toBe(false);
  });

  it('acepta Excel', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    const bytes = Uint8Array.from(atob(archivoExcelDoble(CABECERA + 'xl-1,Hoja,Cat,XL-1,3,3\r\n')), (c) => c.charCodeAt(0));
    await u.upload(entradaArchivo(), new File([bytes], 'productos.xlsx'));
    expect(await screen.findByText('1 se creará, 0 se actualizará, 0 sin cambios, 0 con error.'.replace('0 se actualizará', '0 se actualizarán'))).toBeTruthy();
  });

  it('la carga inicial se explica, vuelve a simular y viaja como cargaInicial', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    await u.upload(entradaArchivo(), new File(['id,nombre,categoria,sku,precioBO,precioAR,stockTienda\r\nini-1,Ini,C,I-1,1,1,7\r\n'], 'ini.csv'));
    // Sin marcar «carga inicial», el servidor rechaza las columnas de existencias y la pantalla dice cómo seguir.
    expect(await screen.findByText(/marque «Es la carga inicial»/)).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Simulación de la importación' })).toBeNull();
    await u.click(screen.getByLabelText('Es la carga inicial: el archivo trae existencias'));
    await u.click(await screen.findByRole('button', { name: 'Importar 1 fila' }));
    const d = await screen.findByRole('dialog');
    expect(d.textContent).toContain('Es la carga inicial');
    await u.click(within(d).getByRole('button', { name: 'Sí, importar' }));
    await waitFor(() => expect(llamadas(e, 'importarProductosCsv')[0]?.entrada).toMatchObject({ cargaInicial: true }));
    await waitFor(async () => expect((await e.api.llamar('listarProductos', {})).find((p) => p.id === 'ini-1')?.existencias.tienda).toBe(7));
  });
});

describe('importar: por tandas', () => {
  it('si se detiene dice qué se aplicó y «Continuar» usa el mismo operacionId', async () => {
    const e = crearEntorno('adm');
    e.api.estado.importacion.filasPorTanda = 1;
    e.api.estado.importacion.fallaEnTanda = 2;
    ver(e);
    const u = userEvent.setup();
    await u.upload(entradaArchivo(), csv('nuevo-a,Nuevo A,Cat,NA-1,10,11', 'nuevo-b,Nuevo B,Cat,NB-1,20,22', 'nuevo-d,Nuevo D,Cat,ND-1,5,6'));
    await u.click(await screen.findByRole('button', { name: 'Importar 3 filas' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sí, importar' }));
    expect(await screen.findByText(/La importación quedó incompleta: 1 de 3 tandas aplicadas/)).toBeTruthy();
    expect(screen.getByText(/Ya se aplicó: 1 producto creado/)).toBeTruthy();
    delete e.api.estado.importacion.fallaEnTanda;
    await u.click(screen.getByRole('button', { name: 'Continuar la importación' }));
    expect(await screen.findByText(/Importación terminada: 3 productos creados/, { selector: '.alerta' })).toBeTruthy();
    const ids = llamadas(e, 'importarProductosCsv').map((l) => l.entrada['operacionId']);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect((await e.api.llamar('listarProductos', {})).filter((p) => p.id.startsWith('nuevo-')).length).toBe(3);
  });
});
