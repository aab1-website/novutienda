// Camino de escritura de `aplicarPersonal` con dobles de identidad (base `DobleDb` + Auth con estado), y fotos del planificador.
// Sin emulador. El orden «contraseñas guardadas, luego cuentas», la reanudación y los secretos fuera de resultados y errores.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { construirClaim } from '@novutienda/nucleo';
import { DobleDb } from '../limites/doble-db.js';
import { aplicarPersonal, operadorDe, validarEntradaPersonal, type AlmacenCredenciales, type AuthOperador, type Credencial, type UsuarioAuth } from '../../plataforma/operador/personal.js';
import { planificarDemo, subidaIdDe, type EstadoDemo, type FixtureDemo } from '../../plataforma/operador/demo.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TENANT = 'demo-x';
const entrada = validarEntradaPersonal({
  cuentas: [
    { correo: 'adm@example.com', rol: 'adm' },
    { correo: 'sup@example.com', rol: 'sup' },
    { correo: 'caj@example.com', rol: 'caj' },
  ],
});

interface Cuenta { uid: string; correo: string; disabled: boolean; emailVerified: boolean; proveedores: string[]; claims?: Record<string, unknown> | undefined }

function montaje(opciones: { conTenant?: boolean } = {}) {
  const db = new DobleDb();
  if (opciones.conTenant !== false) poner(db);
  const cuentas = new Map<string, Cuenta>();
  const bitacora: string[] = [];
  const creadas: { correo: string; contrasena: string }[] = [];
  const fallos = { crearEn: 0 };
  let guardado: Credencial[] = [];
  const credenciales: AlmacenCredenciales = {
    leer: () => Promise.resolve([...guardado]),
    guardar: (c) => {
      bitacora.push('guardar');
      guardado = [...c];
      return Promise.resolve();
    },
  };
  const vista = (c: Cuenta): UsuarioAuth => ({ uid: c.uid, disabled: c.disabled, emailVerified: c.emailVerified, proveedores: c.proveedores, claims: c.claims });
  const auth: AuthOperador = {
    buscarPorCorreo: (correo) => {
      const c = cuentas.get(correo);
      return Promise.resolve(c === undefined ? null : vista(c));
    },
    listarUsuarios: () => Promise.resolve([...cuentas.values()].map(vista)),
    crear: (d) => {
      bitacora.push('crear');
      if (fallos.crearEn > 0 && creadas.length + 1 === fallos.crearEn) return Promise.reject(new Error('corte simulado'));
      creadas.push({ correo: d.correo, contrasena: d.contrasena });
      const uid = `uid-${String(cuentas.size + 1)}`;
      cuentas.set(d.correo, { uid, correo: d.correo, disabled: false, emailVerified: true, proveedores: ['password'] });
      return Promise.resolve(uid);
    },
    getUser: (uid) => {
      const c = [...cuentas.values()].find((x) => x.uid === uid);
      if (c === undefined) return Promise.reject(new Error('no existe'));
      return Promise.resolve({ customClaims: c.claims, providerData: c.proveedores.map((providerId) => ({ providerId })), emailVerified: c.emailVerified });
    },
    setCustomUserClaims: (uid, claims) => {
      bitacora.push('claim');
      const c = [...cuentas.values()].find((x) => x.uid === uid);
      if (c !== undefined) c.claims = { ...claims };
      return Promise.resolve();
    },
    revokeRefreshTokens: () => Promise.resolve(),
  };
  const correr = (extra: Partial<Parameters<typeof aplicarPersonal>[0]> = {}) =>
    aplicarPersonal({ tenantId: TENANT, entrada, auth, db, credenciales, aleatorios: (n) => randomBytes(n), operador: operadorDe('adm@example.com'), aplicar: true, ahora: () => 1000, ...extra });
  return { db, cuentas, bitacora, creadas, fallos, credenciales, correr, guardadoAhora: () => guardado };
}
function poner(db: DobleDb): void {
  db.poner(`tenants/${TENANT}`, { estado: 'activo', plan: 'base', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] });
}

