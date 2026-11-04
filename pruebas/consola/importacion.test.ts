import { beforeEach, describe, expect, it } from 'vitest';
import {
  aCsv, ErrorConsola, exportarProductosCsv, importarProductos, neutralizarCelda, parsearCsv, simularImportacion, type DepsImportacion, type LectorHojas,
} from '@novutienda/consola';
import { rutaContador } from '@novutienda/nucleo';
import { actor, CatalogoDoble, nuevaDb, RelojFijo, T } from './dobles.js';

const bytes = (s: string): Uint8Array => new Uint8Array([...Buffer.from(s, 'utf8')]);
const adm = actor('adm');

describe('csv', () => {
  it('parsea comillas, comas y saltos de línea dentro de comillas, CRLF y punto y coma', () => {
    expect(parsearCsv('a,b\r\n"x, y","l1\nl2"\r\n"di ""hola""",z')).toEqual([['a', 'b'], ['x, y', 'l1\nl2'], ['di "hola"', 'z']]);
    expect(parsearCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(() => parsearCsv('a,"sin cerrar')).toThrow(/Comillas/);
  });
  it('neutraliza = + - @ al exportar y no duplica la neutralización', () => {
    for (const c of ['=1+1', '+5', '-2', '@SUMA(A1)']) expect(neutralizarCelda(c)).toBe(`'${c}`);
    expect(neutralizarCelda("'=1")).toBe("'=1");
    expect(neutralizarCelda('normal')).toBe('normal');
    expect(aCsv([['=HYPERLINK("x")', 'a,b']])).toBe('"\'=HYPERLINK(""x"")","a,b"\r\n');
  });
});

describe('importación', () => {
  let db: ReturnType<typeof nuevaDb>;
  let catalogo: CatalogoDoble;
  let deps: DepsImportacion;
  beforeEach(() => {
    db = nuevaDb();
    catalogo = new CatalogoDoble(db);
    deps = { db, catalogo, reloj: new RelojFijo() };
  });
  const entrada = (csv: string, a = adm) => ({ tenantId: T, actor: a, contenido: bytes(csv) });

  it('simula fila por fila sin escribir: crear, actualizar, sin cambios y errores', async () => {
    catalogo.agregar('cam-1', { nombre: 'Cámara', categoria: 'video', precioUSD: { bo: 10, ar: 12 } });
    catalogo.agregar('cam-2', { nombre: 'Otra', categoria: 'video', precioUSD: { bo: 5, ar: 6 } });
    const csv = [
      'id,nombre,categoria,marca,precio_bo,precio_ar',
      'cam-1,Cámara,video,,10,12', // sin cambios
      'cam-2,Otra,video,Acme,5,7', // actualizar
      'cam-3,Nueva,video,,"20,50",25', // crear
      'MALO!,x,y,,1,1', // id inválido
      ',x,y,,1,1', // sin id
      'cam-4,,video,,1,1', // falta nombre
      'cam-5,X,video,,-5,1', // precio negativo
      'cam-6,X,video,,=1+1,1', // fórmula como precio
      'cam-3,Repetida,video,,1,1', // id repetido
    ].join('\n');
    const antes = JSON.stringify([...db.docs]);
    const s = await simularImportacion(deps, entrada(csv));
    expect(s.filas.map((f) => f.accion)).toEqual(['sin-cambios', 'actualizar', 'crear', 'error', 'error', 'error', 'error', 'error', 'error']);
    expect(s.resumen).toEqual({ crear: 1, actualizar: 1, sinCambios: 1, errores: 6 });
    expect(s.filas[2]?.cambios.precio).toEqual({ bo: 20.5, ar: 25 });
    expect(s.filas[0]?.linea).toBe(2);
    expect(JSON.stringify([...db.docs])).toBe(antes);
    expect(catalogo.llamadas).toEqual([]);
  });

  it('el SKU no se edita: un producto existente con otro SKU es error y con el mismo no genera cambios; garantía de 1 a 120', async () => {
    catalogo.agregar('cam-1', { sku: 'CAM-1' });
    const s = await simularImportacion(deps, entrada('id,sku,garantia\ncam-1,OTRO,12\ncam-1x,CAM-9,0\ncam-2,CAM-2,121\ncam-3,CAM-3,120'));
    expect(s.filas.map((f) => f.accion)).toEqual(['error', 'error', 'error', 'error']);
    expect(s.filas[0]?.errores.join(' ')).toContain('no se edita');
    expect(s.filas[1]?.errores.join(' ')).toContain('entero de 1 a 120');
    expect(s.filas[3]?.errores.join(' ')).not.toContain('garantiaMeses');
    const igual = await simularImportacion(deps, entrada('id,sku\ncam-1,CAM-1'));
    expect(igual.filas[0]?.accion).toBe('sin-cambios');
  });

  it('el CSV no toca stock: las columnas de stock se ignoran con aviso', async () => {
    catalogo.agregar('cam-1');
    const s = await simularImportacion(deps, entrada('id,nombre,stock,cantidad\ncam-1,Nuevo nombre,500,9'));
    expect(s.columnasIgnoradas.join(' ')).toContain('no modifica el stock');
    expect(s.filas[0]?.cambios.datos).toEqual({ nombre: 'Nuevo nombre' });
    await importarProductos(deps, entrada('id,nombre,stock\ncam-1,Nuevo nombre,500'));
    expect(catalogo.existencias.size).toBe(0);
    expect(catalogo.llamadas).toEqual(['datos:cam-1']);
  });

  it('neutraliza celdas de texto que empiezan con = + - @', async () => {
    const s = await simularImportacion(deps, entrada('id,nombre,categoria\ncam-1,=CMD(),+x\ncam-2,@a,-b'));
    expect(s.filas[0]?.cambios.datos).toEqual({ nombre: "'=CMD()", categoria: "'+x" });
    expect(s.filas[0]?.advertencias.filter((a) => a.includes('fórmula'))).toHaveLength(2);
    expect(s.filas[1]?.cambios.datos).toEqual({ nombre: "'@a", categoria: "'-b" });
  });

  it('rechaza HTML y textos largos en los campos', async () => {
    const s = await simularImportacion(deps, entrada(`id,nombre,categoria\ncam-1,<img src=x>,a\ncam-2,${'x'.repeat(121)},a`));
    expect(s.filas.map((f) => f.accion)).toEqual(['error', 'error']);
  });

  it('producto 201: la fila que supera el tope del plan se marca como error en la simulación', async () => {
    for (let i = 0; i < 199; i += 1) catalogo.agregar(`p-${String(i).padStart(3, '0')}`);
    const s = await simularImportacion(deps, entrada('id,nombre,categoria\nnuevo-1,A,x\nnuevo-2,B,x'));
    expect(s.filas.map((f) => f.accion)).toEqual(['crear', 'error']);
    expect(s.filas[1]?.errores.join(' ')).toContain('200 productos');
  });

  it('producto 201: si el catálogo lanza LimiteDelPlan al crear, la fila falla y las demás siguen', async () => {
    db.poner(rutaContador(T), { productos: 199 });
    const r = await importarProductos(deps, entrada('id,nombre,categoria\nnuevo-1,A,x\nnuevo-2,B,x'));
    expect(r.aplicadas).toBe(1);
    expect(r.fallidas).toEqual([{ linea: 3, id: 'nuevo-2', motivo: expect.stringContaining('200 productos') as string }]);
    expect(db.dato(rutaContador(T))).toEqual({ productos: 200 });
  });

  it('importa: crea con precio 0 si falta, actualiza precio mezclando el otro mercado, anota cambio y auditoría', async () => {
    catalogo.agregar('cam-1', { precioUSD: { bo: 10, ar: 12 } });
    db.poner(rutaContador(T), { productos: 1 });
    const r = await importarProductos(deps, entrada('id,nombre,categoria,precio_bo\ncam-1,,,15\ncam-9,Nueva,video,\n'));
    expect(r.aplicadas).toBe(2);
    expect(catalogo.productos.get('cam-1')?.precioUSD).toEqual({ bo: 15, ar: 12 });
    expect(catalogo.productos.get('cam-9')?.precioUSD).toEqual({ bo: 0, ar: 0 });
    expect(r.simulacion.filas[1]?.advertencias.join(' ')).toContain('a consultar');
    expect(db.dato(`tenants/${T}/sitio/estado`)).toMatchObject({ cambios: 1 });
    expect(db.coleccion(`tenants/${T}/auditoria`)[0]).toMatchObject({ accion: 'productos.importar', resumenDespues: { aplicadas: 2, fallidas: 0 } });
  });

  it('con errores no importa nada, salvo que se pida omitirlos', async () => {
    const csv = 'id,nombre,categoria\ncam-1,A,x\nMAL!,B,x';
    await expect(importarProductos(deps, entrada(csv))).rejects.toMatchObject({ codigo: 'entrada-invalida', detalles: [expect.stringContaining('línea 3') as string] });
    expect(catalogo.productos.size).toBe(0);
    const r = await importarProductos(deps, { ...entrada(csv), omitirErrores: true });
    expect(r.aplicadas).toBe(1);
  });

  it('solo adm importa o simula (sup, caj y otro tenant, no)', async () => {
    for (const a of [actor('sup'), actor('caj'), actor('adm', 'otro')]) {
      await expect(simularImportacion(deps, entrada('id\nx', a))).rejects.toMatchObject({ codigo: 'no-autorizado' });
      await expect(importarProductos(deps, entrada('id\nx', a))).rejects.toMatchObject({ codigo: 'no-autorizado' });
    }
  });

  it('valida el archivo: vacío, sin columna id, demasiado grande, demasiadas filas, no UTF-8, Excel sin lector', async () => {
    await expect(simularImportacion(deps, { tenantId: T, actor: adm, contenido: new Uint8Array() })).rejects.toBeInstanceOf(ErrorConsola);
    await expect(simularImportacion(deps, entrada('nombre\nx'))).rejects.toThrow(/id/);
    await expect(simularImportacion(deps, { tenantId: T, actor: adm, contenido: new Uint8Array(3 * 1024 * 1024).fill(97) })).rejects.toThrow(/2 MB/);
    const filas = Array.from({ length: 1001 }, (_, i) => `p-${String(i)}`).join('\n');
    await expect(simularImportacion(deps, entrada(`id\n${filas}`))).rejects.toThrow(/Máximo/);
    await expect(simularImportacion(deps, { tenantId: T, actor: adm, contenido: new Uint8Array([0x69, 0x64, 0x0a, 0xff, 0xfe]) })).rejects.toThrow(/UTF-8/);
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
    await expect(simularImportacion(deps, { tenantId: T, actor: adm, contenido: zip })).rejects.toMatchObject({ codigo: 'no-disponible' });
  });

  it('Excel: delega en el lector de hojas y valida igual', async () => {
    const lector: LectorHojas = { leerPrimeraHoja: () => Promise.resolve([['ID', 'Nombre', 'Categoría'], ['x-1', 'Algo', 'cat']]) };
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
    const s = await simularImportacion({ ...deps, lector }, { tenantId: T, actor: adm, contenido: zip });
    expect(s.filas[0]?.accion).toBe('crear');
  });

  it('acepta BOM y punto y coma, y exporta con neutralización y sin stock', async () => {
    const s = await simularImportacion(deps, entrada('﻿id;nombre;categoria\ncam-1;Cámara;video'));
    expect(s.filas[0]?.accion).toBe('crear');
    const csv = exportarProductosCsv([{ id: 'cam-1', nombre: '=EVIL()', categoria: 'video', activo: true, disponible: true, precioUSD: { bo: 1.5, ar: 2 }, stockTotal: 99 }]);
    expect(csv.startsWith('﻿id,nombre')).toBe(true);
    expect(csv).toContain("'=EVIL()");
    expect(csv).not.toContain('99');
    // ida y vuelta
    const re = await simularImportacion(deps, { tenantId: T, actor: adm, contenido: bytes(csv) });
    expect(re.filas[0]?.accion).toBe('crear');
  });
});
