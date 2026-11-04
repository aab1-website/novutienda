// Pruebas sin emulador: traducción de errores, política de redondeo, verificadores, composición de cabeceras y
// el marco de los callables con un entorno falso.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ErrorConsola } from '@novutienda/consola';
import { EntradaInvalida, ErrorInventario, OperacionConflicto, SinPermiso, StockInsuficiente } from '@novutienda/inventarios';
import { CargaNoAutorizada, ContadorCorrupto, ErrorEvento, ErrorIdentidad, LimiteDelPlan, SaltoSinConfirmar, SinCotizacionUtilizable } from '@novutienda/nucleo';
import { ErrorPos, type CodigoErrorPos } from '@novutienda/pos';
import { AccionNoPermitida, ErrorRecibo, ReciboNoEncontrado } from '@novutienda/recibos';
import {
  VideoNoDisponible, appCheckReal, appCheckSimulado, esEntornoDePruebas, recaptchaEnterprise, recaptchaSimulado, traducirError,
} from '../../plataforma/adaptadores/firebase/index.js';
import { limiteMemoria } from '@novutienda/website';
import { enrutar, type ConfigRouter } from '../../plataforma/funciones/servidor/http/router.js';
import { componer } from '../../plataforma/funciones/scripts/componer-hosting.mjs';
import { ConfiguracionIncompleta, exigirConfiguracionDeServicio } from '../../plataforma/funciones/servidor/config.js';
import { ipDelCliente, ORIGEN_DESCONOCIDO } from '../../plataforma/funciones/servidor/origen.js';
import { REDONDEO_POR_DEFECTO, RedondeoInvalido, interpretarRedondeo } from '../../plataforma/funciones/servidor/redondeo.js';
import { aJson } from '../../plataforma/funciones/servidor/serializar.js';

