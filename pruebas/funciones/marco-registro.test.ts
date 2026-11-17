// El registro de un callable rechazado lleva el código del módulo y un motivo corto y limpio, nunca el valor enviado.
// Sin emulador: se espía el logger.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorRecibo } from '@novutienda/recibos';
import { comoHttpsError, motivoLimpio } from '../../plataforma/funciones/servidor/llamadas/marco.js';

// El logger de `firebase-functions` toma `console.warn` al cargarse: se intercepta antes de los imports (hoisted).
const avisos = vi.hoisted(() => {
  const lista: string[] = [];
  console.warn = (...a: unknown[]): void => { lista.push(a.map(String).join(' ')); };
  return lista;
});

beforeEach(() => { avisos.length = 0; });

describe('registro de «callable rechazado»', () => {
  it('agrega codigoModulo y motivo, y no incluye el valor enviado', () => {
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

  it('recorta a 120 caracteres y limpia los símbolos', () => {
    expect(motivoLimpio('a'.repeat(300))).toHaveLength(120);
    expect(motivoLimpio('Campo: <b>{"x":1}</b>')).toBe('Campo: bx:1b');
  });
});
