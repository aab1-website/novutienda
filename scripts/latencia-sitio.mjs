// Latencia de publicación del sitio de un tenant (solo lectura).
//
//   node scripts/latencia-sitio.mjs --tenant <t> --desde <iso> [--proyecto <id>] [--limite-min 10] [--json]
//
// Lee `tenants/{t}/reconstrucciones` y `tenants/{t}/publicado/estado` con las credenciales por defecto de la aplicación
// (ADC; proyecto en --proyecto o GOOGLE_CLOUD_PROJECT) y calcula, por trabajo, el tiempo hasta `completada`:
//   - base `publicacion`: el trabajo de la versión vigente (publicado/estado.version, motivo publicacion) se mide desde
//     `publicadoEn` (publicar → completada). Solo se conoce la hora de la última publicación.
//   - base `solicitud`: los demás, desde `solicitadaEnMs` (aproximación: no incluye la ventana de espera).
// Informa p50, máximo y marca con «>» lo que supera el límite (10 min). Un trabajo sin cerrar con más de ese tiempo
// desde su inicio también se marca. No escribe nada ni imprime identificadores del cliente (ni el tenant).
// Salida: 0 sin atrasos, 1 con atrasos, 2 uso inválido, 3 error de Firebase.
import { pathToFileURL } from 'node:url';

export const LIMITE_MIN = 10;

const numero = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** Mediana de una lista de números (promedio de los dos centrales si es par); null si está vacía. */
export function mediana(valores) {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * @param {{ id: string, estado?: unknown, version?: unknown, motivo?: unknown, solicitadaEnMs?: unknown, completadaEnMs?: unknown }[]} trabajos
 * @param {{ version?: unknown, publicadoEn?: unknown } | undefined} estadoPublicado
 * @param {{ desdeMs: number, ahoraMs: number, limiteMin?: number }} opciones
 */
export function calcularLatencias(trabajos, estadoPublicado, { desdeMs, ahoraMs, limiteMin = LIMITE_MIN }) {
  const limiteMs = limiteMin * 60_000;
  const publicadoMs = typeof estadoPublicado?.publicadoEn === 'string' ? Date.parse(estadoPublicado.publicadoEn) : NaN;
  const versionVigente = numero(estadoPublicado?.version);
  const filas = [];
  for (const t of trabajos) {
    const solicitada = numero(t.solicitadaEnMs);
    if (solicitada === null || solicitada < desdeMs) continue;
    const completada = numero(t.completadaEnMs);
    const esPublicacion = t.motivo === 'publicacion' && versionVigente !== null && numero(t.version) === versionVigente && Number.isFinite(publicadoMs);
    const base = esPublicacion ? 'publicacion' : 'solicitud';
    const inicio = esPublicacion ? publicadoMs : solicitada;
    const estado = typeof t.estado === 'string' ? t.estado : 'desconocido';
    let ms = null;
    if (estado === 'completada' && completada !== null && completada >= inicio) ms = completada - inicio;
    // Sin cerrar: la espera acumulada hasta ahora cuenta como atraso si ya pasó el límite.
    const atrasado = ms !== null ? ms > limiteMs : (estado === 'pendiente' || estado === 'en_curso') && ahoraMs - inicio > limiteMs;
    filas.push({ id: t.id, estado, base, ms, atrasado });
  }
  filas.sort((a, b) => a.id.localeCompare(b.id));
  const medidas = filas.filter((f) => f.ms !== null).map((f) => f.ms);
  return {
    filas,
    medidos: medidas.length,
    p50Ms: mediana(medidas),
    maxMs: medidas.length > 0 ? Math.max(...medidas) : null,
    fallidas: filas.filter((f) => f.estado === 'fallida').length,
    atrasadas: filas.filter((f) => f.atrasado).length,
    limiteMin,
  };
}

const min = (ms) => (ms === null ? '-' : `${(ms / 60_000).toFixed(1)} min`);

export function formatear(r) {
  const lineas = r.filas.map((f) => `${f.atrasado ? '>' : ' '} ${f.id}  ${f.estado}  base ${f.base}  ${min(f.ms)}`);
  lineas.push(
    `trabajos medidos: ${r.medidos}; p50: ${min(r.p50Ms)}; máximo: ${min(r.maxMs)}; fallidas: ${r.fallidas}; ` +
      `sobre ${r.limiteMin} min o atrasadas: ${r.atrasadas}`,
  );
  return lineas.join('\n');
}

export function leerArgumentos(args) {
  const o = { json: false, limiteMin: LIMITE_MIN };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--json') o.json = true;
    else if (['--tenant', '--desde', '--proyecto', '--limite-min'].includes(a)) {
      const v = args[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error('uso');
      i += 1;
      if (a === '--tenant') o.tenant = v;
      else if (a === '--desde') o.desde = v;
      else if (a === '--proyecto') o.proyecto = v;
      else o.limiteMin = Number(v);
    } else throw new Error('uso');
  }
  if (o.tenant === undefined || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(o.tenant)) throw new Error('--tenant falta o es inválido');
  const desdeMs = o.desde === undefined ? NaN : Date.parse(o.desde);
  if (!Number.isFinite(desdeMs)) throw new Error('--desde falta o no es una fecha ISO');
  if (!Number.isFinite(o.limiteMin) || o.limiteMin <= 0) throw new Error('--limite-min inválido');
  return { ...o, desdeMs };
}

async function principal() {
  let o;
  try {
    o = leerArgumentos(process.argv.slice(2));
  } catch (e) {
    console.error(`latencia-sitio: ${e instanceof Error && e.message !== 'uso' ? e.message : 'uso: latencia-sitio.mjs --tenant <t> --desde <iso> [--proyecto <id>] [--limite-min 10] [--json]'}`);
    process.exit(2);
  }
  const proyecto = o.proyecto ?? process.env['GOOGLE_CLOUD_PROJECT'];
  if (!proyecto) {
    console.error('latencia-sitio: falta --proyecto o GOOGLE_CLOUD_PROJECT');
    process.exit(2);
  }
  try {
    const { getApps, initializeApp } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    if (getApps().length === 0) initializeApp({ projectId: proyecto });
    const db = getFirestore();
    const base = `tenants/${o.tenant}`;
    const snap = await db.collection(`${base}/reconstrucciones`).where('solicitadaEnMs', '>=', o.desdeMs).get();
    const trabajos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const estado = (await db.doc(`${base}/publicado/estado`).get()).data();
    const r = calcularLatencias(trabajos, estado, { desdeMs: o.desdeMs, ahoraMs: Date.now(), limiteMin: o.limiteMin });
    console.log(o.json ? JSON.stringify(r) : formatear(r));
    process.exit(r.atrasadas > 0 ? 1 : 0);
  } catch (e) {
    // Los errores de Firebase suelen traer el id del proyecto: solo se muestra su código.
    console.error(`latencia-sitio: error de Firebase (${e && typeof e === 'object' && 'code' in e ? String(e.code) : 'desconocido'})`);
    process.exit(3);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await principal();
