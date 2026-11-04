// `AuthMin` del núcleo sobre Firebase Auth (Admin SDK). Solo traduce la forma del usuario.
import type { Auth } from 'firebase-admin/auth';
import type { AuthMin } from '@plataforma/nucleo';

export function crearAuthMin(auth: Auth): AuthMin {
  return {
    async getUser(uid) {
      const u = await auth.getUser(uid);
      return {
        customClaims: u.customClaims,
        providerData: u.providerData.map((p) => ({ providerId: p.providerId })),
        emailVerified: u.emailVerified,
      };
    },
    async setCustomUserClaims(uid, claims) {
      await auth.setCustomUserClaims(uid, { ...claims });
    },
    async revokeRefreshTokens(uid) {
      await auth.revokeRefreshTokens(uid);
    },
  };
}
