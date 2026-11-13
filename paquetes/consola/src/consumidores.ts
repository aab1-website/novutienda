import {
  consumir,
  type BaseDatosIdentidad,
  type EjecutorTransacciones,
  type SobreEvento,
  type TransaccionBandeja,
  type TransaccionIdentidad,
} from '@novutienda/nucleo';
import { anotarCambio, leerEstadoSitio } from './cambios.js';
import { PLANTILLAS } from './plantillas.js';
import { decidirReconstruccion, motivoNoPublicable, type MedioPublico } from './publicar.js';
import type { CatalogoPuerto, DisparadorSitio, Reloj } from './puertos.js';
import { rutaPublicado } from './rutas.js';
import { esObjeto } from './validar.js';

/** Nombre con el que la consola queda registrada como consumidora en la bandeja de procesados. */
export const CONSUMIDOR_CONSOLA = 'consola';

/** Transacción con lo que necesitan a la vez el estado del sitio y la bandeja de eventos. */
export type TransaccionConsola = TransaccionIdentidad & TransaccionBandeja;

/** Adapta una base de datos de identidad al ejecutor que pide `consumir` (la bandeja del núcleo). */
export function ejecutorConsola(db: BaseDatosIdentidad): EjecutorTransacciones<TransaccionConsola> {
  return {
    transaccion: (fn) =>
      db.runTransaction((tx) =>
        fn({
          get: (r) => tx.get(r),
          set: (r, d) => {
            tx.set(r, d);
          },
          delete: (r) => {
            tx.delete(r);
          },
          create: (r, d) => {
            tx.create(r, d);
          },
          nuevoId: (c) => tx.nuevoId(c),
          marcaTiempoServidor: () => tx.marcaTiempoServidor(),
          existe: async (r) => (await tx.get(r)).existe,
        }),
      ),
  };
}

/** Lo que el consumidor necesita además del ejecutor: el catálogo (relectura en la transacción), el reloj y el disparador. */
export interface DepsConsumidorProducto {
  readonly catalogo: CatalogoPuerto;
  readonly reloj: Reloj;
  readonly disparador: DisparadorSitio;
}

const mismoPrecio = (a: { readonly bo: number; readonly ar: number }, b: { readonly bo: number; readonly ar: number }): boolean =>
  a.bo === b.bo && a.ar === b.ar;

/**
 * Consume `producto.cambiado` (v1). Una sola vez por evento (por id y por clave de idempotencia, en la misma transacción que
 * el resto). `consumir` valida el evento con el contrato del núcleo y lanza `ErrorEvento` si es inválido. Devuelve `false` si
 * era duplicado o estaba descartado.
 *
 * Precio vivo (DS-2/DS-4). NO se fía de los datos del evento: dentro de la transacción compara el producto vivo (relectura con
 * `leerProductoEnTransaccion`) contra su copia `publicado/producto__<id>`, de modo que un evento repetido o viejo no cambia nada.
 *  - Sin copia publicada: anota un cambio sin publicar, igual que antes (respeta `corteCatalogoEn`).
 *  - Producto inexistente o inactivo: retira la copia y el id de `estado.productos`.
 *  - `precioUSD` distinto: actualiza SOLO el precio de la copia.
 *  En ambos casos sube `version` de `publicado/estado` y de `publicado/sitio` en +1 (siguen iguales entre sí), guarda `precioVivoEn`
 *  (`publicadoEn` no cambia) y agenda la reconstrucción con la ventana de 10 minutos (`decidirReconstruccion`, como una
 *  publicación). `disparador.programar` se llama tras el commit, solo si esta transacción fue la primera del grupo.
 *  - Si nombre, marca o categoría vivos difieren de la copia, esperan «Publicar» y SÍ cuentan como cambio sin publicar. Un cambio
 *    solo de precio ya aplicado no cuenta; si nada difiere, el evento no hace nada.
 *
 * Todas las lecturas van antes de las escrituras. Una subida concurrente de `publicarSitio` toca `publicado/estado`, que se lee
 * aquí: el control optimista reintenta y no se pierde ninguna subida de versión.
 *
 * Única vía de conteo de los cambios de producto: los callables de consola llaman a la biblioteca de Inventarios por el puerto,
 * que publica el evento en la misma transacción; consola ya no anota esos cambios.
 */
