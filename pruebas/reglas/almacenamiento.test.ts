import { describe, expect, it } from 'vitest';
import { crearRegistro, ErrorRegistro, type EscrituraSubidaReservada, type ManifiestoModulo, type RutaAlmacenamiento } from '@novutienda/nucleo';
import { construirCasosAlmacenamiento, rutaConcreta } from './matriz-almacenamiento.js';

const subida: RutaAlmacenamiento = {
  ruta: 'privado/originales/{productoId}/{subidaId}',
  lectura: 'servidor',
  escritura: {
    tipo: 'subidaReservada',
    roles: ['adm', 'sup'],
    reserva: 'reservas',
    archivos: [{ tipo: 'original', bytesMax: 5_000_000, contentType: 'image/(jpeg|png|webp|heic)' }],
  },
};
const publica: RutaAlmacenamiento = { ruta: 'publico/{ruta=**}', lectura: 'publica', escritura: 'servidor' };
const privada: RutaAlmacenamiento = { ruta: 'privado/derivados/{productoId}', lectura: 'servidor', escritura: 'servidor' };

function manifiesto(id: string, almacenamiento?: readonly RutaAlmacenamiento[]): ManifiestoModulo {
  return {
    id,
    version: '1.0.0',
    dependeDe: [],
    submodulos: [],
    colecciones: [{ ruta: `reservas${id === 'm' ? '' : id}`, lectura: ['adm'], escritura: 'servidor' }],
    emite: [],
    consume: [],
    ...(almacenamiento === undefined ? {} : { almacenamiento }),
  };
}
const registrar = (m: ManifiestoModulo) => crearRegistro<ManifiestoModulo>().registrar(m);
const conSubida = (cambios: Record<string, unknown>): RutaAlmacenamiento => ({
  ...subida,
  escritura: { ...(subida.escritura as object), ...cambios } as unknown as EscrituraSubidaReservada,
});

describe('almacenamiento en el registro', () => {
  it('acepta las tres políticas y un manifiesto sin almacenamiento', () => {
    const r = crearRegistro<ManifiestoModulo>();
    r.registrar(manifiesto('m', [subida, publica, privada]));
    r.registrar(manifiesto('otro'));
    expect(r.rutasAlmacenamiento()).toEqual([subida.ruta, publica.ruta, privada.ruta]);
  });

  it.each([
    ['primer segmento ajeno', { ...privada, ruta: 'otro/x' }],
    ['solo el primer segmento', { ...privada, ruta: 'privado' }],
    ['segmento con caracteres no admitidos', { ...privada, ruta: 'privado/a b' }],
    ['..', { ...privada, ruta: 'privado/../x' }],
    ['{x=**} no al final', { ...publica, ruta: 'publico/{r=**}/x' }],
    ['llave sin cerrar', { ...publica, ruta: 'publico/{r' }],
    ['lectura publica bajo privado', { ...privada, lectura: 'publica' as const }],
  ])('rechaza: %s', (_n, a) => {
    expect(() => registrar(manifiesto('m', [a]))).toThrow(ErrorRegistro);
  });

  it.each([
    ['subidaReservada bajo publico', { ...subida, ruta: 'publico/x/{productoId}/{subidaId}' }, /solo vale bajo privado/],
    ['ruta sin {productoId}/{subidaId}', { ...subida, ruta: 'privado/originales/{a}/{b}' }, /terminar en/],
    ['roles vacío', conSubida({ roles: [] }), /roles/],
    ['rol inválido', conSubida({ roles: ['root'] }), /rol inválido/],
    ['reserva inexistente', conSubida({ reserva: 'nada' }), /no es una colección/],
    ['archivos vacío', conSubida({ archivos: [] }), /archivos/],
    ['tipo vacío', conSubida({ archivos: [{ tipo: '', bytesMax: 1, contentType: 'image/(png)' }] }), /vacío/],
    ['tipo duplicado', conSubida({ archivos: [{ tipo: 'a', bytesMax: 1, contentType: 'image/(png)' }, { tipo: 'a', bytesMax: 1, contentType: 'image/(png)' }] }), /duplicado/],
    ['bytesMax cero', conSubida({ archivos: [{ tipo: 'a', bytesMax: 0, contentType: 'image/(png)' }] }), /bytesMax/],
    ['bytesMax decimal', conSubida({ archivos: [{ tipo: 'a', bytesMax: 1.5, contentType: 'image/(png)' }] }), /bytesMax/],
    ['contentType sin grupo', conSubida({ archivos: [{ tipo: 'a', bytesMax: 1, contentType: 'image/png' }] }), /contentType/],
  ])('rechaza: %s', (_n, a, patron) => {
    expect(() => registrar(manifiesto('m', [a as RutaAlmacenamiento]))).toThrow(patron);
  });

  it('rechaza una reserva que no es del servidor o es de raíz', () => {
    const base = manifiesto('m', [subida]);
    const abierta = { ...base, colecciones: [{ ruta: 'reservas', lectura: ['adm'], escritura: ['adm'] }] } as ManifiestoModulo;
    expect(() => registrar(abierta)).toThrow(/servidor/);
    const raiz = { ...base, colecciones: [{ ruta: 'reservas', lectura: [], escritura: 'servidor', ambito: 'raiz' }] } as ManifiestoModulo;
    expect(() => registrar(raiz)).toThrow(/tenant/);
  });

  it('lanza por rutas duplicadas, dentro de un manifiesto y entre manifiestos', () => {
    const r = crearRegistro<ManifiestoModulo>();
    r.registrar(manifiesto('m', [publica]));
    r.registrar(manifiesto('otro', [publica]));
    expect(() => r.rutasAlmacenamiento()).toThrow(/duplicada/);
    const q = crearRegistro<ManifiestoModulo>();
    q.registrar(manifiesto('m', [privada, privada]));
    expect(() => q.rutasAlmacenamiento()).toThrow(/duplicada/);
  });

  it('lanza si hay dos subidaReservada en el registro', () => {
    const r = crearRegistro<ManifiestoModulo>();
    r.registrar(manifiesto('m', [subida]));
    r.registrar(manifiesto('otro', [{ ...subida, ruta: 'privado/otras/{productoId}/{subidaId}', escritura: { ...(subida.escritura as object), reserva: 'reservasotro' } as unknown as EscrituraSubidaReservada }]));
    expect(() => r.rutasAlmacenamiento()).toThrow(/Más de una subidaReservada/);
  });
});

