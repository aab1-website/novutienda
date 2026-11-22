// El registro de un callable rechazado lleva el código del módulo y un motivo corto y limpio, nunca el valor enviado.
// Sin emulador: se espía el logger.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SaltoSinConfirmar } from '@novutienda/nucleo';
import { ErrorRecibo } from '@novutienda/recibos';
import { accion, actorPos, comoHttpsError, motivoLimpio, type Contexto } from '../../plataforma/funciones/servidor/llamadas/marco.js';

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

describe('registro de «callable rechazado»', () => {
  it('agrega codigoModulo y motivo, limpia símbolos y recorta', () => {
    const secreto = 'Juan-Perez-NIT-1234567<script>';
    comoHttpsError(new ErrorRecibo(`Campo desconocido: ${secreto}`), { modulo: 'recibos', accion: 'guardarDatos' });
    const linea = avisos.find((l) => l.includes('callable rechazado'));
    expect(linea).toBeDefined();
    const datos = JSON.parse(linea as string) as Record<string, unknown>;
    expect(datos['codigoModulo']).toBe('recibo-invalido');
    expect(String(datos['motivo'])).toMatch(/^Campo desconocido/);
    expect(linea).not.toContain('<script>');
    expect(linea).not.toContain('>');
  });

  it('SaltoSinConfirmar: registra solo el código, nunca el mensaje con valores', () => {
    comoHttpsError(new SaltoSinConfirmar(100, 777, 0.05), { modulo: 'consola', accion: 'fijarTipoCambio' });
    const linea = avisos.find((l) => l.includes('callable rechazado')) as string;
    const datos = JSON.parse(linea) as Record<string, unknown>;
    expect(datos['motivo']).toBe('salto-sin-confirmar');
    expect(linea).not.toContain('777');
  });

  it('recorta a 120 caracteres y limpia los símbolos', () => {
    expect(motivoLimpio('a'.repeat(300))).toHaveLength(120);
    expect(motivoLimpio('Campo: <b>{"x":1}</b>')).toBe('Campo: bx:1b');
  });
});

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

  it('permission-denied (esperado): no sube a aviso, y el error sale con su código', () => {
    let error: unknown;
    try {
      actorPos({ rol: undefined } as Contexto);
    } catch (e) {
      error = e;
    }
    const h = comoHttpsError(error, marca);
    expect(h.code).toBe('permission-denied');
    expect(avisos).toHaveLength(0);
  });

  it('la ruta de un campo se recorta a 100 caracteres', () => {
    const largo = {
      safeParse: () => ({ success: false, error: { issues: [{ path: ['x'.repeat(500)], code: 'invalid_type', message: 'm' }] } }),
    } as unknown as Parameters<typeof accion>[0]['esquema'];
    let error: unknown;
    try {
      void accion({ esquema: largo, ejecutar: async () => 1 }).ejecutar({} as Contexto, {});
    } catch (e) {
      error = e;
    }
    comoHttpsError(error, marca);
    const linea = avisos[0] ?? '';
    const datos = JSON.parse(linea.slice(linea.indexOf('{'))) as { campos: { path: string }[] };
    expect(datos.campos[0]?.path).toHaveLength(100);
  });
});