describe('traducción de errores a HttpsError', () => {
  it('Inventarios: conserva el código del módulo y agrega los faltantes', () => {
    expect(traducirError(new EntradaInvalida('mal', ['a']))).toMatchObject({ code: 'invalid-argument', details: { detalles: ['a'] } });
    expect(traducirError(new OperacionConflicto('op-1'))).toMatchObject({ code: 'already-exists' });
    expect(traducirError(new SinPermiso('no'))).toMatchObject({ code: 'permission-denied' });
    expect(traducirError(new ErrorInventario('not-found', 'x'))).toMatchObject({ code: 'not-found' });
    const f = [{ productoId: 'p', almacenId: 'tienda', pedido: 3, disponible: 1 }];
    expect(traducirError(new StockInsuficiente(f))).toMatchObject({ code: 'failed-precondition', details: { faltantes: f } });
  });

  it('POS: cada código tiene traducción y los de integridad no filtran detalle', () => {
    const codigos: CodigoErrorPos[] = [
      'entrada-invalida', 'no-autorizado', 'dato-corrupto', 'sin-turno', 'turno-ajeno', 'turno-no-abierto', 'turno-ya-abierto', 'request-en-uso',
      'precio-alterado', 'producto-inexistente', 'producto-inactivo', 'sin-precio', 'series-invalidas', 'descuento-sin-aprobacion',
      'aprobacion-inexistente', 'aprobacion-no-aprobada', 'aprobacion-usada', 'aprobacion-vencida', 'aprobacion-no-coincide', 'autoaprobacion',
      'pagos-invalidos', 'medio-no-habilitado', 'conteo-faltante', 'egreso-excede-efectivo', 'venta-inexistente', 'venta-ya-anulada',
      'anulacion-sin-solicitud', 'credito-inexistente', 'credito-saldo-insuficiente',
    ];
    for (const c of codigos) expect(traducirError(new ErrorPos(c, 'm')).code, c).toMatch(/^[a-z-]+$/);
    expect(traducirError(new ErrorPos('autoaprobacion', 'm')).code).toBe('permission-denied');
    expect(traducirError(new ErrorPos('request-en-uso', 'm')).code).toBe('already-exists');
    expect(traducirError(new ErrorPos('venta-inexistente', 'm')).code).toBe('not-found');
    expect(traducirError(new ErrorPos('pagos-invalidos', 'm')).code).toBe('invalid-argument');
    expect(traducirError(new ErrorPos('turno-ya-abierto', 'm')).code).toBe('failed-precondition');
    const corrupto = traducirError(new ErrorPos('dato-corrupto', 'ruta secreta tenants/x/ventas/y'));
    expect(corrupto).toMatchObject({ code: 'internal', interno: true });
  });

  it('Núcleo, Identidad, Consola y Recibos', () => {
    expect(traducirError(new LimiteDelPlan('productos', 200))).toMatchObject({ code: 'resource-exhausted', details: { clave: 'productos', tope: 200 } });
    expect(traducirError(new ErrorIdentidad('no-autorizado', 'x')).code).toBe('permission-denied');
    expect(traducirError(new ErrorIdentidad('concurrencia', 'x')).code).toBe('aborted');
    expect(traducirError(new ErrorIdentidad('no-miembro', 'x')).code).toBe('not-found');
    expect(traducirError(new ErrorIdentidad('estado', 'detalle interno')).message).not.toContain('detalle interno');
    expect(traducirError(new ErrorConsola('cuota-excedida', 'x')).code).toBe('resource-exhausted');
    expect(traducirError(new ErrorConsola('conflicto', 'x')).code).toBe('already-exists');
    expect(traducirError(new ErrorConsola('no-disponible', 'x')).code).toBe('unavailable');
    expect(traducirError(new ErrorConsola('contador-corrupto', 'x'))).toMatchObject({ code: 'internal' });
    expect(traducirError(new ErrorConsola('entrada-invalida', 'x', ['campo']))).toMatchObject({ code: 'invalid-argument', details: { detalles: ['campo'] } });
    expect(traducirError(new ReciboNoEncontrado('x')).code).toBe('not-found');
    expect(traducirError(new AccionNoPermitida('x')).code).toBe('permission-denied');
    expect(traducirError(new ErrorRecibo('x')).code).toBe('invalid-argument');
    expect(traducirError(new CargaNoAutorizada()).code).toBe('permission-denied');
    expect(traducirError(new SaltoSinConfirmar(1, 2, 0.05)).code).toBe('failed-precondition');
    expect(traducirError(new SinCotizacionUtilizable('BO', 'vieja')).code).toBe('failed-precondition');
    expect(traducirError(new VideoNoDisponible()).code).toBe('unavailable');
    expect(traducirError(new ErrorEvento('x')).code).toBe('invalid-argument');
    expect(traducirError(new ContadorCorrupto('productos', -1))).toMatchObject({ code: 'internal' });
  });

  it('todo error traducido lleva details.codigo en kebab-case (el panel mapea el mensaje por ese código)', () => {
    const kebab = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
    const f = [{ productoId: 'p', almacenId: 'tienda', pedido: 3, disponible: 1 }];
    const casos: [unknown, string][] = [
      [new StockInsuficiente(f), 'stock-insuficiente'],
      [new OperacionConflicto('op-1'), 'operacion-conflicto'],
      [new SinPermiso('no'), 'sin-permiso'],
      [new EntradaInvalida('mal'), 'entrada-invalida'],
      [new ErrorInventario('not-found', 'x'), 'not-found'],
      [new ErrorPos('sin-turno', 'm'), 'sin-turno'],
      [new LimiteDelPlan('productos', 200), 'limite-del-plan'],
      [new ErrorIdentidad('ultimo-adm', 'x'), 'ultimo-adm'],
      [new ErrorConsola('cuota-excedida', 'x'), 'cuota-excedida'],
      [new ReciboNoEncontrado('x'), 'recibo-no-encontrado'],
      [new AccionNoPermitida('x'), 'accion-no-permitida'],
      [new ErrorRecibo('x'), 'recibo-invalido'],
      [new CargaNoAutorizada(), 'carga-no-autorizada'],
      [new SaltoSinConfirmar(1, 2, 0.05), 'salto-sin-confirmar'],
      [new SinCotizacionUtilizable('BO', 'vieja'), 'sin-cotizacion'],
      [new VideoNoDisponible(), 'video-no-disponible'],
      [new ErrorEvento('x'), 'evento-invalido'],
      [new ContadorCorrupto('productos', -1), 'error-interno'],
      [new ErrorPos('dato-corrupto', 'ruta secreta'), 'dato-corrupto'],
      [{ code: 10 }, 'concurrencia'],
      [{ code: 4 }, 'tiempo-agotado'],
      [{ code: 14 }, 'no-disponible'],
      [new Error('raro'), 'error-interno'],
      [null, 'error-interno'],
    ];
    for (const [error, esperado] of casos) {
      const t = traducirError(error);
      expect((t.details as { codigo?: string }).codigo, esperado).toBe(esperado);
      expect(esperado).toMatch(kebab);
    }
  });

  it('errores de infraestructura y desconocidos no filtran detalle técnico', () => {
    expect(traducirError({ code: 10 }).code).toBe('aborted');
    expect(traducirError({ code: 4 }).code).toBe('deadline-exceeded');
    expect(traducirError({ code: 14 }).code).toBe('unavailable');
    const raro = traducirError(new Error('select * from secretos; clave=abc'));
    expect(raro).toMatchObject({ code: 'internal', interno: true });
    expect(raro.message).not.toContain('clave');
    expect(traducirError(null).code).toBe('internal');
    expect(traducirError('texto').code).toBe('internal');
  });
});

