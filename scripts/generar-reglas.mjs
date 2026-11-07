// Generador de firestore.rules desde el registro de módulos.
// La salida es determinista (sin fechas) para que reglas:verificar pueda
// comparar el archivo versionado con lo generado. Nunca se edita a mano.
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const ROLES = ['caj', 'sup', 'adm'];
const SEGMENTO = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** Proveedor de identidad que el claim de rol exige en la sesión. */
export const PROVEEDOR_PERSONAS = 'password';

export class ErrorGenerador extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorGenerador';
  }
}

function listaRoles(roles) {
  for (const r of roles) {
    if (!ROLES.includes(r)) throw new ErrorGenerador(`Rol inválido: ${String(r)}`);
  }
  return `[${roles.map((r) => `'${r}'`).join(', ')}]`;
}

const ID_MODULO = /^[a-z][a-z0-9-]*$/;

function validarIdModulo(id) {
  if (typeof id !== 'string' || !ID_MODULO.test(id)) {
    throw new ErrorGenerador(`Id de módulo no admitido: ${JSON.stringify(id)} (patrón ^[a-z][a-z0-9-]*$)`);
  }
}

function validarRuta(ruta) {
  const segmentos = ruta.split('/');
  if (!segmentos.every((s) => SEGMENTO.test(s))) {
    throw new ErrorGenerador(`Ruta con caracteres no admitidos: "${ruta}"`);
  }
  // tenants/{tenantId}/<ruta>/{id} debe ser la ruta de un documento: número par
  // de segmentos, es decir, un número impar de segmentos en <ruta>.
  if (segmentos.length % 2 === 0) {
    throw new ErrorGenerador(
      `La ruta "${ruta}" no es una colección válida de Firestore (número par de segmentos)`,
    );
  }
}

/** Una colección de raíz vive fuera de tenants/{tenantId}: solo el servidor la toca. */
function validarRaiz(c, id) {
  const donde = `Colección de raíz ${id}/${c.ruta}`;
  if (c.ruta.includes('/')) throw new ErrorGenerador(`${donde}: la ruta debe tener un solo segmento`);
  if (!SEGMENTO.test(c.ruta)) {
    throw new ErrorGenerador(`Ruta con caracteres no admitidos: "${c.ruta}"`);
  }
  if (c.ruta === 'tenants') throw new ErrorGenerador(`${donde}: no puede llamarse "tenants"`);
  if (c.lectura.length > 0) {
    throw new ErrorGenerador(`${donde}: la lectura debe ser [] (solo el servidor lee)`);
  }
  if (c.escritura !== 'servidor') {
    throw new ErrorGenerador(`${donde}: la escritura debe ser 'servidor'`);
  }
  if (c.limite !== undefined) throw new ErrorGenerador(`${donde}: no admite límite de plan`);
}

function bloqueRaiz(c) {
  return [
    `    match /${c.ruta}/{id} {`,
    '      allow read: if false;',
    '      allow write: if false; // solo el servidor escribe',
    '    }',
  ].join('\n');
}

function bloqueColeccion(c) {
  validarRuta(c.ruta);
  // Una colección con límite de plan solo puede escribirla el servidor: una
  // escritura directa desde el cliente eludiría el conteo del límite.
  if (c.limite !== undefined && c.escritura !== 'servidor') {
    throw new ErrorGenerador(
      `La colección "${c.ruta}" declara límite "${String(c.limite)}" pero su escritura no es 'servidor'`,
    );
  }
  const lectura =
    c.lectura.length === 0
      ? 'allow read: if false;'
      : `allow read: if tieneRol(tenantId, ${listaRoles(c.lectura)});`;
  const escritura =
    c.escritura === 'servidor'
      ? 'allow write: if false;'
      : c.escritura.length === 0
        ? 'allow write: if false;'
        : `allow write: if tieneRol(tenantId, ${listaRoles(c.escritura)});`;
  const nota = c.escritura === 'servidor' ? ' // solo el servidor escribe' : '';
  return [
    `    match /tenants/{tenantId}/${c.ruta}/{id} {`,
    `      ${lectura}`,
    `      ${escritura}${nota}`,
    '    }',
  ].join('\n');
}

