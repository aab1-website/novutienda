// Conversión de unidades entre Inventarios y el resto de la plataforma. La lectura del documento de producto
// la ofrece Inventarios (`leerProducto`, `leerDocumentoProducto`, tipo `ProductoLeido`); los adaptadores no
// conocen rutas ni campos.
import { aCentavos } from '@plataforma/nucleo';

/**
 * Unidad de los precios. Inventarios guarda `precioUSD` en CENTAVOS enteros de USD; la consola y el POS
 * trabajan con USD decimales (`precioFinal` multiplica USD por la cotización). La conversión vive SOLO aquí:
 * ni Inventarios ni los puertos de la consola o del POS convierten.
 */
export const centavosADolares = (centavos: number): number => centavos / 100;
export const dolaresACentavos = (dolares: number): number => aCentavos(dolares);
