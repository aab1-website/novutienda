// Conector de Cloud Build (constructor del sitio), cola de tareas, filtro del aviso `cloud-builds` y configuración del modo `google`.
// Sin red: dobles de `fetch` y de la cola. Identificadores ficticios.
import { describe, expect, it } from 'vitest';
import {
  crearColaSitio, crearConstructorSitio, crearConsultaBuild, crearLectorSitios, idDeMensajeBuild, ErrorConstructorSitio, interpretarAvisoBuild, leerSitios,
  type ColaDeTareas, type FetchConstructor, type SitioDeConstruccion,
} from '../../plataforma/conectores/firebase/index.js';
import { nombreTareaRed } from '../../plataforma/funciones/servidor/entorno.js';
import { exigirConfiguracionConstructor, modoConstructorSitio, ConfiguracionIncompleta } from '../../plataforma/funciones/servidor/config.js';

const DIGEST = 'a'.repeat(64);
const IMAGEN = `us-east1-docker.pkg.dev/proy-prueba/sitio/constructor@sha256:${DIGEST}`;
const SITIOS: SitioDeConstruccion[] = [
  { clave: 'ab1', tenant: 'tienda-uno', sitio: 'sitio-uno-web', url: 'https://sitio-uno-web.example.com' },
  { clave: 'cd2', tenant: 'tienda-dos', sitio: 'sitio-dos-web', url: 'https://sitio-dos-web.example.com' },
];
const ENTORNO = {
  VITE_FIREBASE_PROJECT_ID: 'proy-prueba', VITE_FIREBASE_API_KEY: 'clave-publica', VITE_FIREBASE_APP_ID: 'app-id',
  VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: 'sitio-key', MEDIOS_BASE_URL: 'https://medios.example.com/', SITIOS_PROHIBIDOS: 'panel-prueba', APP_ENV: 'staging',
};

interface Llamada { url: string; init: Parameters<FetchConstructor>[1] }
function doble(respuesta: { ok?: boolean; status?: number; cuerpo?: unknown } | Error) {
  const llamadas: Llamada[] = [];
  const fetchFn: FetchConstructor = (url, init) => {
    llamadas.push({ url, init });
    if (respuesta instanceof Error) return Promise.reject(respuesta);
    return Promise.resolve({ ok: respuesta.ok ?? true, status: respuesta.status ?? 200, json: () => Promise.resolve(respuesta.cuerpo) });
  };
  return { llamadas, fetchFn };
}
const operacion = { name: 'projects/1/locations/us-east1/operations/op', metadata: { build: { id: 'b1b2c3d4-e5f6-7890' } } };

function constructor(fetchFn: FetchConstructor, extra: Record<string, unknown> = {}) {
  return crearConstructorSitio({
    proyecto: 'proy-prueba', imagen: IMAGEN, cuentaServicio: 'sitio-constructor', sitios: () => Promise.resolve(SITIOS), entorno: ENTORNO,
    tokenAcceso: () => Promise.resolve('TOKEN-DE-ACCESO'), fetchFn, ...extra,
  });
}

