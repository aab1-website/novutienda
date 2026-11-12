import { describe, expect, it, vi } from 'vitest';
import { CODIGOS_CONOCIDOS, ErrorApi, MENSAJE_DATOS_NO_RECONOCIDOS, MENSAJE_GENERICO, mensajeDeError } from './errores.js';

describe('mensajes de error', () => {
  it('traduce los códigos de los módulos', () => {
    expect(mensajeDeError(new ErrorApi('failed-precondition', 'x', { codigo: 'sin-turno' }))).toContain('Abra el turno');
    expect(mensajeDeError(new ErrorApi('failed-precondition', 'x', { codigo: 'correo-no-verificado' }))).toBe('Verifica tu correo para continuar.');
  });
  it('para entrada-invalida, estado, estado-invalido y no-encontrado muestra el mensaje preciso del servidor si existe', () => {
    expect(mensajeDeError(new ErrorApi('invalid-argument', 'El motivo es obligatorio', { codigo: 'entrada-invalida' }))).toBe('El motivo es obligatorio');
    expect(mensajeDeError(new ErrorApi('failed-precondition', 'El conteo c1 no está abierto', { codigo: 'estado-invalido' }))).toBe('El conteo c1 no está abierto');
    expect(mensajeDeError(new ErrorApi('failed-precondition', 'La sección ya está publicada', { codigo: 'estado' }))).toBe('La sección ya está publicada');
    expect(mensajeDeError(new ErrorApi('not-found', 'La ubicación x no existe', { codigo: 'no-encontrado' }))).toBe('La ubicación x no existe');
    // Sin mensaje (o con un código HTTPS cuyo texto no controla el servidor) se usa el texto fijo del panel.
    expect(mensajeDeError(new ErrorApi('invalid-argument', ' ', { codigo: 'entrada-invalida' }))).toBe('Hay datos que no son válidos. Revise el formulario.');
    expect(mensajeDeError(new ErrorApi('internal', 'fallo interno 10.0.0.1', { codigo: 'estado' }))).toBe('La acción no se puede hacer en el estado actual.');
  });
  it('egreso-excede-efectivo distingue el reembolso de la anulación del egreso de caja', () => {
    const egreso = mensajeDeError(new ErrorApi('failed-precondition', 'El egreso supera el efectivo disponible en BOB', { codigo: 'egreso-excede-efectivo' }));
    const reembolso = mensajeDeError(new ErrorApi('failed-precondition', 'El reembolso en efectivo supera el efectivo de esa moneda en la caja', { codigo: 'egreso-excede-efectivo' }));
    expect(egreso).toContain('egreso');
    expect(reembolso).toContain('reembolso');
    expect(reembolso).not.toContain('egreso');
  });
  it('autoaprobacion distingue la anulación de una venta del descuento', () => {
    const anulacion = new ErrorApi('permission-denied', 'Nadie puede aprobar la anulación de una venta que vendió o que solicitó anular', { codigo: 'autoaprobacion' });
    expect(mensajeDeError(anulacion)).toBe('No puedes aprobar la anulación de una venta que vendiste o pediste anular');
    const descuento = new ErrorApi('permission-denied', 'Nadie puede resolver su propia solicitud', { codigo: 'autoaprobacion' });
    expect(mensajeDeError(descuento)).toBe('Nadie puede aprobar su propia solicitud.');
    expect(mensajeDeError(new ErrorApi('permission-denied', 'x', { codigo: 'autoaprobacion' }))).toBe('Nadie puede aprobar su propia solicitud.');
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
    expect(mensajeDeError(f)).toContain('tv en tienda: pidió 3, hay 1'); // sin nombre, el código legible
    const n = new ErrorApi('failed-precondition', 'x', { codigo: 'stock-insuficiente', faltantes: [{ productoId: 'tv-55', almacenId: 'deposito-1', pedido: 2, disponible: 0, productoNombre: 'Televisor', almacenNombre: 'Depósito' }] });
    expect(mensajeDeError(n)).toContain('Televisor en Depósito: pidió 2, hay 0');
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

describe('módulo apagado (L2-6)', () => {
  it('el código modulo-apagado tiene un mensaje claro aunque el servidor traiga otro texto', () => {
    expect(mensajeDeError(new ErrorApi('permission-denied', 'Módulo apagado: pos', { codigo: 'modulo-apagado' }))).toBe('Este módulo no está habilitado para su negocio.');
  });
});

describe('mensajes sin datos técnicos (G-07, G-08)', () => {
  const prohibido = (m: string): void => {
    expect(m).not.toContain('[400]');
    expect(m).not.toMatch(/campo desconocido/i);
    expect(m).not.toMatch(/productoId|version|subidaId|deposito-1|tv-55/);
  };
  it('el 400 con campos desconocidos da un texto simple y deja el detalle en el registro', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const e = new ErrorApi('invalid-argument', 'Hay datos inválidos [400]', {
      codigo: 'entrada-invalida',
      campos: ['ficha'],
      detalles: ['ficha: campo desconocido «productoId»', 'ficha: campo desconocido «version»'],
    });
    const m = mensajeDeError(e);
    expect(m).toBe(MENSAJE_DATOS_NO_RECONOCIDOS);
    prohibido(m);
    expect(espia).toHaveBeenCalledOnce();
    espia.mockRestore();
  });
  it('un mensaje técnico del servidor no se muestra', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const m = mensajeDeError(new ErrorApi('invalid-argument', 'subidaId inválido', { codigo: 'entrada-invalida' }));
    expect(m).toBe('Hay datos que no son válidos. Revise el formulario.');
    prohibido(m);
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });
  it('el motivo del servidor con dos puntos en medio de la frase se conserva (importación fallida)', () => {
    const motivo = 'El CSV no toca el stock: las columnas de stock solo se admiten en la carga inicial';
    expect(mensajeDeError(new ErrorApi('invalid-argument', motivo, { codigo: 'entrada-invalida' }))).toBe(motivo);
  });
  it('un mensaje que empieza con una ruta de campo («ficha.titulo: …») sigue sin mostrarse', () => {
    expect(mensajeDeError(new ErrorApi('invalid-argument', 'ficha.titulo: Required', { codigo: 'entrada-invalida' }))).toBe('Hay datos que no son válidos. Revise el formulario.');
  });
  it('los detalles técnicos por fila se omiten y los legibles se conservan', () => {
    const m = mensajeDeError(new ErrorApi('failed-precondition', 'x', { codigo: 'conflicto', detalles: ['Línea 2: el precio es obligatorio'] }));
    expect(m).toContain('Línea 2: el precio es obligatorio');
  });
  it.each([
    ['limite', 'resource-exhausted', 'El video supera 200 MB'],
    ['limite', 'resource-exhausted', 'Este producto ya tiene 5 fotos'],
    ['cuota-excedida', 'resource-exhausted', 'Se alcanzó la cuota de 10 GB de originales'],
    ['procesamiento', 'failed-precondition', 'La imagen conserva metadatos y se rechazó'],
    ['tipo-no-permitido', 'invalid-argument', 'El contenido del archivo no corresponde a un tipo permitido'],
    ['no-disponible', 'failed-precondition', 'La lectura de Excel no está disponible; use CSV'],
  ])('%s prefiere el motivo del servidor (%s)', (codigo, https, motivo) => {
    expect(mensajeDeError(new ErrorApi(https, motivo, { codigo }))).toBe(motivo);
  });
  it('sin motivo legible cada código usa su texto fijo con qué hacer', () => {
    for (const c of ['limite', 'cuota-excedida', 'procesamiento', 'tipo-no-permitido', 'no-disponible']) {
      const m = mensajeDeError(new ErrorApi('internal', 'fallo interno', { codigo: c }));
      prohibido(m);
      expect(m.length).toBeGreaterThan(20);
    }
  });
  it('ningún código conocido produce texto técnico', () => {
    for (const c of CODIGOS_CONOCIDOS) prohibido(mensajeDeError(new ErrorApi('internal', 'x', { codigo: c })));
  });
});