/** Produce el texto de firestore.rules para una lista de manifiestos (en orden). */
export function generarReglas(manifiestos) {
  const bloques = [];
  const vistas = new Set();
  for (const m of manifiestos) {
    validarIdModulo(m.id);
    if (m.colecciones.length === 0) continue;
    const propios = [`    // Módulo ${m.id}`];
    const raices = [];
    for (const c of m.colecciones) {
      if (c.ambito !== undefined && c.ambito !== 'tenant' && c.ambito !== 'raiz') {
        throw new ErrorGenerador(`Ámbito inválido en ${m.id}/${c.ruta}: ${String(c.ambito)}`);
      }
      if (vistas.has(c.ruta)) throw new ErrorGenerador(`Ruta duplicada: "${c.ruta}"`);
      vistas.add(c.ruta);
      if (c.ambito === 'raiz') {
        validarRaiz(c, m.id);
        raices.push(bloqueRaiz(c));
      } else {
        propios.push(bloqueColeccion(c));
      }
    }
    if (raices.length > 0) {
      propios.push(`    // ${m.id}: colecciones de raíz (solo servidor)`, ...raices);
    }
    bloques.push(propios.join('\n'));
  }
  return `rules_version = '2';

// GENERADO por scripts/generar-reglas.mjs desde el registro de módulos.
// No se edita a mano: ejecute \`pnpm reglas:generar\`. \`reglas:verificar\`
// falla si este archivo difiere de lo generado.
//
// Principios: se niega por defecto; el tenant sale de la ruta, nunca de un
// campo; el rol sale del claim firmado (pl.t[tenantId]) y solo vale si la
// sesión se abrió con el proveedor esperado y el correo está verificado;
// rolEn devuelve '' y nunca null.
service cloud.firestore {
  match /databases/{database}/documents {

    function autenticado() {
      return request.auth != null && request.auth.uid != null;
    }

    function proveedor() {
      return request.auth.token.get('firebase', {}).get('sign_in_provider', '');
    }

    // Rol en ESTE tenant o cadena vacía (nunca null: comparar null revienta).
    function rolEn(tenantId) {
      return request.auth.token.get('pl', {}).get('t', {}).get(tenantId, '');
    }

    function tieneRol(tenantId, roles) {
      return autenticado()
        && proveedor() == '${PROVEEDOR_PERSONAS}'
        && request.auth.token.get('email_verified', false) == true
        && rolEn(tenantId) in roles;
    }

${bloques.join('\n\n')}

    // Negación final: todo lo no declarado queda inaccesible.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
`;
}

const SEGMENTO_ALM = /^(?:[A-Za-z][A-Za-z0-9_-]*|\{[A-Za-z][A-Za-z0-9_]*\})$/;
const SEGMENTO_RESTO = /^\{[A-Za-z][A-Za-z0-9_]*=\*\*\}$/;
const TIPO_ARCHIVO = /^[a-z][a-z0-9_]*$/;
const VARIABLES_RESERVADAS = new Set(['tenantId', 'todo', 'bucket']);
const CONTENT_TYPE = /^[a-z]+\/\([a-z0-9|-]+\)$/;

