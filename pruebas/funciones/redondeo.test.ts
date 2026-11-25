// Redondeo de precios por el callable real `consola` (emulador): el administrador ve la regla y no puede fijarla; el operador de
// NovuTienda (claim `p` y sesión con Google) la fija: auditoría, evento `redondeo.cambiado`, el consumidor de la consola agenda
// la reconstrucción y la caché se invalida (el catálogo de NovuChat devuelve la cifra nueva). También conflicto y regla inválida.
import { createHash, randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { construirClaim } from '@novutienda/nucleo';
import { accion, crearUsuario, esperar, hayEmulador, herramientas, http, sembrarTenant, unico, type Herramientas, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

const A = 'redondeo-ed';
const PROD = 'lapiz-red';
type Obj = Record<string, unknown>;
const cuerpo = (r: { resultado?: unknown }): Obj => r.resultado as Obj;
const sha256 = (t: string): string => createHash('sha256').update(t).digest('hex');
const BOB_DEFECTO = { tipo: 'decimales', decimales: 2, modo: 'cercano' };
const ARS_DEFECTO = { tipo: 'multiplo', multiplo: 100, modo: 'cercano' };

/** Propietario con sesión de Google en el emulador de Auth (`signInWithIdp`): el token lleva `sign_in_provider: google.com`. */
async function crearPropietarioGoogle(h: Herramientas): Promise<Usuario> {
  const host = process.env['FIREBASE_AUTH_EMULATOR_HOST'] ?? '127.0.0.1:8240';
  const correo = `${unico('p')}@prueba.test`;
  const idp = async (): Promise<{ idToken: string; localId: string }> => {
    const r = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=clave-falsa`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestUri: 'http://localhost', returnSecureToken: true,
        postBody: `providerId=google.com&id_token=${encodeURIComponent(JSON.stringify({ sub: correo, email: correo, email_verified: true }))}`,
      }),
    });
    const j = (await r.json()) as { idToken?: string; localId?: string };
    if (j.idToken === undefined || j.localId === undefined) throw new Error('el emulador de Auth no aceptó el ingreso con Google');
    return { idToken: j.idToken, localId: j.localId };
  };
  const primero = await idp();
  const claim = construirClaim({}, 1, true);
  if (!claim.ok) throw new Error(claim.error);
  await h.auth.setCustomUserClaims(primero.localId, { ...claim.valor });
  return { uid: primero.localId, correo, token: (await idp()).idToken };
}

describe.skipIf(!hayEmulador)('consola: redondeo de precios (emulador)', () => {
  let h: Herramientas;
  let adm: Usuario;
  let propietario: Usuario;
  let admPassword: Usuario;
  const tokenNovuchat = randomBytes(24).toString('hex');
  const ver = (u: Usuario) => accion('consola', 'verRedondeo', {}, u.token, A);
  const fijar = (u: Usuario, datos: Obj) => accion('consola', 'fijarRedondeo', datos, u.token, A);
  /** Precio de BO en el catálogo de NovuChat; `undefined` si el límite de tasa respondió 429 (el sondeo reintenta). */
  const precioBO = async (): Promise<number | undefined> => {
    const r = await http('/api/novuchat/v1/catalogo?mercado=BO', { headers: { authorization: `Bearer ${tokenNovuchat}` } });
    if (r.status === 429) return undefined;
    expect(r.status, r.texto).toBe(200);
    return Number(((r.cuerpo as { items: Obj[] }).items.find((i) => i['id'] === PROD) as Obj)['precio']);
  };

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, A, { productos: [{ id: PROD, nombre: 'Lápiz redondeo', precioUSD: { bo: 1001, ar: 2000 }, tienda: 5 }] });
    await h.firestore.doc(`tenants/${A}/publicado/producto__${PROD}`).set({
      id: PROD, slug: 'lapiz-red', nombre: 'Lápiz redondeo', categoria: 'general', descripcion: 'd', garantia: '', medios: [], seo: { titulo: 't', descripcion: 'd' }, precioUSD: { bo: 10.01, ar: 20 },
    });
    await h.firestore.doc(`tenants/${A}/publicado/estado`).set({ version: 1, publicadoEn: '2026-11-04T11:30:00.000Z', productos: [PROD], secciones: [], carruseles: [], reconstruccion: { programadaPara: null, ultima: null } });
    await h.firestore.doc(`novuchatTokens/${sha256(tokenNovuchat)}`).set({ tenantId: A, hash: sha256(tokenNovuchat), activo: true });
    adm = await crearUsuario(h, { rol: 'adm', tenant: A });
    propietario = await crearPropietarioGoogle(h);
    // Propietario con contraseña (sin Google): el marco no le reconoce la condición.
    admPassword = await crearUsuario(h, { rol: 'adm', tenant: A, propietario: true });
  });

  it('el administrador ve la regla vigente y no puede fijarla', async () => {
    const v = await ver(adm);
    expect(v.status, JSON.stringify(v.error)).toBe(200);
    expect(cuerpo(v)).toMatchObject({ monedas: ['BOB', 'ARS'], reglas: { BOB: BOB_DEFECTO, ARS: ARS_DEFECTO }, puedeEditar: false });
    const f = await fijar(adm, { reglas: { BOB: { tipo: 'decimales', decimales: 0, modo: 'arriba' }, ARS: ARS_DEFECTO }, esperadas: { BOB: BOB_DEFECTO, ARS: ARS_DEFECTO } });
    expect(f.status).toBeGreaterThanOrEqual(400);
    expect(f.resultado).toBeUndefined();
    expect((await h.firestore.doc(`tenants/${A}/config/redondeo`).get()).exists).toBe(false);
    const sinGoogle = await fijar(admPassword, { reglas: { BOB: BOB_DEFECTO, ARS: ARS_DEFECTO }, esperadas: { BOB: BOB_DEFECTO, ARS: ARS_DEFECTO } });
    expect(sinGoogle.status).toBeGreaterThanOrEqual(400);
  });

  it('el propietario fija: auditoría, evento, reconstrucción agendada y catálogo con la cifra nueva', async () => {
    expect(await precioBO()).toBe(70.07);
    const v = await ver(propietario);
    expect(cuerpo(v)).toMatchObject({ puedeEditar: true });
    const BOB_NUEVA = { tipo: 'decimales', decimales: 0, modo: 'arriba' };
    const r = await fijar(propietario, { reglas: { BOB: BOB_NUEVA, ARS: ARS_DEFECTO }, esperadas: { BOB: BOB_DEFECTO, ARS: ARS_DEFECTO }, motivo: 'prueba' });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(cuerpo(r)).toMatchObject({ estado: 'fijado', cambiadas: ['BOB'] });
    expect((await h.firestore.doc(`tenants/${A}/config/redondeo`).get()).data()).toMatchObject({ BOB: BOB_NUEVA });

    const auditoria = await h.firestore.collection(`tenants/${A}/auditoria`).where('accion', '==', 'redondeo.fijar').get();
    expect(auditoria.size).toBe(1);
    expect(auditoria.docs[0]?.data()).toMatchObject({ uid: propietario.uid, rol: 'propietario', motivo: 'prueba' });

    const eventos = await h.firestore.collection(`tenants/${A}/eventos`).where('tipo', '==', 'redondeo.cambiado').get();
    expect(eventos.size).toBe(1);
    expect(eventos.docs[0]?.data()).toMatchObject({ version: 1, datos: { monedas: ['BOB'] } });

    const estado = await esperar(async () => {
      const d = (await h.firestore.doc(`tenants/${A}/publicado/estado`).get()).data();
      return typeof d?.['redondeoVivoEn'] === 'string' ? d : undefined;
    }, 30_000, 'el consumidor de la consola anota redondeoVivoEn');
    expect(estado['version']).toBe(2);
    expect((estado['reconstruccion'] as Obj)['programadaPara']).not.toBeNull();

    // El catálogo de NovuChat aún lee la política por el lector LEGADO (`e.redondeo`, caché propia de 60 s que `fijarRedondeo` no
    // invalida): la cifra nueva llega en cuanto expira. `redondeoDelTenant` (lo que ve `verRedondeo` y usa el POS) sí se invalida al instante.
    const precio = await esperar(async () => {
      const p = await precioBO();
      if (p === undefined) await new Promise((r) => setTimeout(r, 5000)); // 429: el límite de tasa del catálogo; se espera
      return p === 71 ? p : undefined;
    }, 120_000, 'el catálogo de NovuChat con la cifra nueva');
    expect(precio).toBe(71);
    expect(cuerpo(await ver(propietario))).toMatchObject({ reglas: { BOB: BOB_NUEVA } });
  });

  it('conflicto: si lo vigente ya no es lo que se vio, falla sin escribir', async () => {
    const antes = (await h.firestore.doc(`tenants/${A}/config/redondeo`).get()).data();
    const r = await fijar(propietario, { reglas: { BOB: BOB_DEFECTO, ARS: ARS_DEFECTO }, esperadas: { BOB: BOB_DEFECTO, ARS: ARS_DEFECTO } });
    expect(r.status).toBe(400);
    expect(r.error?.status).toBe('FAILED_PRECONDITION');
    expect(JSON.stringify(r.error)).toContain('redondeo-conflicto');
    expect((await h.firestore.doc(`tenants/${A}/config/redondeo`).get()).data()).toEqual(antes);
  });

  it('regla inválida: moneda de más, de menos o forma incorrecta', async () => {
    const actuales = cuerpo(await ver(propietario))['reglas'] as Obj;
    const casos: Obj[] = [
      { BOB: { tipo: 'decimales', decimales: 9, modo: 'arriba' }, ARS: ARS_DEFECTO },
      { BOB: BOB_DEFECTO },
      { BOB: BOB_DEFECTO, ARS: ARS_DEFECTO, EUR: BOB_DEFECTO },
    ];
    for (const reglas of casos) {
      const r = await fijar(propietario, { reglas, esperadas: actuales });
      expect(r.status, JSON.stringify(r.error)).toBe(400);
      expect(r.error?.status).toBe('INVALID_ARGUMENT');
    }
  });
});
