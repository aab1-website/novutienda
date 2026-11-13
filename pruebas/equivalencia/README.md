# Batería de equivalencia del tenant de referencia

Fija, con «fotos» versionadas en `referencias/`, lo que hoy produce el sistema para el tenant de referencia (tres monedas BOB/USD/ARS,
mercados Bolivia y Argentina, precios base en USD, cotizaciones, redondeo). Todo PR posterior debe dejarlas idénticas:
la comparación es byte a byte y, al fallar, muestra las líneas que difieren. Datos ficticios; reloj e ids inyectados;
sin red ni emulador; corre con `pnpm test`.

| Salida | Archivo de prueba |
|---|---|
| (a) contrato NovuChat: catálogo BO y AR, inventario, pedido firmado | `novuchat.test.ts` |
| (b) `/api/cotizacion` y `/api/disponibilidad` | `sitio-api.test.ts` |
| (c) `precioFinal`, redondeo, `preciosDelDia`, precio del panel y del sitio | `precios.test.ts` |
| (d) ventas en BOB/USD/ARS, pagos mixtos, vuelto, arqueo y cierre, CSV de caja | `caja.test.ts` |
| (e) CSV exportado de productos y simulación de importación (`precioBO`/`precioAR`) | `inventarios-csv.test.ts` |
| (f) recibo: documento y HTML por moneda | `recibos.test.ts` |
| (g) contenido del sitio desde lo publicado, SEO con moneda, selector y convertidor | `contenido-sitio.test.ts` |
| (h) reglas generadas | `pnpm reglas:verificar` (no se duplica aquí) |
| configuración del tenant | `tenant.test.ts` |

No cubierto: el HTML compilado por Astro (selector de país renderizado) y `ReciboVista` del panel, porque no son
importables desde `pruebas/` sin una exportación pública nueva (zona Central); lo que pasa por emulador queda en `pnpm test:funciones`.

## Regenerar

`pnpm equivalencia:actualizar` (nunca en CI): reescribe `referencias/`, actualiza `referencias/SELLO` y agrega a `CAMBIOS.md`
una entrada «PENDIENTE». `candado.test.ts` falla hasta que esa entrada explique por qué cambió el comportamiento.