function validarAlmacenamiento(m, a) {
  validarIdModulo(m.id);
  const donde = `Almacenamiento ${m.id}/${a.ruta}`;
  const segs = a.ruta.split('/');
  if (segs[0] !== 'privado' && segs[0] !== 'publico') {
    throw new ErrorGenerador(`${donde}: el primer segmento debe ser "privado" o "publico"`);
  }
  if (segs.length < 2) throw new ErrorGenerador(`${donde}: falta al menos un segmento tras "${segs[0]}"`);
  segs.forEach((s, i) => {
    const ultimo = i === segs.length - 1;
    if (!(SEGMENTO_ALM.test(s) || (ultimo && i > 0 && SEGMENTO_RESTO.test(s)))) {
      throw new ErrorGenerador(`${donde}: segmento no admitido "${s}"`);
    }
    const v = /^\{([A-Za-z][A-Za-z0-9_]*)(?:=\*\*)?\}$/.exec(s);
    if (v !== null && VARIABLES_RESERVADAS.has(v[1])) {
      throw new ErrorGenerador(`${donde}: variable de ruta reservada "{${v[1]}}"`);
    }
  });
  if (a.lectura !== 'servidor' && a.lectura !== 'publica') {
    throw new ErrorGenerador(`${donde}: lectura inválida "${String(a.lectura)}"`);
  }
  if (a.lectura === 'publica' && segs[0] !== 'publico') {
    throw new ErrorGenerador(`${donde}: la lectura 'publica' solo vale bajo publico/`);
  }
  if (a.escritura === 'servidor') return;
  const e = a.escritura;
  if (e?.tipo !== 'subidaReservada') throw new ErrorGenerador(`${donde}: escritura inválida`);
  if (segs[0] !== 'privado') throw new ErrorGenerador(`${donde}: subidaReservada solo vale bajo privado/`);
  if (segs.length < 3 || segs[segs.length - 2] !== '{productoId}' || segs[segs.length - 1] !== '{subidaId}') {
    throw new ErrorGenerador(`${donde}: la ruta de subidaReservada debe terminar en {productoId}/{subidaId}`);
  }
  if (e.roles.length === 0) throw new ErrorGenerador(`${donde}: roles no puede estar vacío`);
  for (const r of e.roles) {
    if (!ROLES.includes(r)) throw new ErrorGenerador(`${donde}: rol inválido ${r}`);
  }
  if (typeof e.reserva !== 'string') throw new ErrorGenerador(`${donde}: reserva inválida`);
  validarRuta(e.reserva);
  const reserva = m.colecciones.find((c) => c.ruta === e.reserva);
  if (reserva === undefined) {
    throw new ErrorGenerador(`${donde}: la reserva "${e.reserva}" no es una colección del mismo manifiesto`);
  }
  if (reserva.escritura !== 'servidor' || (reserva.ambito !== undefined && reserva.ambito !== 'tenant')) {
    throw new ErrorGenerador(`${donde}: la reserva "${e.reserva}" debe ser de ámbito tenant y con escritura 'servidor'`);
  }
  if (e.archivos.length === 0) throw new ErrorGenerador(`${donde}: archivos no puede estar vacío`);
  const tipos = new Set();
  for (const f of e.archivos) {
    if (typeof f.tipo !== 'string' || f.tipo === '') throw new ErrorGenerador(`${donde}: tipo de archivo vacío`);
    if (!TIPO_ARCHIVO.test(f.tipo)) {
      throw new ErrorGenerador(`${donde}: tipo de archivo "${f.tipo}" no cumple el patrón ^[a-z][a-z0-9_]*$`);
    }
    if (tipos.has(f.tipo)) throw new ErrorGenerador(`${donde}: tipo de archivo duplicado "${f.tipo}"`);
    tipos.add(f.tipo);
    if (!Number.isInteger(f.bytesMax) || f.bytesMax <= 0) {
      throw new ErrorGenerador(`${donde}: bytesMax de "${f.tipo}" debe ser un entero mayor que 0`);
    }
    if (!CONTENT_TYPE.test(f.contentType)) {
      throw new ErrorGenerador(`${donde}: contentType de "${f.tipo}" no cumple el patrón (por ejemplo image/(jpeg|png))`);
    }
  }
}

function bytesTexto(n) {
  const MIB = 1024 * 1024;
  return n % MIB === 0 ? `${n / MIB} * 1024 * 1024` : String(n);
}

/**
 * Campos del documento de reserva que la plantilla `reservaValida` lee (`r.<campo>`).
 * Una prueba comprueba que el texto generado nombra exactamente estos y ninguno más.
 */
export const CAMPOS_PLANTILLA_RESERVA = Object.freeze(['estado', 'venceEn', 'productoId', 'por', 'bytes', 'tipo']);

function funcionReserva(reserva, archivos) {
  const ramas = archivos.map(
    (f) =>
      `(r.tipo == '${f.tipo}'\n` +
      `              && request.resource.size <= ${bytesTexto(f.bytesMax)}\n` +
      `              && request.resource.contentType.matches('${f.contentType}'))`,
  );
  return `    // Reserva hecha en Firestore por el servidor; una sola lectura cruzada por petición.
    function reservaValida(tenantId, productoId, subidaId) {
      let r = firestore.get(/databases/(default)/documents/tenants/$(tenantId)/${reserva}/$(subidaId)).data;
      return r.estado == 'reservada'
        && r.venceEn is number
        && request.time.toMillis() <= r.venceEn
        && r.productoId == productoId
        && r.por == request.auth.uid
        && request.resource.size > 0
        && request.resource.size <= r.bytes
        && (${ramas.join('\n            || ')});
    }
`;
}

