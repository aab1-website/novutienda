import { crearValidador, texto, uno, type Fixtures } from './esquema.js';

/** CONTRATO CONGELADO desde su creación: un cambio incompatible exige un contrato v2. */
export const TIPO_PRODUCTO_CAMBIADO_V1 = 'producto.cambiado';

export const CAMBIOS_PRODUCTO_CAMBIADO_V1 = ['creado', 'editado', 'precio'] as const;
export type CambioProductoCambiado = (typeof CAMBIOS_PRODUCTO_CAMBIADO_V1)[number];

/** Aviso de que el catálogo cambió; sin precios ni datos personales (quien lo necesita lee el producto). */
export interface DatosProductoCambiadoV1 {
  readonly productoId: string;
  readonly cambio: CambioProductoCambiado;
}

export const validarProductoCambiadoV1 = crearValidador<DatosProductoCambiadoV1>({
  productoId: texto,
  cambio: uno(CAMBIOS_PRODUCTO_CAMBIADO_V1),
});

const valido: DatosProductoCambiadoV1 = { productoId: 'p1', cambio: 'creado' };

export const fixturesProductoCambiadoV1: Fixtures<DatosProductoCambiadoV1> = {
  validos: [valido, { ...valido, cambio: 'editado' }, { ...valido, cambio: 'precio' }],
  invalidos: [
    { nombre: 'sin producto', datos: { ...valido, productoId: undefined } },
    { nombre: 'producto vacío', datos: { ...valido, productoId: '' } },
    { nombre: 'sin cambio', datos: { ...valido, cambio: undefined } },
    { nombre: 'cambio desconocido', datos: { ...valido, cambio: 'borrado' } },
  ],
};
