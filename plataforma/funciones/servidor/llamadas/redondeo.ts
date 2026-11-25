// Redondeo de precios (Central, plano §5.2): lo que todo comercio ve igual tenga los módulos que tenga. Viaja dentro del
// callable `consola` (`index.ts` lo compone con `accionesConsola`); los roles y el permiso del propietario los declara el
// manifiesto del panel. El administrador del comercio solo VE la regla; solo el operador de NovuTienda (`propietario`:
// claim `p` y sesión con Google, verificado por el marco) la FIJA. La regla de fondo vive en `fijarRedondeoDe`.
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { accion, type TablaImplementaciones } from './marco.js';
import { VACIO, objeto } from './comunes.js';
import { redondeoPorMoneda } from '@novutienda/nucleo';
import { RedondeoInvalido, fijarRedondeoDe, interpretarRedondeoDe, rutaRedondeo, type TransaccionRedondeo } from '../redondeo.js';

/** Reglas por moneda de venta. Cada regla la valida `fijarRedondeoDe` con el esquema del núcleo; aquí solo se acota la forma. */
const POR_MONEDA = z.record(z.string().regex(/^[A-Z]{3,5}$/, 'moneda inválida'), z.unknown()).refine((r) => Object.keys(r).length <= 10, 'demasiadas monedas');

export const accionesRedondeo: TablaImplementaciones = {
  /**
   * Reglas vigentes por moneda de venta y si quien pregunta puede cambiarlas. Lee `config/redondeo` directamente (sin caché): lo que
   * devuelve es lo que el editor enviará como `esperadas`. Si el documento es inválido responde las reglas por defecto con `invalido`.
   */
  verRedondeo: accion({
    esquema: VACIO,
    ejecutar: async (c) => {
      const comercial = await c.e.comercialDelTenant(c.tenantId);
      const datos = await c.e.db.runTransaction(async (tx) => (await tx.get(rutaRedondeo(c.tenantId))).data());
      const monedas = [...new Set(comercial.mercados.map((m) => m.monedaVenta))];
      try {
        return { monedas, reglas: interpretarRedondeoDe(datos, comercial), puedeEditar: c.sesion.propietario };
      } catch (e) {
        if (!(e instanceof RedondeoInvalido)) throw e;
        // Documento inválido: se muestra la regla por defecto y se avisa, para que el operador pueda repararlo.
        return { monedas, reglas: redondeoPorMoneda(comercial), invalido: true, puedeEditar: c.sesion.propietario };
      }
    },
  }),
  /** Fija las reglas (solo el operador de NovuTienda). Cambia los precios de caja, web y WhatsApp; el sitio se reconstruye. */
  cambiarRedondeo: accion({
    esquema: objeto({ reglas: POR_MONEDA, esperadas: POR_MONEDA.nullable(), motivo: z.string().trim().min(1).max(200).optional() }),
    maxCaracteres: 8_000,
    ejecutar: async (c, d) => {
      // Defensa en profundidad: el manifiesto ya deja pasar solo al propietario.
      if (!c.sesion.propietario) throw new HttpsError('permission-denied', 'Solo el operador de NovuTienda puede cambiar el redondeo.');
      const comercial = await c.e.comercialDelTenant(c.tenantId);
      const r = await c.e.db.runTransaction((tx) => {
        const txr: TransaccionRedondeo = {
          get: (ruta) => tx.get(ruta),
          set: (ruta, datos) => tx.set(ruta, datos),
          create: (ruta, datos) => tx.create(ruta, datos),
          nuevoId: (coleccion) => tx.nuevoId(coleccion),
          marcaTiempoServidor: () => tx.marcaTiempoServidor(),
          existe: async (ruta) => (await tx.get(ruta)).existe,
        };
        return fijarRedondeoDe(txr, {
          tenantId: c.tenantId, comercial, reglas: d.reglas, esperadas: d.esperadas, uid: c.sesion.uid, ahora: c.e.ahora,
          ...(d.motivo === undefined ? {} : { motivo: d.motivo }),
        });
      });
      switch (r.tipo) {
        case 'conflicto':
          throw new HttpsError('failed-precondition', 'Otra persona cambió el redondeo mientras usted lo editaba. Revise las reglas actuales y vuelva a intentarlo.', { codigo: 'redondeo-conflicto' });
        case 'invalido':
          throw new HttpsError('invalid-argument', `${r.motivo}.`, { codigo: 'redondeo-regla-invalida' });
        case 'sin-cambios':
          return { estado: 'sin-cambios' as const };
        case 'fijado':
          c.e.redondeoDelTenant.invalidar(c.tenantId);
          return { estado: 'fijado' as const, cambiadas: r.cambiadas, reglas: r.reglas };
      }
    },
  }),
};
