import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { manifiestosEnOrden } from '../../plataforma/registro.js';
import {
  ErrorGenerador,
  generarReglas,
  generarReglasAlmacenamiento,
  type ColeccionReglas,
  type ManifiestoReglas,
  type RutaAlmacenamientoReglas,
} from '../../scripts/generar-reglas.mjs';

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

  describe('generarReglasAlmacenamiento', () => {
    const originales: RutaAlmacenamientoReglas = {
      ruta: 'privado/originales/{productoId}/{subidaId}',
      lectura: 'servidor',
      escritura: {
        tipo: 'subidaReservada',
        roles: ['sup', 'adm'],
        reserva: 'subidas',
        archivos: [
          { tipo: 'foto', bytesMax: 15 * 1024 * 1024, contentType: 'image/(jpeg|png|webp|heic)' },
          { tipo: 'video', bytesMax: 200 * 1024 * 1024, contentType: 'video/(mp4|quicktime|webm)' },
        ],
      },
    };
    const procesando: RutaAlmacenamientoReglas = { ruta: 'privado/procesando/{ruta=**}', lectura: 'servidor', escritura: 'servidor' };
    const publico: RutaAlmacenamientoReglas = { ruta: 'publico/{ruta=**}', lectura: 'publica', escritura: 'servidor' };
    const recibosR: RutaAlmacenamientoReglas = { ruta: 'privado/recibos/{ruta=**}', lectura: 'servidor', escritura: 'servidor' };
    const mod = (id: string, almacenamiento: RutaAlmacenamientoReglas[], reservas = ['subidas']): ManifiestoReglas => ({
      id,
      colecciones: reservas.map((ruta) => ({ ruta, lectura: [], escritura: 'servidor' as const })),
      almacenamiento,
    });
    const cuatro = () => [mod('consola', [originales, procesando, publico]), mod('recibos', [recibosR])];
    const rechaza = (m: ManifiestoReglas[], patron: RegExp) => {
      expect(() => generarReglasAlmacenamiento(m)).toThrow(ErrorGenerador);
      expect(() => generarReglasAlmacenamiento(m)).toThrow(patron);
    };
    const subidaCon = (cambios: Record<string, unknown>): RutaAlmacenamientoReglas => ({
      ...originales,
      escritura: { ...(originales.escritura as object), ...cambios } as RutaAlmacenamientoReglas['escritura'],
    });

    it('emite las tres políticas (servidor, publica, subidaReservada)', () => {
      const t = generarReglasAlmacenamiento(cuatro());
      expect(t).toContain("    // Módulo consola\n    match /tenants/{tenantId}/privado/originales/{productoId}/{subidaId} {");
      expect(t).toContain('allow create: if resource == null && editor(tenantId) && reservaValida(tenantId, productoId, subidaId);\n      allow read, update, delete: if false;');
      expect(t).toContain('match /tenants/{tenantId}/privado/procesando/{ruta=**} {\n      allow read, write: if false;');
      expect(t).toContain('match /tenants/{tenantId}/publico/{ruta=**} {\n      allow read: if true;\n      allow write: if false;');
      expect(t).toContain('// Módulo recibos\n    match /tenants/{tenantId}/privado/recibos/{ruta=**} {\n      allow read, write: if false;');
      expect(t).toContain("rolEn(tenantId) in ['sup', 'adm']");
      expect(t).toContain('tenants/$(tenantId)/subidas/$(subidaId)');
      expect(t).toContain("r.tipo == 'foto'");
      expect(t).toContain('request.resource.size <= 15 * 1024 * 1024');
      expect(t).toContain("matches('image/(jpeg|png|webp|heic)')");
      expect(t).toContain("r.tipo == 'video'");
      expect(t).toContain('request.resource.size <= 200 * 1024 * 1024');
      expect(t).toContain("matches('video/(mp4|quicktime|webm)')");
      expect(t.trimEnd().endsWith('match /{todo=**} {\n      allow read, write: if false;\n    }\n  }\n}')).toBe(true);
      expect(generarReglasAlmacenamiento(cuatro())).toBe(t);
    });

    it('emite bytesMax como entero si no es múltiplo de 1 MiB', () => {
      const t = generarReglasAlmacenamiento([
        mod('c', [subidaCon({ archivos: [{ tipo: 'a', bytesMax: 5_000_000, contentType: 'image/(png)' }] })]),
      ]);
      expect(t).toContain('request.resource.size <= 5000000');
    });

    it('sin subidaReservada no emite reservaValida ni editor', () => {
      const t = generarReglasAlmacenamiento([mod('x', [publico])]);
      expect(t).not.toContain('reservaValida');
      expect(t).not.toContain('editor');
      expect(t).toContain('function rolEn');
    });

    it('sin almacenamiento solo queda la negación final', () => {
      const t = generarReglasAlmacenamiento([sintetico]);
      expect(t).not.toContain('match /tenants');
      expect(t).toContain('match /{todo=**}');
    });

    it('rechaza lo mismo que el registro (rutas peligrosas, lectura publica bajo privado, reserva ajena)', () => {
      rechaza([mod('m', [{ ...procesando, lectura: 'publica' }])], /solo vale bajo publico/);
      rechaza([mod('m', [{ ...publico, ruta: 'publico/{r=**}/x' }])], /segmento no admitido/);
      rechaza([mod('m', [{ ...procesando, ruta: 'otro/x' }])], /primer segmento/);
      rechaza([mod('m', [{ ...procesando, ruta: 'privado/../x' }])], /segmento no admitido/);
      rechaza([mod('m', [subidaCon({ reserva: 'nada' })])], /no es una colección/);
      rechaza([mod('m', [subidaCon({ roles: [] })])], /roles/);
      rechaza([mod('m', [subidaCon({ roles: ['root'] })])], /rol inválido/);
      rechaza([mod('m', [subidaCon({ archivos: [] })])], /archivos/);
      rechaza([mod('m', [subidaCon({ archivos: [{ tipo: 'a', bytesMax: 0, contentType: 'image/(png)' }] })])], /bytesMax/);
      rechaza([mod('m', [subidaCon({ archivos: [{ tipo: 'a', bytesMax: 1, contentType: 'image/png' }] })])], /contentType/);
      rechaza([mod('m', [{ ...originales, ruta: 'publico/x/{productoId}/{subidaId}' }])], /solo vale bajo privado/);
      rechaza([mod('m', [{ ...originales, ruta: 'privado/x/{a}/{b}' }])], /terminar en/);
    });

    it('rechaza dos subidaReservada y rutas duplicadas entre módulos', () => {
      const otra = { ...originales, ruta: 'privado/otras/{productoId}/{subidaId}' };
      rechaza([mod('a', [originales]), mod('b', [otra])], /Más de una subidaReservada/);
      rechaza([mod('a', [publico]), mod('b', [publico])], /duplicada/);
    });

    it('la reserva debe ser del servidor y de ámbito tenant', () => {
      const m = mod('m', [originales]);
      rechaza([{ ...m, colecciones: [{ ruta: 'subidas', lectura: [], escritura: ['adm'] }] }], /servidor/);
      rechaza([{ ...m, colecciones: [{ ruta: 'subidas', lectura: [], escritura: 'servidor', ambito: 'raiz' }] }], /tenant/);
    });

    it('rechaza tipos de archivo hostiles', () => {
      for (const tipo of ["foto' || true || 'x", 'foto)', 'a\nb', '{x}', 'Foto']) {
        rechaza(
          [mod('consola', [subidaCon({ archivos: [{ tipo, bytesMax: 1, contentType: 'image/(jpeg)' }] })])],
          /tipo de archivo [\s\S]* no cumple el patrón \^\[a-z\]\[a-z0-9_\]\*\$/,
        );
      }
    });

    it('rechaza reserva hostil, id de módulo con salto de línea y variables reservadas', () => {
      const hostil = "subidas)/x').data; return true; //";
      rechaza([mod('consola', [subidaCon({ reserva: hostil })], [hostil])], /Ruta con caracteres no admitidos/);
      rechaza([mod('con\nsola', [procesando])], /Id de módulo no admitido/);
      expect(() => generarReglas([{ id: 'a\nb', colecciones: [{ ruta: 'x', lectura: [], escritura: 'servidor' }] }])).toThrow(/Id de módulo/);
      for (const n of ['tenantId', 'todo', 'bucket']) {
        rechaza([mod('m', [{ ruta: `publico/{${n}}`, lectura: 'publica', escritura: 'servidor' }])], new RegExp(`variable de ruta reservada "\\{${n}\\}"`));
        rechaza([mod('m', [{ ruta: `publico/{${n}=**}`, lectura: 'publica', escritura: 'servidor' }])], new RegExp(`variable de ruta reservada "\\{${n}\\}"`));
      }
    });

    it('generarReglas (Firestore) no cambia: firestore.rules sigue coincidiendo', () => {
      expect(readFileSync('firestore.rules', 'utf8')).toBe(generarReglas(manifiestosEnOrden()));
    });

    // L1-c: `storage.rules` es generado; la equivalencia la exige esta prueba en el job `calidad` del CI (de la que depende el despliegue).
    it('storage.rules versionado coincide con lo generado desde el registro', () => {
      expect(readFileSync('storage.rules', 'utf8')).toBe(generarReglasAlmacenamiento(manifiestosEnOrden()));
    });
  });
});
