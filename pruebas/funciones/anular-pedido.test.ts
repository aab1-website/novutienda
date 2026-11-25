// scripts/anular-pedido.mjs: validación, guardia de staging, --seco y firma verificable con el código del servidor.
import { describe, expect, it, vi } from 'vitest';
import { calcularFirma } from '@novutienda/nucleo/servidor';
import { ejecutar } from '../../scripts/anular-pedido.mjs';

const SITIOS = JSON.stringify([{ clave: 'a1', tenant: 'tienda-a', sitio: 'sitio-aaaa', url: 'https://a-stg.web.app' }]);
const base = ['--proyecto', 'proy-demo-stg', '--tenant', 'tienda-a', '--pedido', 'PED-1', '--sitios', SITIOS];
const env = { GOOGLE_CLOUD_PROJECT: 'proy-demo-stg', NOVUTIENDA_AMBIENTE: 'staging', GCP_PROJECT_ID_STAGING: 'proy-demo-stg', GCP_PROJECT_ID_PROD: 'proy-demo-prod' };
const SECRETO = 'secreto-de-prueba';

describe('anular-pedido', () => {
  it('valida el formato de cada argumento', async () => {
    expect((await ejecutar(['--proyecto', 'x'], env)).codigo).toBe(2);
    expect((await ejecutar(['--proyecto', 'MAL', '--tenant', 'tienda-a', '--pedido', 'p', '--sitios', SITIOS], env)).codigo).toBe(2);
    expect((await ejecutar(['--proyecto', 'proy-demo-stg', '--tenant', 'A B', '--pedido', 'p', '--sitios', SITIOS], env)).codigo).toBe(2);
    expect((await ejecutar(['--proyecto', 'proy-demo-stg', '--tenant', 'tienda-a', '--pedido', 'a/b', '--sitios', SITIOS], env)).codigo).toBe(2);
    expect((await ejecutar(['--proyecto', 'proy-demo-stg', '--tenant', 'otra', '--pedido', 'p', '--sitios', SITIOS], env)).codigo).toBe(2);
  });

  it('se niega fuera del proyecto de staging, sin modo producción', async () => {
    const prod = ['--proyecto', 'proy-demo-prod', '--tenant', 'tienda-a', '--pedido', 'PED-1', '--sitios', SITIOS, '--seco'];
    const envProd = { ...env, GOOGLE_CLOUD_PROJECT: 'proy-demo-prod', NOVUTIENDA_AMBIENTE: 'produccion' };
    expect((await ejecutar(prod, envProd)).codigo).toBe(2);
    expect((await ejecutar([...prod, '--produccion'], envProd)).codigo).toBe(2);
    expect((await ejecutar(prod, { ...env, GOOGLE_CLOUD_PROJECT: 'proy-demo-prod' })).codigo).toBe(2);
  });

  it('exige --sitios explícito y un host de staging', async () => {
    const sin = base.slice(0, -2);
    const r = await ejecutar(sin, { ...env, SITIOS_TENANT: SITIOS });
    expect(r.codigo).toBe(2);
    expect(r.error).toMatch(/--sitios/);
    const prodSitios = JSON.stringify([{ clave: 'a1', tenant: 'tienda-a', sitio: 'sitio-aaaa', url: 'https://a.web.app' }]);
    const r2 = await ejecutar([...sin, '--sitios', prodSitios, '--seco'], env);
    expect(r2.codigo).toBe(2);
    expect(r2.error).toMatch(/staging/);
  });

  it('--seco muestra host y cuerpo, sin leer el secreto ni enviar', async () => {
    const leerSecreto = vi.fn();
    const fetchFn = vi.fn();
    const r = await ejecutar([...base, '--seco'], env, { leerSecreto, fetchFn: fetchFn as never, ahora: () => 1_700_000_000_000 });
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('https://a-stg.web.app/api/novuchat/v1/pedidos/anular');
    expect(r.salida).toContain('{"pedidoId":"PED-1","anuladoEn":"2023-11-14T22:13:20.000Z","tenantId":"tienda-a"}');
    expect(r.salida).not.toMatch(/firma/i);
    expect(leerSecreto).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('firma "{marca}.{cuerpo}" y solo imprime código y JSON', async () => {
    const fetchFn = vi.fn(async () => new Response('{"ok":true,"repetida":false}', { status: 200 }));
    const r = await ejecutar(base, env, { leerSecreto: () => SECRETO, fetchFn: fetchFn as never, ahora: () => 1_700_000_000_000 });
    expect(r).toEqual({ codigo: 0, salida: 'HTTP 200\n{"ok":true,"repetida":false}' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://a-stg.web.app/api/novuchat/v1/pedidos/anular');
    expect(init.headers['x-marca-tiempo']).toBe('1700000000000');
    expect(init.headers['x-firma']).toBe(calcularFirma(SECRETO, '1700000000000', init.body));
    expect(JSON.stringify(r)).not.toContain(SECRETO);
  });

  it('un rechazo del endpoint da código 1 y un fallo del secreto, 3, sin filtrar valores', async () => {
    const f409 = vi.fn(async () => new Response('{"ok":false,"error":"pedido-no-encontrado"}', { status: 409 }));
    expect((await ejecutar(base, env, { leerSecreto: () => SECRETO, fetchFn: f409 as never })).codigo).toBe(1);
    const r = await ejecutar(base, env, { leerSecreto: () => { throw new Error('no se pudo leer el secreto de Secret Manager'); } });
    expect(r.codigo).toBe(3);
  });
});