describe('almacenamiento: entradas hostiles', () => {
  it.each(["foto' || true || 'x", 'foto)', 'a\nb', '{x}', 'Foto', ''])('rechaza el tipo %j', (tipo) => {
    const a = conSubida({ archivos: [{ tipo, bytesMax: 10, contentType: 'image/png' }] });
    expect(() => registrar(manifiesto('m', [a]))).toThrow(ErrorRegistro);
  });

  it('el mensaje del tipo es exacto', () => {
    const a = conSubida({ archivos: [{ tipo: 'Foto', bytesMax: 10, contentType: 'image/png' }] });
    expect(() => registrar(manifiesto('m', [a]))).toThrow('tipo de archivo "Foto" no cumple el patrón ^[a-z][a-z0-9_]*$');
  });

  it.each([
    ['publico/{tenantId}/{r=**}', 'tenantId'],
    ['privado/{todo=**}', 'todo'],
    ['privado/{bucket}/{r=**}', 'bucket'],
  ])('rechaza la variable reservada en %s', (ruta, nombre) => {
    const a: RutaAlmacenamiento = { ruta, lectura: 'servidor', escritura: 'servidor' };
    expect(() => registrar(manifiesto('m', [a]))).toThrow(`variable de ruta reservada "{${nombre}}"`);
  });

  it('los manifiestos reales siguen registrándose', async () => {
    const { manifiestosEnOrden } = await import('../../plataforma/registro.js');
    const r = crearRegistro<ManifiestoModulo>();
    for (const m of manifiestosEnOrden()) r.registrar(m as ManifiestoModulo);
    expect(r.listar().length).toBeGreaterThan(0);
  });
});

describe('constructor de la matriz de almacenamiento', () => {
  const m = manifiesto('m', [subida, publica, privada]);

  it('sustituye las variables', () => {
    expect(rutaConcreta(subida.ruta)).toBe('privado/originales/p1/s1');
    expect(rutaConcreta(publica.ruta)).toBe('publico/x/y.jpg');
  });

  it('genera 16 personas x 5 operaciones, salvo el create permitido de la subida', () => {
    const casos = construirCasosAlmacenamiento([m]);
    expect(casos.filter((c) => c.ruta === 'privado/derivados/p1')).toHaveLength(80);
    expect(casos.filter((c) => c.ruta === 'publico/x/y.jpg')).toHaveLength(80);
    // adm y sup (roles permitidos) quedan fuera del create; caj sigue dentro.
    const s = casos.filter((c) => c.ruta === 'privado/originales/p1/s1');
    expect(s).toHaveLength(78);
    expect(s.some((c) => c.persona.nombre === 'adm@A' && c.operacion === 'create')).toBe(false);
    expect(s.some((c) => c.persona.nombre === 'caj@A' && c.operacion === 'create')).toBe(true);
  });

  it('solo se espera permitido la lectura de rutas publicas, para todos', () => {
    const casos = construirCasosAlmacenamiento([m]);
    const permitidos = casos.filter((c) => c.esperado);
    expect(permitidos).toHaveLength(32);
    expect(permitidos.every((c) => c.ruta === 'publico/x/y.jpg' && (c.operacion === 'get' || c.operacion === 'list'))).toBe(true);
    expect(permitidos.some((c) => c.persona.nombre === 'sin autenticar')).toBe(true);
  });

  it('sin almacenamiento no hay casos', () => {
    expect(construirCasosAlmacenamiento([manifiesto('m')])).toEqual([]);
  });
});