describe('constructor del sitio (Cloud Build por REST)', () => {
  it('arma el build exacto: un paso con la imagen por digest, secretos por nombre, cuenta, plazos y etiqueta', async () => {
    const d = doble({ cuerpo: operacion });
    const r = await constructor(d.fetchFn).lanzar('tienda-uno', 'rec-publicacion-v3-202611210900');
    expect(r).toEqual({ buildId: 'b1b2c3d4-e5f6-7890', imagen: IMAGEN });
    expect(d.llamadas).toHaveLength(1);
    const { url, init } = d.llamadas[0] as Llamada;
    expect(url).toBe('https://cloudbuild.googleapis.com/v1/projects/proy-prueba/locations/us-east1/builds');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.headers).toEqual({ Authorization: 'Bearer TOKEN-DE-ACCESO', 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({
      steps: [{
        name: IMAGEN,
        entrypoint: 'bash',
        args: ['-c', 'bash /app/scripts/reconstruir-sitio.sh reconstruir; rc=$$?; [ "$$rc" = 10 ] && exit 0; exit "$$rc"'],
        env: [
          'VITE_FIREBASE_PROJECT_ID=proy-prueba', 'VITE_FIREBASE_API_KEY=clave-publica', 'VITE_FIREBASE_APP_ID=app-id',
          'VITE_RECAPTCHA_ENTERPRISE_SITE_KEY=sitio-key', 'MEDIOS_BASE_URL=https://medios.example.com/', 'SITIOS_PROHIBIDOS=panel-prueba', 'APP_ENV=staging',
          'CLAVE=ab1', 'TENANT=tienda-uno', 'SITIO=sitio-uno-web', 'URL_SITIO=https://sitio-uno-web.example.com',
          'PROYECTO=proy-prueba', 'TRABAJO=rec-publicacion-v3-202611210900', 'OMITIR_INSTALAR=1', `VITE_APP_VERSION=${DIGEST.slice(0, 12)}`,
          'BUILD_ID=$BUILD_ID',
        ],
        secretEnv: ['SITIO_RECONSTRUCCION_SECRETO', 'SITIO_NEGOCIO_AB1'],
      }],
      availableSecrets: {
        secretManager: [
          { versionName: 'projects/proy-prueba/secrets/SITIO_RECONSTRUCCION_SECRETO/versions/latest', env: 'SITIO_RECONSTRUCCION_SECRETO' },
          { versionName: 'projects/proy-prueba/secrets/SITIO_NEGOCIO_AB1/versions/latest', env: 'SITIO_NEGOCIO_AB1' },
        ],
      },
      serviceAccount: 'projects/proy-prueba/serviceAccounts/sitio-constructor@proy-prueba.iam.gserviceaccount.com',
      timeout: '300s',
      queueTtl: '120s',
      options: { logging: 'CLOUD_LOGGING_ONLY' },
      tags: ['sitio-ab1'],
    });
  });

  it('no pone ningún secreto en claro: solo nombres de versión; el cuerpo no lleva el token', async () => {
    const d = doble({ cuerpo: operacion });
    await constructor(d.fetchFn).lanzar('tienda-dos', 'rec-1');
    const cuerpo = (d.llamadas[0] as Llamada).init.body;
    expect(cuerpo).not.toContain('TOKEN-DE-ACCESO');
    expect(cuerpo).toContain('SITIO_NEGOCIO_CD2');
    expect(cuerpo).not.toContain('SITIO_NEGOCIO_AB1');
    expect(cuerpo).not.toMatch(/"(SITIO_RECONSTRUCCION_SECRETO|SITIO_NEGOCIO)[^"]*=/);
  });

  it('la máquina solo viaja si se configura', async () => {
    const d = doble({ cuerpo: operacion });
    await constructor(d.fetchFn, { maquina: 'E2_HIGHCPU_8' }).lanzar('tienda-uno', 'rec-1');
    expect(JSON.parse((d.llamadas[0] as Llamada).init.body).options).toEqual({ logging: 'CLOUD_LOGGING_ONLY', machineType: 'E2_HIGHCPU_8' });
  });

  it('un error HTTP lanza con el estado y sin el cuerpo de la respuesta ni el token', async () => {
    const d = doble({ ok: false, status: 403, cuerpo: { error: 'detalle-secreto-de-google' } });
    const e = await constructor(d.fetchFn).lanzar('tienda-uno', 'rec-1').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorConstructorSitio);
    expect((e as ErrorConstructorSitio).estado).toBe(403);
    expect((e as Error).message).not.toContain('detalle-secreto');
    expect((e as Error).message).not.toContain('TOKEN');
  });

  it('una caída de red, un token que falla o una respuesta sin id lanzan con su estado', async () => {
    const red = await constructor(doble(new Error('ECONNRESET con TOKEN')).fetchFn).lanzar('tienda-uno', 'rec-1').catch((x: unknown) => x);
    expect((red as ErrorConstructorSitio).estado).toBe('red');
    expect((red as Error).message).not.toContain('ECONNRESET');
    const sinToken = await constructor(doble({ cuerpo: operacion }).fetchFn, { tokenAcceso: () => Promise.reject(new Error('x')) }).lanzar('tienda-uno', 'rec-1').catch((x: unknown) => x);
    expect((sinToken as ErrorConstructorSitio).estado).toBe('red');
    const sinId = await constructor(doble({ cuerpo: { name: 'op' } }).fetchFn).lanzar('tienda-uno', 'rec-1').catch((x: unknown) => x);
    expect((sinId as ErrorConstructorSitio).estado).toBe('respuesta');
  });

  it('un tenant sin sitio o un trabajo de forma inválida no llaman a la red', async () => {
    const d = doble({ cuerpo: operacion });
    await expect(constructor(d.fetchFn).lanzar('otro-tenant', 'rec-1')).rejects.toThrow(/no tiene sitio/);
    await expect(constructor(d.fetchFn).lanzar('tienda-uno', 'rec 1; rm')).rejects.toThrow(/trabajo/);
    expect(d.llamadas).toHaveLength(0);
  });

  it('falla cerrado al crearlo: imagen sin digest, cuenta o proyecto inválidos, variable con «$»', () => {
    const f = doble({}).fetchFn;
    expect(() => constructor(f, { imagen: 'us-east1-docker.pkg.dev/p/r/i:latest' })).toThrow(/digest/);
    expect(() => constructor(f, { cuentaServicio: 'X' })).toThrow(/cuenta/);
    expect(() => constructor(f, { proyecto: 'Mal Proyecto' })).toThrow(/proyecto/);
    expect(() => constructor(f, { entorno: { ...ENTORNO, MEDIOS_BASE_URL: 'https://$HOST' } })).toThrow(/variable/);
  });

  it('acepta la cuenta de servicio como correo', async () => {
    const d = doble({ cuerpo: operacion });
    await constructor(d.fetchFn, { cuentaServicio: 'sitio-constructor@proy-prueba.iam.gserviceaccount.com' }).lanzar('tienda-uno', 'rec-1');
    expect(JSON.parse((d.llamadas[0] as Llamada).init.body).serviceAccount).toBe('projects/proy-prueba/serviceAccounts/sitio-constructor@proy-prueba.iam.gserviceaccount.com');
  });
});

