// Fija el redondeo de precios de un tenant (decisión del 25/11: lo cambia SOLO NovuTienda, por ahora con este script del operador).
//
//   node scripts/fijar-redondeo.mjs --tenant <t> --proyecto <id> [--bob <regla>] [--ars <regla>] [--modo cercano|arriba|abajo]
//        [--motivo <texto>] [--seco | --aplicar] [--confirmar-produccion]
//
// Cada regla se escribe `decimales:N` (0 a 2) o `multiplo:M` (por ejemplo `multiplo:100`); el modo es `cercano` salvo que se pase --modo.
// Una moneda sin bandera conserva su regla vigente. Por omisión es --seco: muestra la regla vigente, la nueva y un ejemplo de precio, sin
// escribir. Con --aplicar ejecuta `fijarRedondeoDe` (plataforma/funciones/servidor/redondeo.ts) en una transacción de Admin SDK: valida,
// compara con las reglas vigentes (esperadas), escribe `config/redondeo`, audita `redondeo.fijar` y publica `redondeo.cambiado`, con lo que
// el consumidor de consola reconstruye el sitio. El uid de la auditoría es `script:<cuenta>`, con la cuenta real que corre el script
// (client_email de GOOGLE_APPLICATION_CREDENTIALS o `gcloud config get-value account`); si no se obtiene, falla. No hay --uid.
// Si `config/redondeo` está inválido, se muestran las reglas de la configuración y se escribe sin reglas esperadas (repara el documento).
// La lectura previa vive en plataforma/operador/redondeo.ts.
// Entorno (scripts/guardia-operador.mjs `validarEntornoAlta`): como alta-tenant.mjs; producción solo con NOVUTIENDA_AMBIENTE=produccion,
// GCP_PROJECT_ID_PROD y --confirmar-produccion. No imprime identificadores de proyecto ni de tenant.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cargarManifiestos } from './generar-reglas.mjs';
import { validarEntornoAlta } from './guardia-operador.mjs';

export const USO = 'uso: fijar-redondeo.mjs --tenant <t> --proyecto <id> [--bob decimales:N|multiplo:M] [--ars decimales:N|multiplo:M] [--modo cercano|arriba|abajo] [--motivo <texto>] [--seco | --aplicar] [--confirmar-produccion]';
export const PRECIO_EJEMPLO = 1234.567;

const RE_TENANT = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MODOS = ['cercano', 'arriba', 'abajo'];
const MONEDAS = { '--bob': 'BOB', '--ars': 'ARS' };

export class ErrorUso extends Error {}

/** `decimales:2` o `multiplo:100` (coma o punto decimal) -> regla sin modo; lanza ErrorUso si no tiene esa forma. */
export function parsearRegla(texto, modo = 'cercano') {
  const m = /^(decimales|multiplo):(\d+(?:[.,]\d+)?)$/.exec(texto ?? '');
  if (!m) throw new ErrorUso(`regla inválida «${texto ?? ''}»: use decimales:N o multiplo:M`);
  const n = Number(m[2].replace(',', '.'));
  return m[1] === 'decimales' ? { tipo: 'decimales', decimales: n, modo } : { tipo: 'multiplo', multiplo: n, modo };
}

export function leerArgumentos(args) {
  const o = { tenant: undefined, proyecto: undefined, reglas: {}, modo: 'cercano', motivo: undefined, aplicar: false, seco: false, confirmarProduccion: false };
  const crudas = {};
  const valor = (i) => {
    const v = args[i + 1];
    if (v === undefined || v.startsWith('--')) throw new ErrorUso(`falta el valor de ${args[i]}`);
    return v;
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--tenant') o.tenant = valor(i++);
    else if (a === '--proyecto') o.proyecto = valor(i++);
    else if (a === '--modo') o.modo = valor(i++);
    else if (a === '--motivo') o.motivo = valor(i++);
    else if (a === '--aplicar') o.aplicar = true;
    else if (a === '--seco') o.seco = true;
    else if (a === '--confirmar-produccion') o.confirmarProduccion = true;
    else if (a in MONEDAS) crudas[MONEDAS[a]] = valor(i++);
    else throw new ErrorUso(`argumento desconocido «${a}»`);
  }
  if (o.tenant === undefined || !RE_TENANT.test(o.tenant)) throw new ErrorUso('indique un --tenant válido');
  if (o.aplicar && o.seco) throw new ErrorUso('--seco y --aplicar son excluyentes');
  if (!MODOS.includes(o.modo)) throw new ErrorUso('--modo debe ser cercano, arriba o abajo');
  if (o.motivo !== undefined && (o.motivo.trim() === '' || o.motivo.length > 200)) throw new ErrorUso('--motivo debe tener entre 1 y 200 caracteres');
  if (Object.keys(crudas).length === 0) throw new ErrorUso('indique al menos --bob o --ars');
  for (const [moneda, texto] of Object.entries(crudas)) o.reglas[moneda] = parsearRegla(texto, o.modo);
  return o;
}

