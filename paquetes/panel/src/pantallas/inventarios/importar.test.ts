// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi } from '../../api/errores.js';
import { crearEntorno, type Entorno } from '../../ayuda-pruebas.js';
import { archivoExcelDoble } from '../../doble/inventario/importacion.js';
import { ProveedorGuardia } from '../../ui/guardia.js';
import * as escritor from './escritor-xlsx.js';
import { ImportarExportar } from './importar.js';

vi.mock('./escritor-xlsx.js', async (original) => ({ ...(await original<typeof import('./escritor-xlsx.js')>()), descargarBytes: vi.fn() }));

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
    expect(screen.getByText(/Cada producto se reconoce por su SKU/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Descargar plantilla (Excel)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Exportar productos (Excel)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Plantilla en CSV' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Exportar en CSV' })).toBeTruthy();
    expect(entradaArchivo().accept).toContain('.xlsx');
  });

  it('«Descargar plantilla (Excel)» y «Exportar productos (Excel)» bajan un .xlsx válido', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    const bajar = vi.mocked(escritor.descargarBytes);
    bajar.mockClear();
    await u.click(await screen.findByRole('button', { name: 'Descargar plantilla (Excel)' }));
    expect(bajar).toHaveBeenCalledTimes(1);
    expect(bajar.mock.calls[0]?.[0]).toBe('plantilla-productos.xlsx');
    const zip = (b: Uint8Array): boolean => b[0] === 0x50 && b[1] === 0x4b;
    expect(zip(bajar.mock.calls[0]?.[1] as Uint8Array)).toBe(true);
    await u.click(screen.getByRole('button', { name: 'Exportar productos (Excel)' }));
    expect(await screen.findByText('Archivo exportado.')).toBeTruthy();
    expect(bajar).toHaveBeenCalledTimes(2);
    expect(bajar.mock.calls[1]?.[0]).toBe('productos.xlsx');
    expect(zip(bajar.mock.calls[1]?.[1] as Uint8Array)).toBe(true);
    expect(llamadas(e, 'exportarProductosCsv')).toHaveLength(1);
  });

  it('un supervisor puede exportar pero no importar', async () => {
    const e = crearEntorno('sup');
    ver(e);
    expect(await screen.findByRole('button', { name: 'Exportar productos (Excel)' })).toBeTruthy();
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
    expect(filas[1]?.textContent).toContain('Nuevo C');
    expect(filas[1]?.textContent).not.toContain('nuevo-c');
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
    expect(llamadas(e, 'importarProductosCsv')[0]?.entrada).toMatchObject({ omitirErrores: true, cargaInicial: false, lineasOmitidas: [4] });
    expect(await screen.findByText(/Importación terminada: 2 productos creados/, { selector: '.alerta' })).toBeTruthy();
    expect(screen.getByText(/Se omitieron 1 fila con error \(líneas del archivo: 4\)/)).toBeTruthy();
    expect(screen.queryByText(/Atención: usted aceptó omitir/)).toBeNull();
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

  it('la detención se muestra sin identificadores técnicos y dice qué hacer', async () => {
    const e = crearEntorno('adm');
    e.api.estado.importacion.filasPorTanda = 1;
    e.api.estado.importacion.fallaEnTanda = 2;
    ver(e);
    const u = userEvent.setup();
    await u.upload(entradaArchivo(), csv('nuevo-a,Nuevo A,Cat,NA-1,10,11', 'nuevo-b,Nuevo B,Cat,NB-1,20,22'));
    await u.click(await screen.findByRole('button', { name: 'Importar 2 filas' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sí, importar' }));
    const alerta = await screen.findByText(/La importación quedó incompleta/);
    expect(alerta.textContent).not.toMatch(/operacionId/i);
    expect(alerta.textContent).toMatch(/Hubo un problema en la tanda 2 de 2/);
    expect(alerta.textContent).toMatch(/Pulse «Continuar la importación»/);
  });

  it('si al continuar el servidor dice que la operación tiene otro contenido, pide empezar de nuevo', async () => {
    const e = crearEntorno('adm');
    e.api.estado.importacion.filasPorTanda = 1;
    e.api.estado.importacion.fallaEnTanda = 2;
    ver(e);
    const u = userEvent.setup();
    await u.upload(entradaArchivo(), csv('nuevo-a,Nuevo A,Cat,NA-1,10,11', 'nuevo-b,Nuevo B,Cat,NB-1,20,22'));
    await u.click(await screen.findByRole('button', { name: 'Importar 2 filas' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sí, importar' }));
    await screen.findByRole('button', { name: 'Continuar la importación' });
    const original = e.api.llamar.bind(e.api);
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, en: unknown) => (n === 'importarProductosCsv'
      ? Promise.reject(new ErrorApi('already-exists', 'La operación abc ya existe con otro contenido', { codigo: 'operacion-conflicto' }))
      : original(n as never, en as never))) as never);
    await u.click(screen.getByRole('button', { name: 'Continuar la importación' }));
    const alerta = await screen.findByText(/El archivo cambió desde el intento anterior/);
    expect(alerta.textContent).toMatch(/empiece de nuevo con una importación nueva/);
    expect(document.body.textContent).not.toMatch(/abc|operacionId/);
    await u.click(screen.getByRole('button', { name: 'Empezar de nuevo' }));
    expect(screen.queryByText(/El archivo cambió/)).toBeNull();
  });

  it('si el servidor omite más filas de las que la persona aceptó, lo dice destacado con las líneas', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    await u.upload(entradaArchivo(), mixto());
    await screen.findByRole('table', { name: 'Simulación de la importación' });
    const original = e.api.llamar.bind(e.api);
    vi.spyOn(e.api, 'llamar').mockImplementation((async (n: string, en: unknown) => {
      const r = await original(n as never, en as never);
      if (n !== 'importarProductosCsv') return r;
      const res = r as { omitidas: number; simulacion: { filas: { linea: number; accion: string }[] } };
      return { ...res, omitidas: 2, simulacion: { ...res.simulacion, filas: res.simulacion.filas.map((f) => (f.linea === 2 ? { ...f, accion: 'error', errores: [], advertencias: [], cambios: [] } : f)) } };
    }) as never);
    await u.click(screen.getByRole('button', { name: 'Importar las filas válidas y omitir las 1 con error' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sí, importar y omitir las filas con error' }));
    const aviso = await screen.findByText(/Atención: usted aceptó omitir 1 fila \(líneas: 4\) y el servidor omitió 2/);
    expect(aviso.closest('.alerta')?.getAttribute('role')).toBe('alert');
    expect(screen.getByText(/Se omitieron 2 filas con error \(líneas del archivo: 2, 4\)/)).toBeTruthy();
  });

  it('si el servidor responde desactualizada no dice que importó, muestra la simulación nueva, pide confirmar otra vez y usa otro operacionId', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    await u.upload(entradaArchivo(), mixto());
    await screen.findByRole('table', { name: 'Simulación de la importación' });
    const original = e.api.llamar.bind(e.api);
    let primera = true;
    const ids: unknown[] = [];
    vi.spyOn(e.api, 'llamar').mockImplementation((async (n: string, en: unknown) => {
      if (n === 'importarProductosCsv') ids.push((en as Record<string, unknown>)['operacionId']);
      if (n !== 'importarProductosCsv' || !primera) return original(n as never, en as never);
      primera = false;
      const sim = await original('simularImportacionProductos', { archivo: (en as { archivo: string }).archivo } as never);
      return { completa: false, desactualizada: true, creados: 0, actualizados: 0, sinCambios: 0, omitidas: 0, lotes: { total: 0, aplicados: 0 }, productos: [], detencion: 'x', simulacion: { ...sim, resumen: { ...sim.resumen, sinCambios: 9 } } };
    }) as never);
    await u.click(screen.getByRole('button', { name: 'Importar las filas válidas y omitir las 1 con error' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sí, importar y omitir las filas con error' }));
    expect(await screen.findByText('Los datos cambiaron desde la simulación. Revise la simulación nueva antes de importar.')).toBeTruthy();
    expect(screen.queryByText(/Importación terminada/)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(/9 sin cambios/)).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Importar las filas válidas y omitir las 1 con error' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sí, importar y omitir las filas con error' }));
    expect(await screen.findByText(/Importación terminada: 2 productos creados/, { selector: '.alerta' })).toBeTruthy();
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(screen.queryByText(/Los datos cambiaron/)).toBeNull();
  });
});

describe('importar: columnas según los mercados declarados', () => {
  it('el comercio de referencia ve las columnas y la nota de siempre', async () => {
    const e = crearEntorno('adm');
    ver(e);
    expect(await screen.findByText('precioBO')).toBeTruthy();
    expect(screen.getByText('precioAR')).toBeTruthy();
    expect(screen.getByText(/precio del mercado de Bolivia, en dólares con hasta 2 decimales \(por ejemplo 1234.50\)/)).toBeTruthy();
    expect(screen.getByText(/Los precios van en dólares, con decimales/)).toBeTruthy();
    expect(screen.getByText(/costo en dólares con hasta 2 decimales \(opcional\)/)).toBeTruthy();
  });

  it('un comercio de un mercado y una moneda ve una sola columna de precio y su moneda', async () => {
    const e = crearEntorno('adm', undefined, { comercial: { mercados: [{ id: 'PE', nombre: 'Perú', monedaVenta: 'PEN', monedaBase: 'PEN', tieneTipoCambio: false }], monedasCaja: ['PEN'], monedaCosto: 'PEN' } });
    ver(e);
    expect(await screen.findByText('precioPE')).toBeTruthy();
    expect(screen.queryByText('precioBO')).toBeNull();
    expect(screen.queryByText('precioAR')).toBeNull();
    expect(screen.getByText(/costo en PEN con hasta 2 decimales/)).toBeTruthy();
    expect(screen.getByText(/Los precios van en PEN, con decimales/)).toBeTruthy();
  });

  it('con un comercio de un solo mercado, la simulación y el resultado usan solo su columna de precio', async () => {
    const comercial = { mercados: [{ id: 'PE', nombre: 'Perú', monedaVenta: 'PEN', monedaBase: 'PEN', tieneTipoCambio: false }], monedasCaja: ['PEN'], monedaCosto: 'PEN' } as const;
    const e = crearEntorno('adm', undefined, { comercial: { ...comercial, mercados: [...comercial.mercados], monedasCaja: [...comercial.monedasCaja] } });
    const texto = 'id,nombre,categoria,sku,precioPE\r\nnuevo-pe,Nuevo PE,Cat,PE-1,12.50\r\nnuevo-bo,Nuevo BO,Cat,PE-2,\r\n';
    const sim = await e.api.llamar('simularImportacionProductos', { csv: texto });
    expect(sim.resumen).toMatchObject({ crear: 2, errores: 0 });
    expect(sim.filas[1]?.advertencias.join(' ')).toMatch(/sin precio/);
    const r = await e.api.llamar('importarProductosCsv', { operacionId: 'op-un-mercado', csv: texto });
    expect(r).toMatchObject({ completa: true, creados: 2 });
    const lista = await e.api.llamar('listarProductos', {});
    expect(lista.find((p) => p.id === 'nuevo-pe')?.precioUSD).toEqual({ pe: 1250 });
    expect(lista.find((p) => p.id === 'nuevo-bo')?.precioUSD).toEqual({ pe: 0 });
    const ajeno = await e.api.llamar('simularImportacionProductos', { csv: 'id,nombre,categoria,sku,precioBO\r\nx-1,X,Cat,X-1,5\r\n' });
    expect(ajeno.columnasIgnoradas).toContain('precioBO');
  });
});

describe('importar: el producto se reconoce por su SKU (el doble se comporta como el servidor)', () => {
  const CAB_SIN_ID = 'nombre,categoria,sku,precioBO,precioAR\r\n';

  it('sin columna id: crea con clave generada, actualiza por SKU y no repite al reintentar', async () => {
    const e = crearEntorno('adm');
    const base = (await e.api.llamar('listarProductos', {})).length;
    const csv = `${CAB_SIN_ID}Taladro Bosch,Herr,TAL-1,10,11\r\nTaladro Bosch,Herr,TAL-2,12,13\r\n`;
    const sim = await e.api.llamar('simularImportacionProductos', { csv });
    expect(sim.resumen).toMatchObject({ crear: 2, errores: 0 });
    expect(sim.filas.map((f) => (f as { sku?: string }).sku)).toEqual(['TAL-1', 'TAL-2']);
    await e.api.llamar('importarProductosCsv', { operacionId: 'op-sin-id', csv });
    const lista = await e.api.llamar('listarProductos', {});
    expect(lista.length).toBe(base + 2);
    expect(lista.filter((p) => p.id.startsWith('taladro-bosch')).map((p) => p.id).sort()).toEqual(['taladro-bosch', 'taladro-bosch-2']);
    const otra = await e.api.llamar('importarProductosCsv', { operacionId: 'op-sin-id-2', csv });
    expect(otra).toMatchObject({ creados: 0 });
    expect((await e.api.llamar('listarProductos', {})).length).toBe(base + 2);
  });

  it('id y SKU de productos distintos: error claro; `codigo` es el SKU; fila sin id ni SKU es error', async () => {
    const e = crearEntorno('adm');
    const [a, b] = await e.api.llamar('listarProductos', {});
    const cruzado = await e.api.llamar('simularImportacionProductos', { csv: `id,nombre,categoria,sku\r\n${a?.id ?? ''},X,C,${b?.sku ?? ''}\r\n` });
    expect(cruzado.filas[0]?.errores[0]?.motivo).toBe(`el SKU pertenece a otro producto (${b?.nombre ?? ''})`);
    const porCodigo = await e.api.llamar('simularImportacionProductos', { csv: `codigo,nombre,categoria\r\n${a?.sku ?? ''},${a?.nombre ?? ''},${a?.categoria ?? ''}\r\n` });
    expect(porCodigo.filas[0]?.accion).toBe('sin-cambios');
    const sinSku = await e.api.llamar('simularImportacionProductos', { csv: 'nombre,categoria,sku\r\nX,C,\r\n' });
    expect(sinSku.filas[0]?.errores[0]).toMatchObject({ columna: 'sku' });
  });

  it('exportar y volver a importar no cambia nada, y la planilla sale sin la columna id', async () => {
    const e = crearEntorno('adm');
    const { csv } = await e.api.llamar('exportarProductosCsv', {});
    expect(csv.split('\n')[0]?.split(',')).not.toContain('id');
    const sim = await e.api.llamar('simularImportacionProductos', { csv });
    expect(sim.resumen).toMatchObject({ crear: 0, actualizar: 0, errores: 0 });
  });

  it('un SKU que solo difiere en mayúsculas se permite, con aviso', async () => {
    const e = crearEntorno('adm');
    const [a] = await e.api.llamar('listarProductos', {});
    const raro = (a?.sku ?? '').toLowerCase() === a?.sku ? (a?.sku ?? '').toUpperCase() : (a?.sku ?? '').toLowerCase();
    const sim = await e.api.llamar('simularImportacionProductos', { csv: `${CAB_SIN_ID}Nuevo,C,${raro},1,1\r\n` });
    expect(sim.filas[0]).toMatchObject({ accion: 'crear' });
    expect(sim.filas[0]?.advertencias).toContain('Se parece al SKU de otro producto (difiere solo en mayúsculas)');
  });

  it('Excel recortó los ceros del SKU: error, sin duplicar; nombre repetido avisa; planilla vieja con codigo falla claro', async () => {
    const e = crearEntorno('adm');
    const precioUSD = { bo: 100, ar: 100 } as never;
    await e.api.llamar('crearProducto', { operacionId: 'op-cero', producto: { id: 'cero', nombre: 'Con ceros', categoria: 'C', sku: '00123', precioUSD } });
    const ceros = await e.api.llamar('simularImportacionProductos', { csv: `${CAB_SIN_ID}Otro,C,123,1,1\r\n` });
    expect(ceros.filas[0]?.accion).toBe('error');
    expect(ceros.filas[0]?.errores[0]?.motivo).toMatch(/Excel quitó ceros a la izquierda/);
    const nombre = await e.api.llamar('simularImportacionProductos', { csv: `${CAB_SIN_ID}"  con   CEROS ",C,NUEVO-9,1,1\r\n` });
    expect(nombre.filas[0]).toMatchObject({ accion: 'crear' });
    expect(nombre.filas[0]?.advertencias).toContain('Ya existe un producto con ese nombre');
    const vieja = await e.api.llamar('simularImportacionProductos', { csv: 'codigo,nombre,categoria\r\ncero,X,C\r\n' });
    expect(vieja.filas[0]?.errores[0]?.motivo).toMatch(/La columna codigo ahora es el SKU/);
    const sinSku = await e.api.llamar('simularImportacionProductos', { csv: 'nombre,categoria,sku\r\nX,C,\r\n' });
    expect(sinSku.filas[0]?.errores[0]?.motivo).toBe('Falta el SKU: cada producto se reconoce por su SKU');
  });

  it('«123» actualiza el SKU exacto y avisa de «0123»; `codigo` ambiguo (SKU de uno y clave de otro) es error', async () => {
    const e = crearEntorno('adm');
    const precioUSD = { bo: 100, ar: 100 } as never;
    await e.api.llamar('crearProducto', { operacionId: 'o1', producto: { id: 'cero', nombre: 'Cero', categoria: 'C', sku: '0123', precioUSD } });
    await e.api.llamar('crearProducto', { operacionId: 'o2', producto: { id: 'exacto', nombre: 'Exacto', categoria: 'C', sku: '123', precioUSD } });
    const sim = await e.api.llamar('simularImportacionProductos', { csv: `${CAB_SIN_ID}Otro,C,123,1,1\r\n` });
    expect(sim.filas[0]?.accion).toBe('actualizar');
    expect(sim.filas[0]?.advertencias).toContain('Existe otro producto con SKU 0123: verifique que Excel no haya quitado ceros a la izquierda');
    await e.api.llamar('crearProducto', { operacionId: 'o3', producto: { id: 'lapiz', nombre: 'Lápiz', categoria: 'C', sku: 'LAP-1', precioUSD } });
    await e.api.llamar('crearProducto', { operacionId: 'o4', producto: { id: 'goma', nombre: 'Goma', categoria: 'C', sku: 'lapiz', precioUSD } });
    const amb = await e.api.llamar('simularImportacionProductos', { csv: 'codigo,nombre,categoria\r\nlapiz,X,C\r\n' });
    expect(amb.filas[0]?.errores[0]?.motivo).toMatch(/ambigua/);
  });
});