describe('SITIOS_TENANT', () => {
  it('lee la lista y falla cerrado sin imprimir valores', () => {
    expect(leerSitios(JSON.stringify(SITIOS))).toEqual(SITIOS);
    expect(() => leerSitios('no json')).toThrow(/JSON/);
    expect(() => leerSitios('[]')).toThrow(/lista/);
    expect(() => leerSitios(JSON.stringify([{ ...SITIOS[0], url: 'http://x.example.com' }]))).toThrow(/entrada 1/);
    expect(() => leerSitios(JSON.stringify([SITIOS[0], SITIOS[0]]))).toThrow(/repetida/);
    for (const url of ['https://Sitio.example.com', 'https://a.example.com/ruta', 'https://a.example.com?x=1', 'https://u@a.example.com', 'https://a.example.com:99999x', 'https://a b.example.com', 'https://a.example.com$']) {
      expect(() => leerSitios(JSON.stringify([{ ...SITIOS[0], url }])), url).toThrow(/entrada 1/);
    }
    expect(leerSitios(JSON.stringify([{ ...SITIOS[0], url: 'https://a.example.com:8443/' }]))).toHaveLength(1);
  });
});

describe('construcción del paso: valores de sitio y BUILD_ID', () => {
  it('un valor de sitio con «$» o salto de línea (aunque venga ya validado) no llama a la red', async () => {
    const d = doble({ cuerpo: operacion });
    const c = constructor(d.fetchFn, { sitios: () => Promise.resolve([{ ...SITIOS[0] as SitioDeConstruccion, sitio: 'sitio-$HOME' }]) });
    await expect(c.lanzar('tienda-uno', 'rec-1')).rejects.toThrow(/carácter no admitido/);
    expect(d.llamadas).toHaveLength(0);
  });

  it('BUILD_ID es la sustitución integrada y no pasa por el filtro de «$» de las variables públicas', async () => {
    const d = doble({ cuerpo: operacion });
    await constructor(d.fetchFn).lanzar('tienda-uno', 'rec-1');
    expect(JSON.parse((d.llamadas[0] as Llamada).init.body).steps[0].env).toContain('BUILD_ID=$BUILD_ID');
  });
});