describe('política de redondeo', () => {
  it('sin documento rige la decisión: BOB dos decimales y ARS múltiplo de 100 más cercano', () => {
    expect(interpretarRedondeo(undefined)).toEqual(REDONDEO_POR_DEFECTO);
    expect(REDONDEO_POR_DEFECTO.BOB).toEqual({ tipo: 'decimales', decimales: 2, modo: 'cercano' });
    expect(REDONDEO_POR_DEFECTO.ARS).toEqual({ tipo: 'multiplo', multiplo: 100, modo: 'cercano' });
  });
  it('acepta una política válida y rechaza lo inválido, ajeno o con claves de más', () => {
    expect(interpretarRedondeo({ BOB: { tipo: 'ninguno' }, ARS: { tipo: 'multiplo', multiplo: 500, modo: 'arriba' } }).ARS).toEqual({ tipo: 'multiplo', multiplo: 500, modo: 'arriba' });
    for (const malo of [{}, { BOB: { tipo: 'ninguno' } }, { BOB: { tipo: 'decimales', decimales: 9, modo: 'cercano' }, ARS: { tipo: 'ninguno' } },
      { BOB: { tipo: 'multiplo', multiplo: 0, modo: 'cercano' }, ARS: { tipo: 'ninguno' } }, { BOB: { tipo: 'ninguno' }, ARS: { tipo: 'ninguno' }, USD: {} },
      { BOB: { tipo: 'raro' }, ARS: { tipo: 'ninguno' } }]) {
      expect(() => interpretarRedondeo(malo)).toThrow(RedondeoInvalido);
    }
  });
});

