import type { AppCheck, AppCheckOptions } from 'firebase/app-check';
import { describe, expect, it, vi } from 'vitest';
import type { ConfigAppCheck } from '../contenido/tipos.js';
import { crearProveedorAppCheck, instalarCbAppCheck, type SdkAppCheck } from './appcheck.js';

const config: ConfigAppCheck = { claveSitio: 'clave-sitio-publica', apiKey: 'apikey-publica-0000000', appId: '1:123:web:abcdef12', projectId: 'proyecto-x' };
const appCheckFalso = { nombre: 'ac' } as unknown as AppCheck;

function doble(): { sdk: SdkAppCheck; cargar: ReturnType<typeof vi.fn<() => Promise<SdkAppCheck>>>; sdkObj: Record<string, ReturnType<typeof vi.fn>> } {
  let n = 0;
  const sdkObj = {
    initializeApp: vi.fn(() => ({ name: 'cb-contacto' })),
    initializeAppCheck: vi.fn<(a: unknown, o: AppCheckOptions) => AppCheck>(() => appCheckFalso),
    crearProveedor: vi.fn((clave: string) => ({ clave })),
    getLimitedUseToken: vi.fn(() => Promise.resolve({ token: `token-${(n += 1)}` })),
  };
  const sdk = sdkObj as unknown as SdkAppCheck;
  return { sdk, sdkObj, cargar: vi.fn<() => Promise<SdkAppCheck>>(() => Promise.resolve(sdk)) };
}

describe('App Check de un solo uso del sitio', () => {
  it('no descarga el SDK hasta que se prepara o se pide el primer token', () => {
    const d = doble();
    crearProveedorAppCheck(config, d.cargar);
    expect(d.cargar).not.toHaveBeenCalled();
  });

  it('inicializa una sola vez con reCAPTCHA Enterprise, sin renovación automática, y la app lleva appId', async () => {
    const d = doble();
    const p = crearProveedorAppCheck(config, d.cargar);
    await p.preparar();
    await p.token();
    await p.token();
    expect(d.cargar).toHaveBeenCalledTimes(1);
    expect(d.sdkObj['initializeApp']).toHaveBeenCalledWith({ apiKey: config.apiKey, appId: config.appId, projectId: config.projectId }, 'cb-contacto');
    expect(d.sdkObj['crearProveedor']).toHaveBeenCalledWith(config.claveSitio);
    expect(d.sdkObj['initializeAppCheck']).toHaveBeenCalledTimes(1);
    expect(d.sdkObj['initializeAppCheck']?.mock.calls[0]?.[1]).toMatchObject({ isTokenAutoRefreshEnabled: false });
  });

  it('cada envío pide un token de uso limitado NUEVO', async () => {
    const d = doble();
    const p = crearProveedorAppCheck(config, d.cargar);
    const a = await p.token();
    const b = await p.token();
    expect(a).not.toBe(b);
    expect(d.sdkObj['getLimitedUseToken']).toHaveBeenCalledTimes(2);
    expect(d.sdkObj['getLimitedUseToken']).toHaveBeenCalledWith(appCheckFalso);
  });

  it('si la descarga falla, rechaza y permite reintentar', async () => {
    const d = doble();
    d.cargar.mockRejectedValueOnce(new Error('red'));
    const p = crearProveedorAppCheck(config, d.cargar);
    await expect(p.token()).rejects.toThrow('red');
    await expect(p.token()).resolves.toBe('token-1');
    expect(d.cargar).toHaveBeenCalledTimes(2);
  });

  it('sin configuración no registra window.cbAppCheck; con ella lo registra', async () => {
    const destino: Record<string, unknown> = {};
    expect(instalarCbAppCheck(null, destino)).toBeNull();
    expect(destino['cbAppCheck']).toBeUndefined();
    const d = doble();
    expect(instalarCbAppCheck(config, destino, d.cargar)).not.toBeNull();
    expect(typeof destino['cbAppCheck']).toBe('function');
    expect(await (destino['cbAppCheck'] as () => Promise<string>)()).toBe('token-1');
  });
});