describe('consulta builds.get del aviso', () => {
  const ID = 'b1b2c3d4-e5f6-7890';
  function consulta(r: { ok?: boolean; status?: number; cuerpo?: unknown } | Error) {
    const urls: string[] = [];
    const f = crearConsultaBuild({
      proyecto: 'proy-prueba', tokenAcceso: () => Promise.resolve('T'),
      fetchFn: (url) => { urls.push(url); return r instanceof Error ? Promise.reject(r) : Promise.resolve({ ok: r.ok ?? true, status: r.status ?? 200, json: () => Promise.resolve(r.cuerpo) }); },
    });
    return { f, urls };
  }

  it('toma estado y etiquetas de la respuesta, no del mensaje', async () => {
    const c = consulta({ cuerpo: { id: ID, status: 'SUCCESS', tags: ['sitio-ab1', 3] } });
    expect(await c.f(ID)).toEqual({ id: ID, status: 'SUCCESS', tags: ['sitio-ab1'] });
    expect(c.urls).toEqual([`https://cloudbuild.googleapis.com/v1/projects/proy-prueba/locations/us-east1/builds/${ID}`]);
  });

  it('rechaza un id raro sin llamar, una respuesta de otro build y los errores de HTTP o red', async () => {
    const c = consulta({ cuerpo: { id: ID, status: 'SUCCESS' } });
    await expect(c.f('../x')).rejects.toThrow(/inválido/);
    expect(c.urls).toHaveLength(0);
    await expect(consulta({ cuerpo: { id: 'otro-id-distinto', status: 'SUCCESS' } }).f(ID)).rejects.toThrow(/distinta/);
    expect(((await consulta({ ok: false, status: 404 }).f(ID).catch((e: unknown) => e)) as ErrorConstructorSitio).estado).toBe(404);
    expect(((await consulta(new Error('x')).f(ID).catch((e: unknown) => e)) as ErrorConstructorSitio).estado).toBe('red');
  });

  it('del mensaje solo se toma el id', () => {
    expect(idDeMensajeBuild({ id: ID, status: 'SUCCESS', tags: ['sitio-ab1'] })).toBe(ID);
    expect(idDeMensajeBuild({ id: '../x' })).toBeUndefined();
    expect(idDeMensajeBuild(null)).toBeUndefined();
  });
});

