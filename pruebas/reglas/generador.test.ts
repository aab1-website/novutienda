import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { manifiestosEnOrden } from '../../plataforma/registro.js';
import { ErrorGenerador, generarReglas, type ColeccionReglas, type ManifiestoReglas } from '../../scripts/generar-reglas.mjs';

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

  // L1-a paso 2: colecciones de raíz en el generador.
  describe('colecciones de raíz', () => {
    const raiz = (extra: Partial<ColeccionReglas> = {}): ColeccionReglas => ({
      ruta: 'global',
      ambito: 'raiz',
      lectura: [],
      escritura: 'servidor',
      ...extra,
    });
    const con = (...colecciones: ColeccionReglas[]) => generarReglas([{ id: 'demo', colecciones }]);

    it('emite match /x/{id} { allow read: if false; allow write: if false; } dentro del bloque del módulo', () => {
      const t = con({ ruta: 'productos', lectura: ['adm'], escritura: ['adm'] }, raiz());
      expect(t).toContain(
        '    // demo: colecciones de raíz (solo servidor)\n' +
          '    match /global/{id} {\n' +
          '      allow read: if false;\n' +
          '      allow write: if false; // solo el servidor escribe\n' +
          '    }',
      );
      expect(t).not.toContain('/tenants/{tenantId}/global');
      expect(t.indexOf('match /global/{id}')).toBeLessThan(t.indexOf('match /{document=**}'));
      expect(t.indexOf('match /global/{id}')).toBeGreaterThan(t.indexOf('// Módulo demo'));
    });
    it('rechaza raíz con roles de lectura o de escritura', () => {
      expect(() => con(raiz({ lectura: ['adm'] }))).toThrow(ErrorGenerador);
      expect(() => con(raiz({ escritura: ['adm'] }))).toThrow(/servidor/);
      expect(() => con(raiz({ escritura: [] }))).toThrow(ErrorGenerador);
    });
    it('rechaza raíz con límite', () => {
      expect(() => con(raiz({ limite: 'usuarios' }))).toThrow(/límite/);
    });
    it('rechaza raíz de dos segmentos', () => {
      expect(() => con(raiz({ ruta: 'a/b' }))).toThrow(/un solo segmento/);
    });
    it('rechaza raíz llamada tenants', () => {
      expect(() => con(raiz({ ruta: 'tenants' }))).toThrow(/tenants/);
    });
    it('rechaza nombres duplicados entre ámbitos', () => {
      expect(() => con(raiz(), { ruta: 'global', lectura: ['adm'], escritura: 'servidor' })).toThrow(/duplicada/);
      expect(() =>
        generarReglas([
          { id: 'a', colecciones: [{ ruta: 'global', lectura: ['adm'], escritura: 'servidor' }] },
          { id: 'b', colecciones: [raiz()] },
        ]),
      ).toThrow(/duplicada/);
    });
    it('rechaza caracteres no admitidos en la raíz', () => {
      for (const ruta of ['x y', 'a{b}', '*', '..', '', 'x\n']) {
        expect(() => con(raiz({ ruta }))).toThrow(ErrorGenerador);
      }
      expect(() => con(raiz({ ruta: 'x y' }))).toThrow('Ruta con caracteres no admitidos: "x y"');
    });
    it('rechaza un ámbito desconocido', () => {
      const rara = { ...raiz(), ambito: 'otro' } as unknown as ColeccionReglas;
      expect(() => con(rara)).toThrow(/Ámbito/);
    });
    it("ambito: 'tenant' explícito produce la misma salida que omitirlo", () => {
      const base = { ruta: 'productos', lectura: ['adm'], escritura: ['adm'] } as const;
      expect(con({ ...base, ambito: 'tenant' })).toBe(con({ ...base }));
    });
    it('dos raíces salen en orden dentro del bloque de su módulo y no en el de otro', () => {
      const t = generarReglas([
        { id: 'uno', colecciones: [raiz({ ruta: 'zeta' }), raiz({ ruta: 'alfa' })] },
        { id: 'dos', colecciones: [{ ruta: 'otra', lectura: ['adm'], escritura: 'servidor' }] },
      ]);
      const [iUno, iDos] = [t.indexOf('// Módulo uno'), t.indexOf('// Módulo dos')];
      const [iZeta, iAlfa] = [t.indexOf('match /zeta/{id}'), t.indexOf('match /alfa/{id}')];
      expect(iUno).toBeLessThan(iZeta);
      expect(iZeta).toBeLessThan(iAlfa);
      expect(iAlfa).toBeLessThan(iDos);
    });
    // Firestore distingue mayúsculas: «Tenants» es otra colección que no se solapa
    // con `tenants/{tenantId}`. No se rechaza; queda cerrada por solo-servidor.
    it('«Tenants» con mayúscula se acepta y queda cerrada', () => {
      const t = con(raiz({ ruta: 'Tenants' }));
      expect(t).toContain('match /Tenants/{id} {\n      allow read: if false;\n      allow write: if false;');
    });
  });
});
