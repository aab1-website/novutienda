// Acciones de usuarios del tenant (Central, plano §5.2): lo que todo comercio ve igual tenga los módulos que tenga.
// Viajan dentro del callable `consola` (`index.ts` las compone con `accionesConsola`) para no cambiar el contrato del
// panel; los roles y el permiso del propietario los declara el manifiesto del panel.
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { asignarRol, leerClaim, quitarRol, type Rol } from '@novutienda/nucleo';
import { accion, moduloApagado, type TablaImplementaciones } from './marco.js';
import { UID, VACIO, objeto } from './comunes.js';

const ruta = (t: string, col: string, id?: string): string => `tenants/${t}/${col}${id === undefined ? '' : `/${id}`}`;

const ROL = z.enum(['caj', 'sup', 'adm']);

export const accionesUsuarios: TablaImplementaciones = {
  // ---- Usuarios (3 como máximo) ---------------------------------------------------------------------------
  /** Miembros del tenant con su correo (`sup`/`adm`). */
  listarUsuarios: accion({
    esquema: VACIO,
    ejecutar: async (c) => {
      const miembros = (await c.e.firestore.collection(ruta(c.tenantId, 'miembros')).get()).docs;
      if (miembros.length === 0) return { usuarios: [] };
      const { users } = await c.e.auth.getUsers(miembros.slice(0, 100).map((m) => ({ uid: m.id })));
      const porUid = new Map(users.map((u) => [u.uid, u]));
      return {
        usuarios: miembros.map((m) => {
          const u = porUid.get(m.id);
          return { uid: m.id, rol: m.data()['rol'], correo: u?.email ?? null, correoVerificado: u?.emailVerified ?? false, deshabilitado: u?.disabled ?? false };
        }),
      };
    },
  }),
  /**
   * Busca un usuario existente por correo para poder asignarle rol (solo `adm`). La cuenta debe existir y estar verificada.
   * No revela cuentas de otros negocios (la plataforma es multi-tenant): solo responde si la cuenta ya es miembro de ESTE
   * negocio o si no pertenece a ningún negocio (claim sin tenants, cuenta libre para asignar). En cualquier otro caso
   * responde exactamente igual que si no existiera, para que no sirva de oráculo de qué correos usa otro negocio.
   */
  buscarUsuarioPorCorreo: accion({
    esquema: objeto({ correo: z.string().email().max(120) }),
    ejecutar: async (c, d) => {
      const noExiste = new HttpsError('not-found', 'No existe una cuenta con ese correo.');
      let u;
      try {
        u = await c.e.auth.getUserByEmail(d.correo);
      } catch (error) {
        if ((error as { code?: unknown }).code === 'auth/user-not-found') throw noExiste;
        throw error;
      }
      const claim = leerClaim(u.customClaims);
      const sinTenants = !claim.ok || Object.keys(claim.valor.pl.t).length === 0;
      const esMiembro = (await c.e.firestore.doc(ruta(c.tenantId, 'miembros', u.uid)).get()).exists || (claim.ok && Object.hasOwn(claim.valor.pl.t, c.tenantId));
      if (!sinTenants && !esMiembro) throw noExiste;
      return { uid: u.uid, correoVerificado: u.emailVerified, conContrasena: u.providerData.some((p) => p.providerId === 'password') };
    },
  }),
  asignarRol: accion({
    esquema: objeto({ uid: UID, rol: ROL }),
    ejecutar: async (c, d) => ({ claim: await asignarRol({ auth: c.e.authMin, db: c.e.db, ahora: c.e.ahora }, c.actor, c.tenantId, d.uid, d.rol as Rol) }),
  }),
  quitarRol: accion({
    esquema: objeto({ uid: UID }),
    ejecutar: async (c, d) => ({ claim: await quitarRol({ auth: c.e.authMin, db: c.e.db, ahora: c.e.ahora }, c.actor, c.tenantId, d.uid) }),
  }),
  /**
   * Ids de los módulos efectivos del tenant (L2-6, Central): el panel filtra su menú con ellos. No depende de ningún
   * módulo para poder ejecutarse con todo apagado. Falla cerrado: tenant sin documento o inválido se rechaza.
   */
  modulosActivos: accion({
    esquema: VACIO,
    ejecutar: async (c) => {
      const modulos = await c.e.modulosDelTenant(c.tenantId);
      if (modulos === undefined) throw moduloApagado('Este negocio no está habilitado.');
      return { modulos: [...modulos] };
    },
  }),
};