describe('lectura de SITIOS_TENANT desde Secret Manager', () => {
  const dato = Buffer.from(JSON.stringify(SITIOS)).toString('base64');
  function lector(r: { ok?: boolean; status?: number; cuerpo?: unknown } | Error, reloj = { t: 0 }) {
    const urls: string[] = [];
    const cabeceras: Record<string, string>[] = [];
    const l = crearLectorSitios({
      proyecto: 'proy-prueba', nombre: 'SITIOS_TENANT', tokenAcceso: () => Promise.resolve('TOKEN-SM'), ahora: () => reloj.t,
      fetchFn: (url, init) => {
        urls.push(url); cabeceras.push(init.headers);
        if (r instanceof Error) return Promise.reject(r);
        return Promise.resolve({ ok: r.ok ?? true, status: r.status ?? 200, json: () => Promise.resolve(r.cuerpo) });
      },
    });
    return { l, urls, cabeceras, reloj };
  }

  it('lee la última versión, decodifica y guarda en caché 5 minutos', async () => {
    const x = lector({ cuerpo: { payload: { data: dato } } });
    expect(await x.l()).toEqual(SITIOS);
    expect(x.urls).toEqual(['https://secretmanager.googleapis.com/v1/projects/proy-prueba/secrets/SITIOS_TENANT/versions/latest:access']);
    expect(x.cabeceras[0]).toEqual({ Authorization: 'Bearer TOKEN-SM' });
    x.reloj.t = 299_000;
    await x.l();
    expect(x.urls).toHaveLength(1);
    x.reloj.t = 301_000;
    await x.l();
    expect(x.urls).toHaveLength(2);
  });

  it('errores: estado HTTP, red y contenido inválido, sin valores en el mensaje', async () => {
    const http = await lector({ ok: false, status: 403, cuerpo: { error: 'detalle-secreto' } }).l().catch((e: unknown) => e);
    expect((http as ErrorConstructorSitio).estado).toBe(403);
    expect((http as Error).message).not.toContain('detalle-secreto');
    expect(((await lector(new Error('x')).l().catch((e: unknown) => e)) as ErrorConstructorSitio).estado).toBe('red');
    expect(((await lector({ cuerpo: {} }).l().catch((e: unknown) => e)) as ErrorConstructorSitio).estado).toBe('respuesta');
    await expect(lector({ cuerpo: { payload: { data: Buffer.from('no json').toString('base64') } } }).l()).rejects.toThrow(/JSON/);
  });

  it('el despliegue no enlaza SITIOS_TENANT con defineSecret (no exige que exista en modo github)', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['config.ts', 'index.ts', 'entorno.ts']) {
      expect(readFileSync(new URL(`../../plataforma/funciones/servidor/${f}`, import.meta.url), 'utf8')).not.toMatch(/defineSecret\('SITIOS_TENANT'\)|SECRETOS\.sitiosTenant/);
    }
  });
});

describe('filtro del aviso de cloud-builds', () => {
  const build = (extra: Record<string, unknown>) => ({ id: 'b1b2c3d4-e5f6-7890', status: 'SUCCESS', tags: ['sitio-ab1'], ...extra });

  it('un build con etiqueta de sitio conocido entrega tenant, id y estado', () => {
    expect(interpretarAvisoBuild(build({}), SITIOS)).toEqual({ tenantId: 'tienda-uno', buildId: 'b1b2c3d4-e5f6-7890', estado: 'SUCCESS' });
    expect(interpretarAvisoBuild(build({ status: 'TIMEOUT', tags: ['otra', 'sitio-cd2'] }), SITIOS)?.tenantId).toBe('tienda-dos');
  });

  it('ignora lo que no es de un sitio: sin etiqueta, clave desconocida, forma inválida', () => {
    expect(interpretarAvisoBuild(build({ tags: [] }), SITIOS)).toBeUndefined();
    expect(interpretarAvisoBuild(build({ tags: ['panel'] }), SITIOS)).toBeUndefined();
    expect(interpretarAvisoBuild(build({ tags: ['sitio-zz9'] }), SITIOS)).toBeUndefined();
    expect(interpretarAvisoBuild(build({ tags: ['sitio-AB1'] }), SITIOS)).toBeUndefined();
    expect(interpretarAvisoBuild(build({ tags: undefined }), SITIOS)).toBeUndefined();
    expect(interpretarAvisoBuild(build({ id: 7 }), SITIOS)).toBeUndefined();
    expect(interpretarAvisoBuild(null, SITIOS)).toBeUndefined();
    expect(interpretarAvisoBuild('texto', SITIOS)).toBeUndefined();
  });
});