describe('aplicarPersonal: camino de escritura', () => {
  it('guarda las contraseñas antes de crear cualquier cuenta y la credencial guardada es la que se usa al crear', async () => {
    const m = montaje();
    const r = await m.correr();
    expect(r).toMatchObject({ aplicado: true, creadas: 3, adminAsignado: true });
    expect(m.bitacora.indexOf('guardar')).toBe(0);
    expect(m.bitacora.slice(1, 4)).toEqual(['crear', 'crear', 'crear']);
    expect(m.guardadoAhora()).toHaveLength(3);
    for (const c of m.creadas) expect(m.guardadoAhora().find((g) => g.correo === c.correo)?.contrasena).toBe(c.contrasena);
    // El primer administrador queda con claim, espejo y auditoría con el operador en minúsculas.
    const adm = m.cuentas.get('adm@example.com');
    expect(adm?.claims).toBeDefined();
    expect(m.db.dato(`tenants/${TENANT}/miembros/${adm?.uid ?? ''}`)).toMatchObject({ rol: 'adm', por: 'operador:adm@example.com' });
  });

  it('las contraseñas no aparecen en el resultado devuelto', async () => {
    const m = montaje();
    const r = await m.correr();
    const texto = JSON.stringify(r);
    for (const g of m.guardadoAhora()) expect(texto).not.toContain(g.contrasena);
    expect(texto).not.toMatch(/@|uid-/);
  });

  it('las contraseñas no aparecen en los errores (cuenta deshabilitada, otro adm, fallo al crear)', async () => {
    const previas: Credencial[] = [{ correo: 'sup@example.com', rol: 'sup', contrasena: 'SECRETO-PREVIO-1234567890123456' }];
    const comprobar = async (p: Promise<unknown>) => {
      const e = await p.then(() => null, (x: unknown) => x as Error);
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).not.toContain('SECRETO-PREVIO');
      expect((e as Error).message).not.toMatch(/@/);
    };
    const a = montaje();
    await a.credenciales.guardar(previas);
    a.cuentas.set('sup@example.com', { uid: 's', correo: 'sup@example.com', disabled: true, emailVerified: true, proveedores: ['password'] });
    await comprobar(a.correr());

    const b = montaje();
    await b.credenciales.guardar(previas);
    const claim = construirClaim({ [TENANT]: 'adm' }, 1, false);
    if (!claim.ok) throw new Error(claim.error);
    b.cuentas.set('otro@example.com', { uid: 'o', correo: 'otro@example.com', disabled: false, emailVerified: true, proveedores: ['password'], claims: { ...claim.valor } });
    await comprobar(b.correr());

    const c = montaje();
    c.fallos.crearEn = 2;
    const e = await c.correr().then(() => null, (x: unknown) => x as Error);
    for (const g of c.guardadoAhora()) expect(e?.message ?? '').not.toContain(g.contrasena);
  });

  it('reanuda tras un corte a mitad de las altas: reutiliza las contraseñas guardadas y completa sin duplicar', async () => {
    const m = montaje();
    m.fallos.crearEn = 2; // la segunda creación falla: queda 1 cuenta y las 3 contraseñas ya guardadas
    await expect(m.correr()).rejects.toThrow(/corte simulado/);
    expect(m.creadas).toHaveLength(1);
    expect(m.guardadoAhora()).toHaveLength(3);
    expect(m.cuentas.get('adm@example.com')?.claims).toBeUndefined();
    const guardadasAntes = JSON.stringify(m.guardadoAhora());

    m.fallos.crearEn = 0;
    const r = await m.correr();
    expect(r).toMatchObject({ aplicado: true, creadas: 2, existentes: 1, adminAsignado: true });
    expect(JSON.stringify(m.guardadoAhora())).toBe(guardadasAntes); // no se regeneran
    for (const c of m.creadas) expect(m.guardadoAhora().find((g) => g.correo === c.correo)?.contrasena).toBe(c.contrasena);
    expect(m.cuentas.size).toBe(3);
  });

  it('sin tenant no crea cuentas ni guarda credenciales; al existir activo, el alta sigue normal', async () => {
    const m = montaje({ conTenant: false });
    await expect(m.correr()).rejects.toThrow(/no existe/);
    expect(m.cuentas.size).toBe(0);
    expect(m.bitacora).toEqual([]);
    poner(m.db);
    const r = await m.correr();
    expect(r).toMatchObject({ aplicado: true, creadas: 3, existentes: 0, adminAsignado: true });
  });

  it('la segunda pasada completa no tiene diferencias ni escribe', async () => {
    const m = montaje();
    await m.correr();
    const antes = [...m.bitacora];
    const r = await m.correr();
    expect(r).toMatchObject({ aplicado: false, creadas: 0, adminAsignado: false, existentes: 3 });
    expect(r.diferencias).toEqual([]);
    expect(m.bitacora).toEqual(antes);
  });

  it('rechaza sin escribir ante un adm previo distinto del destino y ante cuentas deshabilitadas', async () => {
    const claim = construirClaim({ [TENANT]: 'adm' }, 1, false);
    if (!claim.ok) throw new Error(claim.error);
    const a = montaje();
    a.cuentas.set('otro@example.com', { uid: 'o', correo: 'otro@example.com', disabled: false, emailVerified: true, proveedores: ['password'], claims: { ...claim.valor } });
    await expect(a.correr()).rejects.toThrow(/administrador distinto/);
    expect(a.bitacora).toEqual([]);
    expect(a.db.coleccion(`tenants/${TENANT}/auditoria`)).toEqual([]);

    const b = montaje();
    b.cuentas.set('caj@example.com', { uid: 'c', correo: 'caj@example.com', disabled: true, emailVerified: true, proveedores: ['password'] });
    await expect(b.correr()).rejects.toThrow(/deshabilitadas/);
    expect(b.bitacora).toEqual([]);
  });

  it('un operador inválido para el núcleo se rechaza antes de crear cuentas', async () => {
    const m = montaje();
    await expect(m.correr({ operador: 'Operador:ADM@Example.com' })).rejects.toThrow(/operador de la auditoría/);
    await expect(m.correr({ operador: 'operador: con espacio' })).rejects.toThrow(/operador de la auditoría/);
    expect(m.bitacora).toEqual([]);
  });
});

