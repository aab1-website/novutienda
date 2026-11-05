import type { FirebaseApp } from 'firebase/app';
import type { AppCheck, AppCheckOptions } from 'firebase/app-check';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { iniciarAppCheck, reiniciarAppCheckParaPruebas } from './appcheck.js';
import { proveedorEmulador } from './emulador.js';

const app = {} as FirebaseApp;
const falso = (): { inicializar: Mock<(a: FirebaseApp, o: AppCheckOptions) => AppCheck>; registrar: Mock<(m: string) => void> } => ({ inicializar: vi.fn<(a: FirebaseApp, o: AppCheckOptions) => AppCheck>(), registrar: vi.fn<(m: string) => void>() });

describe('App Check del panel', () => {
  beforeEach(() => reiniciarAppCheckParaPruebas());

  it('sin clave de sitio no se inicializa y lo registra en consola', () => {
    const f = falso();
    expect(iniciarAppCheck(app, { claveSitio: '', inicializar: f.inicializar, registrar: f.registrar })).toBe('omitido');
    expect(f.inicializar).not.toHaveBeenCalled();
    expect(f.registrar).toHaveBeenCalledWith(expect.stringContaining('VITE_RECAPTCHA_ENTERPRISE_SITE_KEY'));
  });

  it('con clave de sitio usa reCAPTCHA Enterprise con renovación automática, una sola vez', () => {
    const f = falso();
    const o = { claveSitio: ' clave-publica ', inicializar: f.inicializar, registrar: f.registrar };
    expect(iniciarAppCheck(app, o)).toBe('recaptcha');
    expect(iniciarAppCheck(app, o)).toBe('recaptcha');
    expect(f.inicializar).toHaveBeenCalledTimes(1);
    const opciones = f.inicializar.mock.calls[0]?.[1] as AppCheckOptions;
    expect(opciones.isTokenAutoRefreshEnabled).toBe(true);
    expect(opciones.provider.constructor.name).toBe('ReCaptchaEnterpriseProvider');
    expect(f.registrar).not.toHaveBeenCalled();
  });

  it('en el emulador usa el proveedor del emulador aunque no haya clave', async () => {
    const f = falso();
    expect(iniciarAppCheck(app, { claveSitio: undefined, proveedorEmulador, inicializar: f.inicializar, registrar: f.registrar })).toBe('emulador');
    const opciones = f.inicializar.mock.calls[0]?.[1] as AppCheckOptions;
    expect(opciones.provider).toBe(proveedorEmulador);
    const t = await (proveedorEmulador as unknown as { getToken(): Promise<{ token: string; expireTimeMillis: number }> }).getToken();
    const [, carga] = t.token.split('.');
    expect(JSON.parse(atob((carga ?? '').replace(/-/g, '+').replace(/_/g, '/')))).toMatchObject({ sub: expect.stringContaining('web') as string });
    expect(t.expireTimeMillis).toBeGreaterThan(Date.now());
  });
});
