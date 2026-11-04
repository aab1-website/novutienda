// Pruebas sin emulador: traducción de errores, política de redondeo, verificadores, composición de cabeceras y
// el marco de los callables con un entorno falso.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ErrorConsola } from '@plataforma/consola';
import { EntradaInvalida, ErrorInventario, OperacionConflicto, SinPermiso, StockInsuficiente } from '@plataforma/inventarios';
import { CargaNoAutorizada, ContadorCorrupto, ErrorEvento, ErrorIdentidad, LimiteDelPlan, SaltoSinConfirmar, SinCotizacionUtilizable } from '@plataforma/nucleo';
import { ErrorPos, type CodigoErrorPos } from '@plataforma/pos';
import { AccionNoPermitida, ErrorRecibo, ReciboNoEncontrado } from '@plataforma/recibos';
import {
  VideoNoDisponible, appCheckReal, appCheckSimulado, esEntornoDePruebas, recaptchaEnterprise, recaptchaSimulado, traducirError,
} from '../../plataforma/adaptadores/firebase/index.js';
import { componer } from '../../plataforma/funciones/scripts/componer-hosting.mjs';
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