/** Produce el texto de storage.rules para una lista de manifiestos (en orden). */
export function generarReglasAlmacenamiento(manifiestos) {
  const vistas = new Set();
  let subida;
  for (const m of manifiestos) {
    for (const a of m.almacenamiento ?? []) {
      validarAlmacenamiento(m, a);
      if (vistas.has(a.ruta)) throw new ErrorGenerador(`Ruta de almacenamiento duplicada "${a.ruta}"`);
      vistas.add(a.ruta);
      if (a.escritura !== 'servidor') {
        if (subida !== undefined) throw new ErrorGenerador('Más de una subidaReservada en el registro');
        subida = a.escritura;
      }
    }
  }
  const bloques = [];
  for (const m of manifiestos) {
    const rutas = m.almacenamiento ?? [];
    if (rutas.length === 0) continue;
    const propios = [`    // Módulo ${m.id}`];
    for (const a of rutas) {
      const cabeza = `    match /tenants/{tenantId}/${a.ruta} {`;
      if (a.escritura !== 'servidor') {
        propios.push(
          cabeza,
          '      // `resource == null`: el objeto no existe todavía (nunca se reemplaza un original ya subido).',
          '      allow create: if resource == null && editor(tenantId) && reservaValida(tenantId, productoId, subidaId);',
          '      allow read, update, delete: if false;',
          '    }',
        );
      } else if (a.lectura === 'publica') {
        propios.push(cabeza, '      allow read: if true;', '      allow write: if false;', '    }');
      } else {
        propios.push(cabeza, '      allow read, write: if false;', '    }');
      }
    }
    bloques.push(propios.join('\n'));
  }
  const editor = subida === undefined ? '' : `    function editor(tenantId) {
      return request.auth != null
        && request.auth.token.get('firebase', {}).get('sign_in_provider', '') == '${PROVEEDOR_PERSONAS}'
        && request.auth.token.get('email_verified', false) == true
        && rolEn(tenantId) in ${listaRoles(subida.roles)};
    }

${funcionReserva(subida.reserva, subida.archivos)}
`;
  const cuerpo = bloques.length === 0 ? '' : `${bloques.join('\n\n')}\n\n`;
  return `rules_version = '2';

// GENERADO por scripts/reglas.mjs desde el registro de módulos; no editar a mano.
// Ejecute \`pnpm reglas:generar\`; \`reglas:verificar\` falla si este archivo difiere de lo generado.
//
// Cloud Storage. Se niega todo salvo lo que cada módulo declara en su manifiesto (\`almacenamiento\`):
//  - subidaReservada: SOLO con sesión de correo y contraseña verificado, rol de la lista EN ESE tenant (claim pl),
//    y solo si en Firestore existe la reserva de la subida (misma ruta, mismo producto, hecha por esta persona,
//    aún \`reservada\` y NO vencida: \`venceEn\`) y el archivo cumple tamaño y tipo. Solo se puede CREAR: no hay
//    actualización ni borrado desde el navegador.
//  - lectura 'publica': abierta a cualquiera, bajo publico/.
//  - todo lo demás lo lee y escribe solo el servidor.
service firebase.storage {
  match /b/{bucket}/o {

    function rolEn(tenantId) {
      return request.auth.token.get('pl', {}).get('t', {}).get(tenantId, '');
    }

${editor}${cuerpo}    match /{todo=**} {
      allow read, write: if false;
    }
  }
}
`;
}

/**
 * Carga los manifiestos del registro de la plataforma (plataforma/registro.ts),
 * que importa la entrada pública de cada paquete. Node no resuelve las
 * importaciones «.js» hacia archivos «.ts» ni ejecuta la sintaxis de TypeScript
 * que requiere transformación (propiedades de parámetro, enums); los ganchos
 * lo hacen solo aquí.
 */
export async function cargarManifiestos(raiz = process.cwd()) {
  registerHooks({
    resolve(especificador, contexto, siguiente) {
      try {
        return siguiente(especificador, contexto);
      } catch (error) {
        if (error?.code === 'ERR_MODULE_NOT_FOUND' && /^\.{1,2}\/.*\.js$/.test(especificador)) {
          return siguiente(especificador.replace(/\.js$/, '.ts'), contexto);
        }
        throw error;
      }
    },
  });
  registerHooks({
    load(url, contexto, siguiente) {
      if (!url.startsWith('file://') || !url.endsWith('.ts') || url.includes('/node_modules/')) {
        return siguiente(url, contexto);
      }
      const codigo = stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), {
        mode: 'transform',
        sourceUrl: url,
      });
      return { format: 'module', source: codigo, shortCircuit: true };
    },
  });
  const entrada = pathToFileURL(resolve(raiz, 'plataforma/registro.ts')).href;
  const { manifiestosEnOrden } = await import(entrada);
  return manifiestosEnOrden(); // lanza si hay rutas duplicadas
}
