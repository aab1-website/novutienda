import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { manifiestosEnOrden } from '../../plataforma/registro.js';
import { ErrorGenerador, generarReglas, type ManifiestoReglas } from '../../scripts/generar-reglas.mjs';

const sintetico: ManifiestoReglas = {
  id: 'demo',
  colecciones: [
    { ruta: 'productos', lectura: ['caj', 'sup'], escritura: ['adm'] },
    { ruta: 'ventas', lectura: ['sup'], escritura: 'servidor' },
    { ruta: 'privada', lectura: [], escritura: [] },
  ],
};

describe('generador de reglas', () => {
  it('firestore.rules versionado coincide con lo generado desde el registro', () => {
    const generado = generarReglas(manifiestosEnOrden());
    expect(readFileSync('firestore.rules', 'utf8')).toBe(generado);
  });

  it('es determinista', () => {
    const m = manifiestosEnOrden();
    expect(generarReglas(m)).toBe(generarReglas(m));
  });

  it('niega por defecto, sin anónimos ni correos fijos', () => {
    const t = generarReglas([sintetico]);
    expect(t).toContain('match /{document=**} {\n      allow read, write: if false;');
    expect(t).not.toMatch(/if true/);
    expect(t).not.toMatch(/@|anonymous/i);
    expect(t).toContain("get(tenantId, '')");
  });

  it("'servidor' y listas vacías no abren escritura ni lectura", () => {
    const t = generarReglas([sintetico]);
    expect(t).toMatch(/\/ventas\/\{id\} \{\n {6}allow read: if tieneRol\(tenantId, \['sup'\]\);\n {6}allow write: if false;/);
    expect(t).toMatch(/\/privada\/\{id\} \{\n {6}allow read: if false;\n {6}allow write: if false;/);
    expect(t).toContain("/productos/{id} {\n      allow read: if tieneRol(tenantId, ['caj', 'sup']);\n      allow write: if tieneRol(tenantId, ['adm']);");
  });

  it('rechaza rutas peligrosas, de colección inválida, roles desconocidos y duplicados', () => {
    const una = (ruta: string, lectura: string[] = []) => [{ id: 'x', colecciones: [{ ruta, lectura, escritura: 'servidor' as const }] }];
    expect(() => generarReglas(una('a{b'))).toThrow(ErrorGenerador);
    expect(() => generarReglas(una('a/b'))).toThrow(/número par/);
    expect(() => generarReglas(una('ok', ['root']))).toThrow(/Rol inválido/);
    expect(() => generarReglas([...una('ok'), { id: 'y', colecciones: [{ ruta: 'ok', lectura: [], escritura: 'servidor' }] }])).toThrow(/duplicada/);
  });

  it('rechaza una colección con límite cuya escritura no es del servidor', () => {
    const con = (escritura: 'servidor' | string[]) => [
      { id: 'x', colecciones: [{ ruta: 'miembros', lectura: ['adm'], escritura, limite: 'usuarios' }] },
    ];
    expect(() => generarReglas(con(['adm']))).toThrow(/límite/);
    expect(() => generarReglas(con([]))).toThrow(ErrorGenerador);
    expect(() => generarReglas(con('servidor'))).not.toThrow();
  });

  it('tieneRol exige correo verificado', () => {
    expect(generarReglas([sintetico])).toContain("&& request.auth.token.get('email_verified', false) == true");
  });

  it('omite módulos sin colecciones', () => {
    expect(generarReglas([{ id: 'vacio', colecciones: [] }])).not.toContain('Módulo vacio');
  });
});