describe('verificadores de App Check y reCAPTCHA', () => {
  it('la versión simulada solo existe en el emulador o en pruebas', () => {
    expect(esEntornoDePruebas({})).toBe(false);
    expect(esEntornoDePruebas({ FUNCTIONS_EMULATOR: 'true' })).toBe(true);
    expect(esEntornoDePruebas({ PLATAFORMA_PRUEBAS: '1' })).toBe(true);
    expect(() => appCheckSimulado({})).toThrow(/simulado solo existe/);
    expect(() => recaptchaSimulado({ NODE_ENV: 'production' })).toThrow(/simulado solo existe/);
  });
  it('simulados: tokens fijos', async () => {
    const env = { PLATAFORMA_PRUEBAS: '1' };
    expect(await appCheckSimulado(env).verificar('simulado-valido')).toBe(true);
    expect(await appCheckSimulado(env).verificar('otro')).toBe(false);
    expect(await recaptchaSimulado(env).verificar('simulado-humano-1', 'contacto')).toEqual({ valido: true, puntaje: 0.9 });
    expect(await recaptchaSimulado(env).verificar('simulado-bot-1', 'contacto')).toEqual({ valido: true, puntaje: 0.1 });
    expect(await recaptchaSimulado(env).verificar('x', 'contacto')).toEqual({ valido: false, puntaje: null });
  });
  it('App Check real: acepta lo que Admin verifica y rechaza si falla', async () => {
    const bueno = appCheckReal({ verifyToken: () => Promise.resolve({}) } as never);
    const malo = appCheckReal({ verifyToken: () => Promise.reject(new Error('token inválido')) } as never);
    expect(await bueno.verificar('t')).toBe(true);
    expect(await malo.verificar('t')).toBe(false);
  });
  it('App Check real con consume: pide a Admin consumir el token y rechaza el que ya fue consumido', async () => {
    const llamadas: unknown[] = [];
    const visto = new Set<string>();
    const admin = {
      verifyToken: (t: string, o?: unknown) => {
        llamadas.push(o);
        const repetido = visto.has(t);
        visto.add(t);
        return Promise.resolve({ appId: 'a', alreadyConsumed: repetido });
      },
    };
    const v = appCheckReal(admin as never, { consumir: true });
    expect(await v.verificar('t1')).toBe(true);
    expect(await v.verificar('t1')).toBe(false); // reutilizado
    expect(await v.verificar('t2')).toBe(true);
    expect(llamadas).toEqual([{ consume: true }, { consume: true }, { consume: true }]);
    // Sin consumir no se pide consumo (los callables usan el marco de Functions, no este verificador).
    const sin = appCheckReal(admin as never);
    expect(await sin.verificar('t3')).toBe(true);
    expect(llamadas[3]).toBeUndefined();
  });
  it('reCAPTCHA Enterprise: valida token y acción, envía la clave de sitio y falla cerrado ante cualquier error', async () => {
    const respuesta = (cuerpo: unknown, ok = true) => vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(cuerpo) });
    const config = (f: ReturnType<typeof vi.fn>) => ({ proyecto: 'p-1', claveSitio: 'clave-publica', tokenAcceso: () => Promise.resolve('acceso'), fetch: f as unknown as typeof fetch });
    const bueno = respuesta({ tokenProperties: { valid: true, action: 'contacto' }, riskAnalysis: { score: 0.8 } });
    expect(await recaptchaEnterprise(config(bueno)).verificar('tok', 'contacto')).toEqual({ valido: true, puntaje: 0.8 });
    const [url, init] = bueno.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://recaptchaenterprise.googleapis.com/v1/projects/p-1/assessments');
    expect(init.headers['authorization']).toBe('Bearer acceso');
    expect(JSON.parse(init.body)).toEqual({ event: { token: 'tok', siteKey: 'clave-publica', expectedAction: 'contacto' } });
    expect(await recaptchaEnterprise(config(respuesta({ tokenProperties: { valid: true, action: 'otra' }, riskAnalysis: { score: 0.9 } }))).verificar('t', 'contacto')).toEqual({ valido: false, puntaje: null });
    expect(await recaptchaEnterprise(config(respuesta({ tokenProperties: { valid: false } }))).verificar('t', 'contacto')).toEqual({ valido: false, puntaje: null });
    expect(await recaptchaEnterprise(config(respuesta({}, false))).verificar('t', 'contacto')).toEqual({ valido: false, puntaje: null });
    expect(await recaptchaEnterprise(config(vi.fn().mockRejectedValue(new Error('red')))).verificar('t', 'contacto')).toEqual({ valido: false, puntaje: null });
    expect(await recaptchaEnterprise({ ...config(bueno), tokenAcceso: () => Promise.reject(new Error('sin credenciales')) }).verificar('t', 'contacto')).toEqual({ valido: false, puntaje: null });
  });
});

describe('serialización de la salida', () => {
  it('convierte Timestamp y fecha a ISO, descarta undefined y funciones', async () => {
    const { Timestamp } = await import('firebase-admin/firestore');
    const r = aJson({ a: Timestamp.fromMillis(0), b: [new Date(1000), undefined, 2], c: { d: undefined, e: () => 1, f: Number.NaN }, g: new Uint8Array([1, 2]) });
    expect(r).toEqual({ a: '1970-01-01T00:00:00.000Z', b: ['1970-01-01T00:00:01.000Z', null, 2], c: { e: null, f: null }, g: 'AQI=' });
  });
});

