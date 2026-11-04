import { describe, expect, it } from 'vitest';
import { CODIGOS_CONOCIDOS, ErrorApi, MENSAJE_GENERICO, mensajeDeError } from './errores.js';

describe('mensajes de error', () => {
  it('traduce los códigos de los módulos', () => {
    expect(mensajeDeError(new ErrorApi('failed-precondition', 'x', { codigo: 'sin-turno' }))).toContain('Abra el turno');
    expect(mensajeDeError(new ErrorApi('failed-precondition', 'x', { codigo: 'correo-no-verificado' }))).toBe('Verifica tu correo para continuar.');
  });
  it('cae en el código HTTPS y luego en el genérico, sin mostrar el texto técnico', () => {
    const e = new ErrorApi('unavailable', 'ECONNRESET 10.0.0.1');
    expect(mensajeDeError(e)).toContain('conexión');
    expect(mensajeDeError(e)).not.toContain('ECONNRESET');
    expect(mensajeDeError(new ErrorApi('rara', 'x'))).toBe(MENSAJE_GENERICO);
    expect(mensajeDeError(new Error('boom'))).toBe(MENSAJE_GENERICO);
    expect(mensajeDeError('texto')).toBe(MENSAJE_GENERICO);
  });
  it('agrega los faltantes de stock y los detalles por fila', () => {
    const f = new ErrorApi('failed-precondition', 'x', { codigo: 'stock-insuficiente', faltantes: [{ productoId: 'tv', almacenId: 'tienda', pedido: 3, disponible: 1 }] });
    expect(mensajeDeError(f)).toContain('tv en tienda: pidió 3, hay 1');
    const d = new ErrorApi('invalid-argument', 'x', { codigo: 'entrada-invalida', detalles: ['línea 2: id inválido'] });
    expect(mensajeDeError(d)).toContain('línea 2: id inválido');
  });
  it('todos los códigos de ErrorPos, ErrorConsola e identidad tienen mensaje', () => {
    const pos = ['entrada-invalida', 'no-autorizado', 'dato-corrupto', 'sin-turno', 'turno-ajeno', 'turno-no-abierto', 'turno-ya-abierto', 'request-en-uso', 'precio-alterado', 'producto-inexistente', 'producto-inactivo', 'sin-precio', 'series-invalidas', 'descuento-sin-aprobacion', 'aprobacion-inexistente', 'aprobacion-no-aprobada', 'aprobacion-usada', 'aprobacion-vencida', 'aprobacion-no-coincide', 'autoaprobacion', 'pagos-invalidos', 'medio-no-habilitado', 'conteo-faltante', 'egreso-excede-efectivo', 'venta-inexistente', 'venta-ya-anulada', 'anulacion-sin-solicitud', 'credito-inexistente', 'credito-saldo-insuficiente'];
    const consola = ['no-autorizado', 'entrada-invalida', 'no-encontrado', 'conflicto', 'limite', 'cuota-excedida', 'tipo-no-permitido', 'estado', 'contador-corrupto', 'procesamiento', 'no-disponible'];
    const identidad = ['no-autorizado', 'anonimo', 'entrada-invalida', 'proveedor', 'claim', 'correo-no-verificado', 'jerarquia', 'ultimo-adm', 'no-miembro', 'estado', 'concurrencia'];
    const inventarios = ['stock-insuficiente', 'serie-no-disponible', 'operacion-conflicto', 'sin-permiso', 'estado-invalido', 'recibo-no-encontrado', 'plantilla-invalida', 'accion-no-permitida'];
    for (const c of [...pos, ...consola, ...identidad, ...inventarios]) expect(CODIGOS_CONOCIDOS, c).toContain(c);
  });
});
