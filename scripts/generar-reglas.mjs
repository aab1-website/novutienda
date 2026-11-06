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