describe('cola de tareas del sitio', () => {
  const tarea = { nombre: 'sitio-tienda-uno-1000', tenantId: 'tienda-uno', para: 5000 };

  it('encola con nombre idempotente, a la hora agendada y con plazo', async () => {
    const llamadas: Parameters<ColaDeTareas['enqueue']>[] = [];
    const cola: ColaDeTareas = { enqueue: (...a) => { llamadas.push(a); return Promise.resolve(); } };
    await crearColaSitio(cola, () => 1000).encolar(tarea);
    expect(llamadas).toEqual([[{ tenantId: 'tienda-uno', para: 5000 }, { id: 'sitio-tienda-uno-1000', scheduleTime: new Date(5000), dispatchDeadlineSeconds: 60 }]]);
  });

  it('una hora ya pasada se despacha de inmediato', async () => {
    const llamadas: Parameters<ColaDeTareas['enqueue']>[] = [];
    await crearColaSitio({ enqueue: (...a) => { llamadas.push(a); return Promise.resolve(); } }, () => 9000).encolar(tarea);
    expect(llamadas[0]?.[1].scheduleTime).toEqual(new Date(9000));
  });

  it('una tarea que ya existe se ignora; cualquier otro error sube', async () => {
    const existe = { enqueue: () => Promise.reject(Object.assign(new Error('x'), { code: 'functions/task-already-exists' })) };
    await expect(crearColaSitio(existe).encolar(tarea)).resolves.toBeUndefined();
    await expect(crearColaSitio({ enqueue: () => Promise.reject(new Error('caída')) }).encolar(tarea)).rejects.toThrow('caída');
  });

  it('rechaza un nombre con caracteres no admitidos', async () => {
    await expect(crearColaSitio({ enqueue: () => Promise.resolve() }).encolar({ ...tarea, nombre: 'a/b' })).rejects.toThrow(/nombre/);
  });
});

describe('modo y configuración del constructor', () => {
  it('solo el valor exacto «google» activa Cloud Build; todo lo demás es github', () => {
    expect(modoConstructorSitio('google')).toBe('google');
    expect(modoConstructorSitio(' google ')).toBe('google');
    for (const v of ['', 'github', 'Google', 'GOOGLE', 'si', 'true']) expect(modoConstructorSitio(v)).toBe('github');
  });

  const completa = {
    proyecto: 'proy-prueba', imagen: IMAGEN, cuenta: 'sitio-constructor', cuentaFn: 'fn-constructor', maquina: '', appEnv: 'staging', apiKey: 'k', appId: 'a', recaptcha: 'r',
    panel: 'panel-prueba', mediosBaseUrl: 'https://medios.example.com/',
  };

  it('arma el entorno público del build y deja la máquina ausente si no se configura', () => {
    const c = exigirConfiguracionConstructor(completa);
    expect(c.maquina).toBeUndefined();
    expect(c.entorno).toEqual({
      VITE_FIREBASE_PROJECT_ID: 'proy-prueba', VITE_FIREBASE_API_KEY: 'k', VITE_FIREBASE_APP_ID: 'a', VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: 'r',
      MEDIOS_BASE_URL: 'https://medios.example.com/', SITIOS_PROHIBIDOS: 'panel-prueba', APP_ENV: 'staging',
    });
  });

  it('exige la cuenta propia de las funciones del constructor (nunca la cuenta general)', () => {
    for (const cuentaFn of ['', '  ']) {
      expect(() => exigirConfiguracionConstructor({ ...completa, cuentaFn })).toThrow(/CUENTA_FN_CONSTRUCTOR_SITIO/);
    }
  });

  it('el nombre de la tarea de la red cambia cada 5 minutos y es idempotente dentro del tramo', () => {
    const a = nombreTareaRed('tienda-uno', 'rec-1', 1_000_000);
    expect(nombreTareaRed('tienda-uno', 'rec-1', 1_000_000 + 60_000)).toBe(a);
    expect(nombreTareaRed('tienda-uno', 'rec-1', 1_000_000 + 300_000)).not.toBe(a);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(nombreTareaRed('tienda-uno', 'rec.1', 0)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('APP_ENV solo admite staging o production', () => {
    expect(() => exigirConfiguracionConstructor({ ...completa, appEnv: 'prod' })).toThrow(/CONSTRUCTOR_SITIO_APP_ENV/);
    expect(exigirConfiguracionConstructor({ ...completa, appEnv: 'production' }).entorno['APP_ENV']).toBe('production');
  });

  it('falla cerrado listando los nombres que faltan, sin valores', () => {
    try {
      exigirConfiguracionConstructor({ ...completa, imagen: ' ', panel: '' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfiguracionIncompleta);
      expect((e as Error).message).toContain('CONSTRUCTOR_SITIO_IMAGEN');
      expect((e as Error).message).toContain('SITIO_PANEL_ID');
      expect((e as Error).message).not.toContain('proy-prueba');
    }
  });
});
