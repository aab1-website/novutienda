// Gestión de los tokens de la API de NovuChat. En la plataforma solo vive el SHA-256 del token (nunca el token):
// `novuchatTokens/{sha256}` → { tenantId, hash, activo }. Rotación: se registra el nuevo, NovuChat cambia, y luego
// se desactiva el viejo (hasta dos activos por tenant a la vez).
//
//   printf '%s' "$TOKEN" | node plataforma/funciones/scripts/token-novuchat.mjs registrar --tenant casa-bermejo
//   node plataforma/funciones/scripts/token-novuchat.mjs desactivar --hash <sha256>
//   node plataforma/funciones/scripts/token-novuchat.mjs listar --tenant casa-bermejo
//
// El proyecto sale de GOOGLE_CLOUD_PROJECT (o --proyecto); con FIRESTORE_EMULATOR_HOST escribe en el emulador.
// El token se lee de la entrada estándar y NO se imprime nunca.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const [, , comando, ...resto] = process.argv;
const arg = (n) => {
  const i = resto.indexOf(`--${n}`);
  return i > -1 ? resto[i + 1] : undefined;
};
const TENANT = /^[a-z0-9][a-z0-9-]{0,62}$/;

function falla(mensaje) {
  console.error(`token-novuchat: ${mensaje}`);
  process.exit(1);
}

const proyecto = arg('proyecto') ?? process.env.GOOGLE_CLOUD_PROJECT;
if (!proyecto) falla('indique el proyecto con GOOGLE_CLOUD_PROJECT o --proyecto');
if (getApps().length === 0) initializeApp({ projectId: proyecto });
const col = getFirestore().collection('novuchatTokens');

if (comando === 'registrar') {
  const tenant = arg('tenant');
  if (!tenant || !TENANT.test(tenant)) falla('falta --tenant válido');
  const token = readFileSync(0, 'utf8').trim();
  if (token.length < 32 || /\s/.test(token)) falla('el token (entrada estándar) debe tener al menos 32 caracteres y no llevar espacios');
  const hash = createHash('sha256').update(token).digest('hex');
  const activos = (await col.where('tenantId', '==', tenant).where('activo', '==', true).get()).docs.filter((d) => d.id !== hash);
  if (activos.length >= 2) falla('el tenant ya tiene dos tokens activos; desactive el anterior antes de registrar uno nuevo');
  await col.doc(hash).set({ tenantId: tenant, hash, activo: true, creadoEn: new Date().toISOString() });
  console.log(`registrado: ${hash}`);
} else if (comando === 'desactivar') {
  const hash = arg('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) falla('falta --hash (SHA-256 en hexadecimal)');
  const ref = col.doc(hash);
  if (!(await ref.get()).exists) falla('no existe ese hash');
  await ref.update({ activo: false, desactivadoEn: new Date().toISOString() });
  console.log(`desactivado: ${hash}`);
} else if (comando === 'listar') {
  const tenant = arg('tenant');
  if (!tenant || !TENANT.test(tenant)) falla('falta --tenant válido');
  for (const d of (await col.where('tenantId', '==', tenant).get()).docs) console.log(`${d.id} activo=${String(d.data().activo)}`);
} else {
  falla('uso: registrar --tenant T (token por entrada estándar) | desactivar --hash H | listar --tenant T');
}