const describir = (r) => (r === undefined ? '(sin regla)' : `${r.tipo === 'decimales' ? `decimales:${r.decimales}` : `multiplo:${r.multiplo}`} (${r.modo})`);

/** Argumentos y entorno, sin tocar nada: `{ o, entorno }` o `{ error }`. */
export function validarEntrada(args, env) {
  try {
    const o = leerArgumentos(args);
    const entorno = validarEntornoAlta({ proyectoArg: o.proyecto, confirmarProduccion: o.confirmarProduccion, hostsEmulador: ['FIRESTORE_EMULATOR_HOST'], env });
    return { o, entorno };
  } catch (e) {
    return { error: e instanceof ErrorUso ? `${e.message}\n${USO}` : e instanceof Error ? e.message : 'entorno inválido' };
  }
}

/**
 * Ejecuta el script con dependencias inyectables (las pruebas pasan dobles). `deps`:
 *   comercialDe(tenant), vigentesDe(tenant, comercial) -> { reglas, invalido }, cuenta() -> cuenta real que corre el script,
 *   uidDeScript(cuenta), transaccion(fn) con una `TransaccionRedondeo`, fijarRedondeoDe, redondear, motivoReglaRedondeoInvalida.
 * Devuelve `{ codigo, salida[], error? }`: 0 bien; 1 rechazo de negocio; 2 uso o entorno; 3 error de Firebase.
 */
export async function ejecutar(args, env, deps) {
  const previo = validarEntrada(args, env);
  if (previo.error !== undefined) return { codigo: 2, salida: [], error: previo.error };
  const { o, entorno } = previo;
  const salida = [];
  try {
    const comercial = await deps.comercialDe(o.tenant);
    const monedas = [...new Set(comercial.mercados.map((m) => m.monedaVenta))];
    const fuera = Object.keys(o.reglas).filter((m) => !monedas.includes(m));
    if (fuera.length > 0) return { codigo: 1, salida, error: `el tenant no vende en ${fuera.join(', ')}` };
    for (const [m, r] of Object.entries(o.reglas)) {
      const motivo = deps.motivoReglaRedondeoInvalida(r);
      if (motivo !== null) return { codigo: 1, salida, error: `regla inválida para ${m}: ${motivo}` };
    }
    const { reglas: vigentes, invalido } = await deps.vigentesDe(o.tenant, comercial);
    const uid = deps.uidDeScript(await deps.cuenta());
    const nuevas = Object.fromEntries(monedas.map((m) => [m, o.reglas[m] ?? vigentes[m]]));
    salida.push(`entorno: ${entorno.ambiente}`);
    if (invalido) salida.push('config/redondeo está inválido: se muestran las reglas de la configuración y se escribirá sin reglas esperadas (repara el documento).');
    for (const m of monedas) {
      const cambia = o.reglas[m] !== undefined;
      salida.push(`${m}: vigente ${describir(vigentes[m])} -> nueva ${describir(nuevas[m])}${cambia ? '' : ' (sin cambio)'}`);
      salida.push(`  ejemplo ${PRECIO_EJEMPLO}: ${deps.redondear(PRECIO_EJEMPLO, vigentes[m])} -> ${deps.redondear(PRECIO_EJEMPLO, nuevas[m])}`);
    }
    if (!o.aplicar) {
      salida.push('fijar-redondeo: seco, sin escritura (use --aplicar para escribir).');
      return { codigo: 0, salida };
    }
    const r = await deps.transaccion((tx) =>
      deps.fijarRedondeoDe(tx, { tenantId: o.tenant, comercial, reglas: nuevas, esperadas: invalido ? null : vigentes, uid, ...(o.motivo === undefined ? {} : { motivo: o.motivo }) }),
    );
    switch (r.tipo) {
      case 'fijado':
        salida.push(`fijar-redondeo: aplicado en ${r.cambiadas.join(', ')}; el sitio se reconstruirá.`);
        return { codigo: 0, salida };
      case 'sin-cambios':
        salida.push('fijar-redondeo: las reglas ya eran esas; no se escribió nada.');
        return { codigo: 0, salida };
      case 'conflicto':
        return { codigo: 1, salida, error: 'las reglas vigentes cambiaron mientras tanto; vuelva a ejecutar en seco' };
      default:
        return { codigo: 1, salida, error: `regla rechazada: ${r.motivo}` };
    }
  } catch (e) {
    // Los errores de Firebase suelen traer el id del proyecto: solo se muestra su código.
    const codigo = e && typeof e === 'object' && 'code' in e ? String(e.code) : undefined;
    return { codigo: codigo === undefined ? 1 : 3, salida, error: codigo === undefined ? (e instanceof Error ? e.message : 'error desconocido') : `error de Firebase (${codigo})` };
  }
}