export async function consumirProductoCambiado(
  ejecutor: EjecutorTransacciones<TransaccionConsola>,
  evento: SobreEvento,
  deps: DepsConsumidorProducto,
): Promise<boolean> {
  // Contenedor (y no una variable suelta) para que TypeScript no estreche el tipo dentro del cierre del manejador.
  const pendiente: { valor: { tenantId: string; para: number } | null } = { valor: null };
  const consumido = await consumir(ejecutor, {
    consumidor: CONSUMIDOR_CONSOLA,
    evento,
    manejador: async (tx, ev) => {
      pendiente.valor = null; // el cuerpo se reintenta: cada intento decide de nuevo
      const t = ev.tenantId;
      const productoId = esObjeto(ev.datos) && typeof ev.datos['productoId'] === 'string' ? ev.datos['productoId'] : '';
      const estado = await leerEstadoSitio(tx, t);
      const rutaEstadoPub = rutaPublicado(t, 'estado');
      const dEstadoPub = (await tx.get(rutaEstadoPub)).data();
      const idsPublicados = Array.isArray(dEstadoPub?.['productos'])
        ? dEstadoPub['productos'].filter((v): v is string => typeof v === 'string') : [];
      const contarComoAntes = (): void => {
        // Un cambio anterior o igual al corte de la última publicación ya salió publicado: se consume sin contar.
        if (estado.corteCatalogoEn !== '' && Date.parse(ev.ocurridoEn) <= Date.parse(estado.corteCatalogoEn)) return;
        anotarCambio(tx, t, estado, ev.ocurridoEn);
      };
      if (productoId === '' || dEstadoPub === undefined || !idsPublicados.includes(productoId)) return contarComoAntes();

      const rutaCopia = rutaPublicado(t, `producto__${productoId}`);
      const copia = (await tx.get(rutaCopia)).data();
      const vivo = await deps.catalogo.leerProductoEnTransaccion(tx, t, productoId);
      const retirar = vivo === undefined || !vivo.activo;
      const precio = copia?.['precioUSD'];
      const precioCopia = esObjeto(precio) && typeof precio['bo'] === 'number' && typeof precio['ar'] === 'number'
        ? { bo: precio['bo'], ar: precio['ar'] } : undefined;
      const precioCambia = !retirar && copia !== undefined && (precioCopia === undefined || !mismoPrecio(vivo.precioUSD, precioCopia));
      const textoCambia = !retirar && copia !== undefined &&
        (vivo.nombre !== copia['nombre'] || vivo.categoria !== copia['categoria'] || (vivo.marca ?? '') !== (copia['marca'] ?? ''));
      // Copia ausente con el producto activo (dato inconsistente): no hay qué actualizar; se comporta como antes.
      if (!retirar && copia === undefined) return contarComoAntes();
      if (!retirar && !precioCambia) { if (textoCambia) contarComoAntes(); return; }

      const dSitio = (await tx.get(rutaPublicado(t, 'sitio'))).data();
      // Retiro: ¿qué conjunto QUEDA publicado? Solo entonces se leen las copias restantes (se corta en la primera con foto utilizable)
      // y, si ninguna la tiene, los carruseles propios. Todo antes de las escrituras.
      const restantes = idsPublicados.filter((id) => id !== productoId);
      let motivoAviso: 'sin_productos' | 'sin_fotos' | null = null;
      if (retirar) {
        const productosQuedan: { medios: readonly MedioPublico[] }[] = [];
        for (const id of restantes) {
          const c = (await tx.get(rutaPublicado(t, `producto__${id}`))).data();
          const medios = (Array.isArray(c?.['medios']) ? c['medios'] : []) as readonly MedioPublico[];
          productosQuedan.push({ medios });
          if (motivoNoPublicable({ productos: productosQuedan, carruseles: [] }) === null) break; // basta una foto: es publicable
        }
        // Con `restantes` vacío la lista queda vacía y el motivo es `sin_productos`; con alguna foto ya salió `null` arriba.
        let carruseles: { plantilla: string; items: readonly MedioPublico[] }[] = [];
        if (restantes.length > 0 && motivoNoPublicable({ productos: productosQuedan, carruseles }) !== null) {
          for (const pl of PLANTILLAS) {
            const c = (await tx.get(rutaPublicado(t, `carrusel__${pl}`))).data();
            if (c !== undefined) carruseles = [...carruseles, { plantilla: pl, items: (Array.isArray(c['items']) ? c['items'] : []) as readonly MedioPublico[] }];
          }
        }
        motivoAviso = motivoNoPublicable({ productos: restantes.length === 0 ? [] : productosQuedan, carruseles });
      }
      const ahora = deps.reloj.ahora();
      const reconstruccion = esObjeto(dEstadoPub['reconstruccion']) ? dEstadoPub['reconstruccion'] : {};
      const previaPara = typeof reconstruccion['programadaPara'] === 'number' ? reconstruccion['programadaPara'] : null;
      // Con una hora ya vencida la decisión es «esperar»: quien pasa a reconstruir es siempre el temporizador.
      const decision = decidirReconstruccion({ hayPublicacion: true, programadaPara: previaPara }, ahora, 'publicacion');
      const programadaPara = decision.accion === 'programar' || decision.accion === 'esperar' ? decision.para : previaPara;
      const version = (typeof dEstadoPub['version'] === 'number' ? dEstadoPub['version'] : 0) + 1;

      // Escrituras (después de todas las lecturas).
      if (retirar) tx.delete(rutaCopia);
      else tx.set(rutaCopia, { ...copia, precioUSD: { bo: vivo.precioUSD.bo, ar: vivo.precioUSD.ar } });
      if (dSitio !== undefined) tx.set(rutaPublicado(t, 'sitio'), { ...dSitio, version });
      // Si tras retirar no queda ningún producto o ninguna foto, el retiro se hace igual y la reconstrucción SÍ procede: el sitio
      // admite quedar sin catálogo o sin fotos. Para que el comerciante lo sepa se guarda `avisoSitio` en `sitio/estado` y se cuenta
      // un cambio sin publicar; una publicación correcta lo limpia (`publicarSitio` reescribe `sitio/estado`).
      // Reactivar en Inventario un producto ya retirado NO lo devuelve al sitio: ya no está en `estado.productos`, así que el evento
      // cae en `contarComoAntes` (cuenta como cambio sin publicar) hasta que alguien publique.
      tx.set(rutaEstadoPub, {
        ...dEstadoPub, version, precioVivoEn: new Date(ahora).toISOString(),
        productos: retirar ? idsPublicados.filter((id) => id !== productoId) : idsPublicados,
        reconstruccion: { ...reconstruccion, programadaPara },
      });
      if (textoCambia) contarComoAntes();
      if (motivoAviso !== null) anotarCambio(tx, t, estado, ev.ocurridoEn, { motivo: motivoAviso, en: new Date(ahora).toISOString() });
      if (decision.accion === 'programar') pendiente.valor = { tenantId: t, para: decision.para };
    },
  });
  if (consumido && pendiente.valor !== null) await deps.disparador.programar(pendiente.valor.tenantId, pendiente.valor.para);
  return consumido;
}
