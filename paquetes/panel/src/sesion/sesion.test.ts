import { describe, expect, it } from 'vitest';
import { CUENTAS_DOBLE, SesionDoble } from './doble.js';

describe('sesión (doble)', () => {
  it('un correo no verificado no entra', async () => {
    const s = new SesionDoble();
    expect(await s.iniciar('nuevo@ejemplo.test', 'clave-nuevo-1')).toEqual({ tipo: 'correo-no-verificado' });
    expect(s.actual()).toBeNull();
    await s.reenviarVerificacion();
    expect(s.verificacionesReenviadas).toBe(1);
  });
  it('credenciales incorrectas no entran', async () => {
    const s = new SesionDoble();
    expect((await s.iniciar('adm@ejemplo.test', 'mal')).tipo).toBe('credenciales-invalidas');
    expect((await s.iniciar('nadie@ejemplo.test', 'x')).tipo).toBe('credenciales-invalidas');
  });
  it('entra con rol y tenant del claim, avisa a los oyentes y cierra', async () => {
    const s = new SesionDoble();
    const vistos: (string | null)[] = [];
    const baja = s.alCambiar((u) => vistos.push(u?.rol ?? null));
    const r = await s.iniciar(' SUP@ejemplo.test ', 'clave-sup-1');
    expect(r.tipo).toBe('ok');
    expect(s.actual()).toMatchObject({ rol: 'sup', tenantId: 'demo' });
    await s.cerrar();
    baja();
    await s.iniciar('adm@ejemplo.test', 'clave-adm-1');
    expect(vistos).toEqual(['sup', null]);
    expect(CUENTAS_DOBLE.length).toBe(4);
  });
});
