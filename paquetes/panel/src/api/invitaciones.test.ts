import { describe, expect, it } from 'vitest';
import type { ClienteApi } from './cliente.js';
import { conCorreoDeInvitacion, llamarInvitacion, type FaseInvitacion } from './invitaciones.js';

function armar(): { api: ClienteApi; enviados: string[]; llamadas: string[] } {
  const enviados: string[] = [];
  const llamadas: string[] = [];
  const base = { llamar: (n: string) => { llamadas.push(n); return Promise.resolve({}); } } as unknown as ClienteApi;
  const api = conCorreoDeInvitacion(base, { enviarEnlaceDeAcceso: (c) => { enviados.push(c); return Promise.resolve(true); } });
  return { api, enviados, llamadas };
}

describe('conCorreoDeInvitacion: fases y opción sinCorreo', () => {
  it('emite «registrando» y luego «enviando», y envía el correo', async () => {
    const { api, enviados } = armar();
    const fases: FaseInvitacion[] = [];
    await llamarInvitacion(api, 'invitarUsuario', { correo: 'a@ejemplo.test', rol: 'caj' }, { alFase: (f) => fases.push(f) });
    expect(fases).toEqual(['registrando', 'enviando']);
    expect(enviados).toEqual(['a@ejemplo.test']);
  });

  it('con sinCorreo solo emite «registrando» y no envía correo', async () => {
    const { api, enviados, llamadas } = armar();
    const fases: FaseInvitacion[] = [];
    await llamarInvitacion(api, 'invitarUsuario', { correo: 'a@ejemplo.test', rol: 'sup' }, { sinCorreo: true, alFase: (f) => fases.push(f) });
    expect(fases).toEqual(['registrando']);
    expect(enviados).toEqual([]);
    expect(llamadas).toEqual(['invitarUsuario']);
  });
});