/** Dependencias reales: Admin SDK + el código del servidor (los ganchos de TypeScript los registra cargarManifiestos). */
export function cuentaDelOperador(env) {
  try {
    const ruta = env.GOOGLE_APPLICATION_CREDENTIALS;
    const correo = ruta ? JSON.parse(readFileSync(ruta, 'utf8')).client_email : undefined;
    if (typeof correo === 'string' && correo !== '') return correo;
  } catch {
    // sin credencial legible: se prueba gcloud
  }
  try {
    return execFileSync('gcloud', ['config', 'get-value', 'account'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

export async function dependenciasReales(proyecto, env = process.env) {
  await cargarManifiestos();
  const { fijarRedondeoDe, interpretarRedondeoDe, RedondeoInvalido } = await import(pathToFileURL(resolve('plataforma/funciones/servidor/redondeo.ts')).href);
  const { leerComercial, leerReglasVigentes, uidDeScript } = await import(pathToFileURL(resolve('plataforma/operador/redondeo.ts')).href);
  const { redondear, motivoReglaRedondeoInvalida } = await import('@novutienda/nucleo');
  const { getApps, initializeApp } = await import('firebase-admin/app');
  const { FieldValue, getFirestore } = await import('firebase-admin/firestore');
  if (getApps().length === 0) initializeApp({ projectId: proyecto });
  const firestore = getFirestore();
  return {
    comercialDe: (t) => leerComercial(firestore, t),
    vigentesDe: (t, comercial) => leerReglasVigentes(firestore, t, comercial, { interpretarRedondeoDe, esRedondeoInvalido: (e) => e instanceof RedondeoInvalido }),
    cuenta: () => cuentaDelOperador(env),
    uidDeScript,
    transaccion: (fn) =>
      firestore.runTransaction((tx) =>
        fn({
          get: async (ruta) => {
            const s = await tx.get(firestore.doc(ruta));
            return { existe: s.exists, data: () => s.data() };
          },
          set: (ruta, datos) => void tx.set(firestore.doc(ruta), datos),
          create: (ruta, datos) => void tx.create(firestore.doc(ruta), datos),
          nuevoId: (coleccion) => firestore.collection(coleccion).doc().id,
          marcaTiempoServidor: () => FieldValue.serverTimestamp(),
          existe: async (ruta) => (await tx.get(firestore.doc(ruta))).exists,
        }),
      ),
    fijarRedondeoDe,
    redondear,
    motivoReglaRedondeoInvalida,
  };
}

async function principal() {
  const env = process.env;
  const args = process.argv.slice(2);
  // Argumentos y entorno se validan antes de cargar nada; las dependencias reales solo si pasan.
  const previo = validarEntrada(args, env);
  if (previo.error !== undefined) {
    console.error(`fijar-redondeo: ${previo.error}`);
    process.exit(2);
  }
  const r = await ejecutar(args, env, await dependenciasReales(previo.entorno.proyecto, env));
  for (const l of r.salida) console.log(l);
  if (r.error !== undefined) console.error(`fijar-redondeo: ${r.error}`);
  process.exit(r.codigo);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await principal();
