// El marco registra los rechazos de los callables: ruta y code de zod (nunca mensaje ni valor) y el código de los HttpsError.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accion, actorPos, comoHttpsError, type Contexto } from '../../plataforma/funciones/servidor/llamadas/marco.js';

// El logger de `firebase-functions` toma `console.warn` al cargarse: se intercepta antes de los imports (hoisted).
const avisos = vi.hoisted(() => {
  const lista: string[] = [];
  console.warn = (...a: unknown[]): void => { lista.push(a.map(String).join(' ')); };
  return lista;
});

const marca = { modulo: 'pos', accion: 'vender', tenantId: 't1', uid: 'u1' };
// Doble mínimo de un esquema zod (la prueba no importa zod: el paquete vive en plataforma/funciones): rechaza con dos errores,
// uno cuyo mensaje incluye el valor recibido, como el de un enum.
const esquema = {
  safeParse: () => ({
    success: false,
    error: {
      issues: [
        { path: ['tipo'], code: 'invalid_value', message: 'Invalid option: expected one of "a"|"b", received "SECRETO-123"' },
        { path: ['n'], code: 'invalid_type', message: 'Invalid input: expected number, received string' },
      ],
    },
  }),
} as unknown as Parameters<typeof accion>[0]['esquema'];

beforeEach(() => { avisos.length = 0; });

describe('registro de rechazos del marco', () => {
  it('esquema inválido: registra warn con ruta y code, sin mensaje ni valor recibido', () => {
    const impl = accion({ esquema, ejecutar: async () => 1 });
    let error: unknown;
    try {
      void impl.ejecutar({} as Contexto, { tipo: 'SECRETO-123', n: 'x', extra: 1 });
    } catch (e) {
      error = e;
    }
    const h = comoHttpsError(error, marca);
    expect(h.code).toBe('invalid-argument');
    expect(avisos).toHaveLength(1);
    const linea = avisos[0] ?? '';
    expect(linea).toContain('callable rechazado');
    const datos = JSON.parse(linea.slice(linea.indexOf('{'))) as Record<string, unknown>;
    expect(datos).toMatchObject({ ...marca });
    expect(typeof datos['codigo']).toBe('string');
    const campos = datos['campos'] as { path: string; code: string }[];
    expect(campos.map((c) => Object.keys(c).sort())).toEqual(campos.map(() => ['code', 'path']));
    expect(campos.map((c) => c.path)).toEqual(expect.arrayContaining(['tipo', 'n']));
    expect(linea).not.toContain('SECRETO-123');
  });

  it('otro HttpsError: registra su código sin el mensaje', () => {
    let error: unknown;
    try {
      actorPos({ rol: undefined } as Contexto);
    } catch (e) {
      error = e;
    }
    comoHttpsError(error, marca);
    const linea = avisos[0] ?? '';
    const datos = JSON.parse(linea.slice(linea.indexOf('{'))) as Record<string, unknown>;
    expect(datos).toMatchObject({ ...marca });
    expect(typeof datos['codigo']).toBe('string');
    expect(linea).not.toContain('No tiene permiso');
  });
});