describe('operadorDe: minúsculas y compatible con OPERADOR_VALIDO del núcleo', () => {
  it('pasa a minúsculas y el resultado lo acepta el núcleo (auditoría escrita)', async () => {
    expect(operadorDe('  ADM@Example.COM ')).toBe('operador:adm@example.com');
    const m = montaje();
    await m.correr({ operador: operadorDe('ADM@Example.COM') });
    expect(m.db.coleccion(`tenants/${TENANT}/auditoria`)[0]).toMatchObject({ uid: 'operador:adm@example.com' });
  });

  it('lo que el núcleo rechazaría cae a operador:script (caracteres, largo de 128 con el prefijo)', () => {
    expect(operadorDe('a/b')).toBe('operador:script');
    expect(operadorDe('ñandú')).toBe('operador:script');
    expect(operadorDe('x'.repeat(128 - 'operador:'.length))).toHaveLength(128);
    expect(operadorDe('x'.repeat(128 - 'operador:'.length + 1))).toBe('operador:script');
  });
});

describe('planificador de la demostración: fotos', () => {
  const DIR = join(process.cwd(), 'scripts/demo');
  const csv = readFileSync(join(DIR, 'catalogo.csv'), 'utf8');
  const fx = JSON.parse(readFileSync(join(DIR, 'demo.json'), 'utf8')) as FixtureDemo;
  const ficha = fx.fichas.find((f) => f.fotos.length >= 2) ?? (fx.fichas[0] as FixtureDemo['fichas'][number]);
  const vacio: EstadoDemo = {
    cuentas: { sup: { uid: 'u-sup', rolActual: 'sup' }, caj: { uid: 'u-caj', rolActual: 'caj' } },
    ubicaciones: [], productos: [], series: {}, plantilla: null, configSitio: null, fichas: {}, medios: {},
    tablero: { versionPublicada: 0, cambiosSinPublicar: 0 }, turnos: [], ventas: [],
  };
  const fotosDe = (estado: EstadoDemo) =>
    planificarDemo(csv, fx, estado, { fotos: true, ventas: false, bytesFoto: {} }).pasos.flatMap((p) => (p.tipo === 'foto' && p.productoId === ficha.productoId ? [p.subidaId] : []));

  it('una foto ya procesada no se vuelve a subir y las pendientes conservan su subidaId estable', () => {
    const todas = ficha.fotos.map((_, i) => subidaIdDe(ficha.productoId, i + 1));
    expect(fotosDe(vacio)).toEqual(todas);
    const hecha = fotosDe({ ...vacio, medios: { [ficha.productoId]: [todas[0] as string] } });
    expect(hecha).toEqual(todas.slice(1));
  });

  it('la ficha referencia todos los medios, también los ya procesados', () => {
    const todas = ficha.fotos.map((_, i) => subidaIdDe(ficha.productoId, i + 1));
    const p = planificarDemo(csv, fx, { ...vacio, medios: { [ficha.productoId]: [todas[0] as string] } }, { fotos: true, ventas: false, bytesFoto: {} });
    const paso = p.pasos.find((x) => x.tipo === 'llamada' && x.accion === 'guardarFicha' && x.datos['productoId'] === ficha.productoId);
    const medios = ((paso as unknown as { datos: { ficha: { medios: { medioId: string }[] } } }).datos.ficha.medios).map((m) => m.medioId);
    expect(medios).toEqual(todas);
  });

  it('sin la opción de fotos no hay pasos de foto ni medios en la ficha', () => {
    const p = planificarDemo(csv, fx, vacio, { fotos: false, ventas: false, bytesFoto: {} });
    expect(p.pasos.some((x) => x.tipo === 'foto')).toBe(false);
  });
});
