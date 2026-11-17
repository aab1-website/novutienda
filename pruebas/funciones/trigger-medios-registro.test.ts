// El registro de una subida rechazada lleva la causa técnica del `ErrorConsola` (sin rutas), para diagnosticar
// rechazos como el del logo (humo del 17/11/2026), y no la lleva para otros errores.
import { describe, expect, it } from 'vitest';
import { ErrorConsola } from '@novutienda/consola';
import { registroRechazo } from '../../plataforma/funciones/servidor/trigger-medios.js';

describe('registro de una subida rechazada', () => {
  it('incluye la causa de un ErrorConsola', () => {
    const r = registroRechazo('t-demo', 'subida-0001', new ErrorConsola('procesamiento', 'No se pudo procesar el archivo', [], 'Error: formato [ruta]'));
    expect(r).toMatchObject({ tenantId: 't-demo', subidaId: 'subida-0001', error: 'ErrorConsola', causa: 'Error: formato [ruta]' });
  });

  it('sin ErrorConsola no hay causa', () => {
    expect(registroRechazo('t-demo', 'subida-0002', new Error('x'))['causa']).toBeUndefined();
    expect(registroRechazo('t-demo', 'subida-0003', 'texto')).toMatchObject({ error: 'desconocido', mensaje: '' });
  });
});