describe('composición de las cabeceras del sitio', () => {
  const firebase = JSON.parse(readFileSync('firebase.json', 'utf8')) as { hosting: { target: string; headers: { source: string; headers: { key: string; value: string }[] }[] }[] };
  const sellado = [{ source: '**', headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; script-src 'self' 'sha256-abc='" }, { key: 'X-Frame-Options', value: 'DENY' }] }];

  it('reemplaza la regla ** del sitio por la sellada y no toca el panel', () => {
    const r = componer(firebase, sellado) as typeof firebase;
    const sitio = r.hosting.find((h) => h.target === 'sitio');
    expect(sitio?.headers.find((x) => x.source === '**')?.headers).toEqual(sellado[0]?.headers);
    expect(r.hosting.find((h) => h.target === 'panel')).toEqual(firebase.hosting.find((h) => h.target === 'panel'));
    expect(firebase.hosting.find((h) => h.target === 'sitio')?.headers.find((x) => x.source === '**')?.headers[0]?.value).not.toContain('sha256-abc');
  });
  it('falla si el sello no trae CSP o tiene otra forma', () => {
    expect(() => componer(firebase, [{ source: '**', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] }])).toThrow(/Content-Security-Policy/);
    expect(() => componer(firebase, [])).toThrow(/exactamente una regla/);
    expect(() => componer({ hosting: [] }, sellado)).toThrow(/no tiene el sitio/);
  });
});

describe('firebase.json', () => {
  const cfg = JSON.parse(readFileSync('firebase.json', 'utf8')) as {
    functions: { source: string; runtime: string; codebase: string }[];
    hosting: { target: string; public: string; rewrites: { source: string; function?: { functionId: string; region: string }; destination?: string }[]; headers: { source: string; headers: { key: string; value: string }[] }[] }[];
    emulators: Record<string, { port?: number }>;
  };
  const cabecera = (h: (typeof cfg.hosting)[number], clave: string): string | undefined => h.headers.find((x) => x.source === '**')?.headers.find((x) => x.key === clave)?.value;

  it('dos sitios por target (sin IDs de proyecto) y funciones en Node 22', () => {
    expect(cfg.hosting.map((h) => h.target)).toEqual(['sitio', 'panel']);
    expect(cfg.functions[0]).toMatchObject({ runtime: 'nodejs22', source: 'dist/funciones' });
    expect(JSON.stringify(cfg)).not.toMatch(/"site"\s*:|\.web\.app|firebaseapp\.com/);
  });
  it('el sitio manda /api/** y /healthz a la función api en us-east1', () => {
    const sitio = cfg.hosting[0];
    expect(sitio?.public).toBe('dist/website');
    for (const origen of ['/api/**', '/healthz']) {
      expect(sitio?.rewrites.find((r) => r.source === origen)?.function).toEqual({ functionId: 'api', region: 'us-east1' });
    }
  });
  it('el panel lleva una CSP estricta (sin unsafe-*, sin comodines de esquema) y no se cachea', () => {
    const panel = cfg.hosting[1];
    expect(panel?.public).toBe('dist/panel');
    const csp = cabecera(panel as never, 'Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\sdata:\s*\*|\*\s|http:/);
    expect(csp.split(';').find((d) => d.trim().startsWith('script-src'))).not.toMatch(/\*/);
    expect(cabecera(panel as never, 'X-Frame-Options')).toBe('DENY');
    expect(cabecera(panel as never, 'Cache-Control')).toBe('no-store');
  });
  it('el sitio trae una CSP base estricta que el sello reemplaza', () => {
    const csp = cabecera(cfg.hosting[0] as never, 'Content-Security-Policy') ?? '';
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/unsafe-/);
  });
  it('los emuladores tienen puertos propios y distintos', () => {
    const puertos = Object.values(cfg.emulators).map((e) => e.port).filter((p): p is number => typeof p === 'number');
    expect(new Set(puertos).size).toBe(puertos.length);
    for (const n of ['auth', 'firestore', 'storage', 'functions', 'eventarc']) expect(cfg.emulators[n]?.port).toBeGreaterThan(8000);
  });
});

describe('autenticación de los callables (con un Auth falso)', () => {
  const claims = (extra: Record<string, unknown> = {}) => ({
    uid: 'u1', email_verified: true, firebase: { sign_in_provider: 'password' }, pl: { t: { 'casa-a': 'caj' }, v: 1 }, ...extra,
  });
  const auth = (resultado: unknown) => ({
    verifyIdToken: vi.fn((_t: string, revocados?: boolean) => (resultado instanceof Error ? Promise.reject(resultado) : Promise.resolve({ ...(resultado as object), revocados }))),
  });
  const req = (cabecera?: string) => ({ rawRequest: { headers: cabecera === undefined ? {} : { authorization: cabecera } } }) as never;

  it('pide siempre checkRevoked, exige correo verificado y rechaza anónimos o sin token', async () => {
    const { autenticar, personalDelTenant, exigirAppCheck } = await import('../../plataforma/funciones/servidor/autenticacion.js');
    const ok = auth(claims());
    const s = await autenticar({ auth: ok } as never, req('Bearer token-1'));
    expect(ok.verifyIdToken).toHaveBeenCalledWith('token-1', true);
    expect(s).toMatchObject({ uid: 'u1', proveedor: 'password', propietario: false });
    await expect(autenticar({ auth: auth(claims({ email_verified: false })) } as never, req('Bearer t'))).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(autenticar({ auth: auth(claims({ email_verified: undefined })) } as never, req('Bearer t'))).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(autenticar({ auth: auth(claims({ firebase: { sign_in_provider: 'anonymous' } })) } as never, req('Bearer t'))).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(autenticar({ auth: auth(new Error('revocado')) } as never, req('Bearer t'))).rejects.toMatchObject({ code: 'unauthenticated' });
    for (const cab of [undefined, '', 'Basic abc', 'Bearer', 'bearer  ']) await expect(autenticar({ auth: ok } as never, req(cab))).rejects.toMatchObject({ code: 'unauthenticated' });
    // Rol del claim en ESE tenant: otro tenant, proveedor distinto o tenant inválido no pasan.
    expect(personalDelTenant(s, 'casa-a')).toMatchObject({ rol: 'caj', tenantId: 'casa-a' });
    expect(() => personalDelTenant(s, 'casa-b')).toThrow(expect.objectContaining({ code: 'permission-denied' }));
    expect(() => personalDelTenant(s, '../x')).toThrow(expect.objectContaining({ code: 'invalid-argument' }));
    const google = await autenticar({ auth: auth(claims({ firebase: { sign_in_provider: 'google.com' }, pl: { t: { 'casa-a': 'adm' }, p: true, v: 1 } })) } as never, req('Bearer t'));
    expect(google.propietario).toBe(true);
    expect(() => personalDelTenant(google, 'casa-a')).toThrow(expect.objectContaining({ code: 'permission-denied' }));
    // App Check solo se exige cuando la instalación lo pide.
    expect(() => exigirAppCheck(false, {} as never)).not.toThrow();
    expect(() => exigirAppCheck(true, { app: { appId: 'x' } } as never)).not.toThrow();
    expect(() => exigirAppCheck(true, {} as never)).toThrow(expect.objectContaining({ code: 'unauthenticated' }));
  });
});

describe('origen de la petición (X-Forwarded-For)', () => {
  it('toma la IP del último salto confiable: lo que el cliente antepone no cuenta', () => {
    // Hosting: <escrito por el cliente>, <cliente visto por Fastly>, <Fastly visto por el GFE>
    expect(ipDelCliente('9.9.9.9, 203.0.113.7, 151.101.1.1', 2)).toBe('203.0.113.7');
    expect(ipDelCliente('1.1.1.1, 2.2.2.2, 9.9.9.9, 203.0.113.7, 151.101.1.1', 2)).toBe('203.0.113.7');
    expect(ipDelCliente('203.0.113.7, 151.101.1.1', 2)).toBe('203.0.113.7');
    expect(ipDelCliente('2001:db8::1, 151.101.1.1', 2)).toBe('2001:db8::1');
  });
  it('con una sola dirección usa esa; sin cadena o con basura, desconocido', () => {
    expect(ipDelCliente('203.0.113.7', 2)).toBe('203.0.113.7');
    expect(ipDelCliente(undefined, 2)).toBe(ORIGEN_DESCONOCIDO);
    expect(ipDelCliente('', 2)).toBe(ORIGEN_DESCONOCIDO);
    expect(ipDelCliente('no-es-una-ip, 151.101.1.1', 2)).toBe(ORIGEN_DESCONOCIDO);
    expect(ipDelCliente('203.0.113.7, 151.101.1.1', 0)).toBe(ORIGEN_DESCONOCIDO);
  });
});

describe('configuración obligatoria fuera de las pruebas', () => {
  it('falla si falta la sal del límite o la base de medios (sin valores por defecto)', () => {
    expect(() => exigirConfiguracionDeServicio({ sal: '', mediosBaseUrl: 'https://medios.test' }, false)).toThrow(ConfiguracionIncompleta);
    expect(() => exigirConfiguracionDeServicio({ sal: 'x', mediosBaseUrl: '' }, false)).toThrow(/MEDIOS_BASE_URL/);
    expect(() => exigirConfiguracionDeServicio({ sal: 'x', mediosBaseUrl: 'http://medios.test' }, false)).toThrow(/MEDIOS_BASE_URL/);
    expect(() => exigirConfiguracionDeServicio({ sal: '', mediosBaseUrl: '' }, false)).toThrow(/LIMITE_TASA_SAL.*MEDIOS_BASE_URL/);
  });
  it('con todo presente normaliza la barra final; en pruebas admite vacíos', () => {
    expect(exigirConfiguracionDeServicio({ sal: 'sal', mediosBaseUrl: 'https://medios.test///' }, false)).toEqual({ sal: 'sal', mediosBaseUrl: 'https://medios.test' });
    expect(exigirConfiguracionDeServicio({ sal: '', mediosBaseUrl: '' }, true).mediosBaseUrl).toBe('');
  });
});

describe('límites en memoria antes de autenticar', () => {
  // `Entorno` mínimo: si el enrutador llegara a autenticar o a leer, tocaría `firestore` y la prueba fallaría.
  const e = {
    ahora: () => 1_000,
    firestore: new Proxy({}, { get: () => { throw new Error('tocó Firestore antes del límite'); } }),
    leerDisponibilidad: () => () => Promise.resolve({ 'tv-1': true }),
    guardarContacto: () => ({}),
    almacenCotizaciones: {},
  } as never;
  const cfg = (n: number): ConfigRouter => ({
    tenantId: 't', secretoReconstruccion: '', novuchat: {} as never, recaptcha: {} as never, appCheck: {} as never,
    limiteContacto: limiteMemoria(100, 60_000),
    limiteMemoria: { novuchat: limiteMemoria(n, 60_000), disponibilidad: limiteMemoria(n, 60_000) },
  });
  const peticion = (ruta: string, origen: string) => ({ metodo: 'GET', ruta, url: ruta, consulta: { ids: 'tv-1' }, cabeceras: { authorization: 'Bearer token-inventado' }, cuerpoCrudo: '', cuerpo: undefined, origen });

  it('NovuChat: pasado el máximo por origen responde 429 sin leer el token en Firestore', async () => {
    const c = cfg(2);
    // Las dos primeras llegan a autenticar (el Proxy lanza: eso prueba que el límite las dejó pasar).
    for (let i = 0; i < 2; i += 1) await expect(enrutar(e, peticion('/api/novuchat/v1/catalogo', '203.0.113.1'), c)).rejects.toThrow(/Firestore/);
    const r = await enrutar(e, peticion('/api/novuchat/v1/catalogo', '203.0.113.1'), c);
    expect(r.status).toBe(429);
    expect(Number(r.headers['Retry-After'])).toBeGreaterThan(0);
    // Otro origen tiene su propio cubo.
    await expect(enrutar(e, peticion('/api/novuchat/v1/inventario', '203.0.113.2'), c)).rejects.toThrow(/Firestore/);
  });

  it('disponibilidad: pasado el máximo por origen responde 429', async () => {
    const c = cfg(1);
    expect((await enrutar(e, peticion('/api/disponibilidad', '203.0.113.1'), c)).status).toBe(200);
    expect((await enrutar(e, peticion('/api/disponibilidad', '203.0.113.1'), c)).status).toBe(429);
    expect((await enrutar(e, peticion('/api/disponibilidad', '203.0.113.9'), c)).status).toBe(200);
  });
});
