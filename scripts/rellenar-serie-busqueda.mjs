// Rellena `serieBusqueda` (la serie sin distinguir mayúsculas) en las unidades de un tenant que aún no la tienen. Es un campo
// derivado: no se audita y el relleno es idempotente (solo escribe donde falta o difiere).
//
//   node scripts/rellenar-serie-busqueda.mjs <tenant> --proyecto <id>                        simulación: cuenta, no escribe
//   node scripts/rellenar-serie-busqueda.mjs <tenant> --proyecto <id> --escribir             escribe en lotes de 400
//   (producción: además NOVUTIENDA_AMBIENTE=produccion y --confirmar-produccion; solo con la autorización de una persona)
//
// Entorno (scripts/guardia-operador.mjs `validarEntornoAlta`). No imprime identificadores ni series: solo cifras.
// La normalización repite `normalizarSerieBusqueda` de `paquetes/inventarios/src/ids.ts` (plataforma no importa módulos);
// `pruebas/inventarios/serie-busqueda-relleno.test.ts` comprueba que coinciden.
import { pathToFileURL } from 'node:url';
import { validarEntornoAlta } from './guardia-operador.mjs';

export const TAMANO_LOTE = 400;
export const normalizarSerieBusqueda = (serie) => serie.toLowerCase();

/**
 * Recorre `tenants/{tenant}/unidades` en lotes y deja `serieBusqueda` al día. `firestore` es el de firebase-admin (o un doble
 * con `collection().orderBy().limit().startAfter().get()` y `batch()`). Devuelve las cifras; sin `escribir` no escribe nada.
 */
export async function rellenar({ firestore, tenant, escribir = false, tamanoLote = TAMANO_LOTE }) {
  const cifras = { revisadas: 0, aActualizar: 0, actualizadas: 0, sinSerie: 0 };
  const coleccion = firestore.collection(`tenants/${tenant}/unidades`);
  let ultimo;
  for (;;) {
    let q = coleccion.orderBy('__name__').limit(tamanoLote);
    if (ultimo !== undefined) q = q.startAfter(ultimo);
    const pagina = await q.get();
    if (pagina.empty || pagina.docs.length === 0) break;
    const lote = escribir ? firestore.batch() : undefined;
    let enLote = 0;
    for (const doc of pagina.docs) {
      cifras.revisadas += 1;
      const datos = doc.data();
      if (typeof datos.serie !== 'string' || datos.serie === '') {
        cifras.sinSerie += 1;
        continue;
      }
      const esperado = normalizarSerieBusqueda(datos.serie);
      if (datos.serieBusqueda === esperado) continue;
      cifras.aActualizar += 1;
      if (lote !== undefined) {
        lote.update(doc.ref, { serieBusqueda: esperado });
        enLote += 1;
      }
    }
    if (lote !== undefined && enLote > 0) {
      await lote.commit();
      cifras.actualizadas += enLote;
    }
    ultimo = pagina.docs[pagina.docs.length - 1];
    if (pagina.docs.length < tamanoLote) break;
  }
  return cifras;
}

const USO = 'uso: rellenar-serie-busqueda.mjs <tenant> --proyecto <id> [--escribir] [--confirmar-produccion]';
const falla = (mensaje) => {
  console.error(`rellenar-serie-busqueda: ${mensaje}`);
  process.exit(1);
};

async function principal() {
  const args = process.argv.slice(2);
  let tenant;
  let proyectoArg;
  let escribir = false;
  let confirmarProduccion = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--proyecto') {
      i += 1;
      proyectoArg = args[i];
    } else if (a === '--escribir') escribir = true;
    else if (a === '--confirmar-produccion') confirmarProduccion = true;
    else if (a.startsWith('--') || tenant !== undefined) falla(USO);
    else tenant = a;
  }
  if (tenant === undefined) falla(USO);
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenant)) falla('el tenant no es un identificador válido');
  let proyecto;
  try {
    ({ proyecto } = validarEntornoAlta({ proyectoArg, confirmarProduccion, hostsEmulador: ['FIRESTORE_EMULATOR_HOST'] }));
  } catch (e) {
    falla(e instanceof Error ? e.message : 'entorno inválido');
  }
  const { getApps, initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (getApps().length === 0) initializeApp({ projectId: proyecto });
  try {
    const c = await rellenar({ firestore: getFirestore(), tenant, escribir });
    console.log(`rellenar-serie-busqueda: revisadas ${String(c.revisadas)}, por actualizar ${String(c.aActualizar)}, sin serie ${String(c.sinSerie)}.`);
    console.log(escribir ? `rellenar-serie-busqueda: actualizadas ${String(c.actualizadas)}.` : 'rellenar-serie-busqueda: simulación, sin escritura (use --escribir para escribir).');
  } catch (e) {
    // Los errores de Firebase suelen traer el id del proyecto: solo se muestra su código.
    falla(`error de Firebase (${e && typeof e === 'object' && 'code' in e ? String(e.code) : 'desconocido'})`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await principal();
