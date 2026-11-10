// Alta del personal de un tenant (cuentas de correo y contraseña + primer administrador).
// Lógica pura: Auth, base de datos y almacén de credenciales llegan por inyección; aquí no hay red ni disco.
// Las contraseñas solo salen por `AlmacenCredenciales` (un archivo 0600 fuera del repositorio): nunca se devuelven
// en el resultado ni se escriben en mensajes de error.
import { asignarPrimerAdministrador, rolEn } from '@novutienda/nucleo';
import type { AuthMin, BaseDatosIdentidad } from '@novutienda/nucleo';

export type RolPersonal = 'adm' | 'sup' | 'caj';
const ROLES: readonly RolPersonal[] = ['adm', 'sup', 'caj'];
/** El plan base admite 3 usuarios por tenant. */
export const MAX_CUENTAS = 3;
export const LARGO_CONTRASENA = 32;

export interface CuentaEntrada {
  readonly correo: string;
  readonly rol: RolPersonal;
  readonly nombre?: string;
}
export interface EntradaPersonal {
  readonly cuentas: readonly CuentaEntrada[];
}

const CORREO = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const normalizar = (correo: string): string => correo.trim().toLowerCase();

/** Valida el archivo de entrada: de 1 a 3 cuentas, correos distintos y exactamente un administrador. Lanza con un mensaje sin correos. */
export function validarEntradaPersonal(x: unknown): EntradaPersonal {
  if (!esObjeto(x) || !Array.isArray(x['cuentas'])) throw new Error('la entrada debe ser { "cuentas": [...] }');
  const sobran = Object.keys(x).filter((k) => k !== 'cuentas');
  if (sobran.length > 0) throw new Error('la entrada tiene claves no admitidas');
  const crudas = x['cuentas'] as unknown[];
  if (crudas.length < 1 || crudas.length > MAX_CUENTAS) throw new Error(`la entrada debe tener de 1 a ${String(MAX_CUENTAS)} cuentas`);
  const cuentas: CuentaEntrada[] = [];
  const vistos = new Set<string>();
  crudas.forEach((c, i) => {
    if (!esObjeto(c)) throw new Error(`cuenta ${String(i + 1)}: debe ser un objeto`);
    const extra = Object.keys(c).filter((k) => !['correo', 'rol', 'nombre'].includes(k));
    if (extra.length > 0) throw new Error(`cuenta ${String(i + 1)}: claves no admitidas`);
    const correo = c['correo'];
    if (typeof correo !== 'string' || !CORREO.test(correo.trim())) throw new Error(`cuenta ${String(i + 1)}: correo inválido`);
    const rol = c['rol'];
    if (typeof rol !== 'string' || !(ROLES as readonly string[]).includes(rol)) throw new Error(`cuenta ${String(i + 1)}: rol inválido`);
    const nombre = c['nombre'];
    if (nombre !== undefined && (typeof nombre !== 'string' || nombre.trim() === '' || nombre.length > 80)) throw new Error(`cuenta ${String(i + 1)}: nombre inválido`);
    const clave = normalizar(correo);
    if (vistos.has(clave)) throw new Error('hay correos repetidos en la entrada');
    vistos.add(clave);
    cuentas.push({ correo: clave, rol: rol as RolPersonal, ...(typeof nombre === 'string' ? { nombre: nombre.trim() } : {}) });
  });
  if (cuentas.filter((c) => c.rol === 'adm').length !== 1) throw new Error('la entrada debe tener exactamente un administrador');
  return { cuentas };
}

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_';

/** Contraseña aleatoria de LARGO_CONTRASENA caracteres a partir de bytes aleatorios inyectados (crypto.randomBytes en el script). */
export function generarContrasena(aleatorios: (n: number) => Uint8Array): string {
  // Rechazo de los bytes que sesgarían el reparto: 256 - (256 % 58) = 232.
  const limite = 256 - (256 % ALFABETO.length);
  let salida = '';
  while (salida.length < LARGO_CONTRASENA) {
    for (const b of aleatorios(LARGO_CONTRASENA * 2)) {
      if (b < limite && salida.length < LARGO_CONTRASENA) salida += ALFABETO[b % ALFABETO.length];
    }
  }
  return salida;
}

export interface UsuarioAuth {
  readonly uid: string;
  readonly disabled: boolean;
  readonly emailVerified: boolean;
  readonly proveedores: readonly string[];
  readonly claims?: Readonly<Record<string, unknown>> | undefined;
}

/** Lo que el alta del personal necesita de Firebase Auth (además de `AuthMin` del núcleo). */
export interface AuthOperador extends AuthMin {
  /** `null` si el correo no tiene cuenta. */
  buscarPorCorreo(correo: string): Promise<UsuarioAuth | null>;
  /** Crea la cuenta con correo verificado; devuelve su uid. */
  crear(datos: { correo: string; contrasena: string; nombre?: string }): Promise<string>;
  /** Todos los usuarios del proyecto (paginados por el adaptador). */
  listarUsuarios(): Promise<readonly UsuarioAuth[]>;
}

export interface Credencial {
  readonly correo: string;
  readonly rol: RolPersonal;
  readonly contrasena: string;
}
export interface AlmacenCredenciales {
  leer(): Promise<readonly Credencial[]>;
  /** Escritura atómica con permisos 0600; reemplaza todo el contenido. */
  guardar(credenciales: readonly Credencial[]): Promise<void>;
}

/** Misma regla que `OPERADOR_VALIDO` del núcleo (identidad/asignar.ts); el prefijo «operador:» cuenta en el largo. */
const OPERADOR_VALIDO = /^[a-z0-9:._@-]{1,128}$/;
/** Valor fijo de `operador` para la auditoría: nunca viene de un argumento libre. En minúsculas; lo inválido cae a «script». */
export const operadorDe = (cuenta?: string): string => {
  const nombre = (cuenta ?? '').trim().toLowerCase();
  const candidato = `operador:${nombre}`;
  return nombre !== '' && OPERADOR_VALIDO.test(candidato) ? candidato : 'operador:script';
};

export interface ResultadoPersonal {
  readonly cuentas: number;
  readonly creadas: number;
  readonly existentes: number;
  readonly adminAsignado: boolean;
  readonly aplicado: boolean;
  /** Líneas legibles sin correos, uids ni contraseñas. */
  readonly diferencias: readonly string[];
}

/**
 * Compara contra Auth y, solo con `aplicar`, crea las cuentas faltantes y asigna el primer administrador.
 * Aborta (sin escribir) si: una cuenta está deshabilitada; otro usuario ya es administrador del tenant; una cuenta
 * existente no tiene credencial guardada (no se pisa una cuenta ajena); o una cuenta existente no es de correo y contraseña.
 * También aborta si el tenant no existe o no está activo (suspendido o dado de baja): no se crea personal ahí.
 */
export async function aplicarPersonal(o: {
  readonly tenantId: string;
  readonly entrada: EntradaPersonal;
  readonly auth: AuthOperador;
  readonly db: BaseDatosIdentidad;
  readonly credenciales: AlmacenCredenciales;
  readonly aleatorios: (n: number) => Uint8Array;
  readonly operador: string;
  readonly aplicar: boolean;
  readonly ahora?: () => number;
}): Promise<ResultadoPersonal> {
  const entrada = validarEntradaPersonal(o.entrada);
  // Antes de crear cuentas: el operador de la auditoría debe ser válido para el núcleo (si no, fallaría en el paso 3 con cuentas ya creadas).
  if (!OPERADOR_VALIDO.test(o.operador)) throw new Error('el operador de la auditoría no es válido');
  const tenant = await o.db.runTransaction((tx) => tx.get(`tenants/${o.tenantId}`));
  if (!tenant.existe) throw new Error('el tenant no existe');
  if (tenant.data()?.['estado'] !== 'activo') throw new Error('el tenant no está activo: no se crea personal');
  const previas = await o.credenciales.leer();
  const estados = new Map<string, UsuarioAuth | null>();
  for (const c of entrada.cuentas) estados.set(c.correo, await o.auth.buscarPorCorreo(c.correo));

  if ([...estados.values()].some((u) => u?.disabled === true)) throw new Error('hay cuentas deshabilitadas: no se continúa');
  for (const [c, u] of estados) {
    if (u === null) continue;
    if (!u.proveedores.includes('password')) throw new Error('una cuenta existente no es de correo y contraseña');
    if (!previas.some((p) => p.correo === c)) throw new Error('una cuenta existente no tiene credencial guardada en el archivo de credenciales: no se pisa');
  }
  const admEntrada = entrada.cuentas.find((c) => c.rol === 'adm');
  const uidAdmDestino = admEntrada === undefined ? undefined : estados.get(admEntrada.correo)?.uid;
  const todos = await o.auth.listarUsuarios();
  const otrosAdm = todos.filter((u) => rolEn(u.claims, o.tenantId) === 'adm' && u.uid !== uidAdmDestino);
  if (otrosAdm.length > 0) throw new Error('el tenant ya tiene un administrador distinto del destino: no se continúa');
  const admYaAsignado = uidAdmDestino !== undefined && todos.some((u) => u.uid === uidAdmDestino && rolEn(u.claims, o.tenantId) === 'adm');

  const faltan = entrada.cuentas.filter((c) => estados.get(c.correo) === null);
  const diferencias: string[] = [];
  if (faltan.length > 0) diferencias.push(`cuentas por crear: ${String(faltan.length)}`);
  if (!admYaAsignado) diferencias.push('administrador por asignar: 1');
  const base = { cuentas: entrada.cuentas.length, existentes: entrada.cuentas.length - faltan.length };
  if (!o.aplicar || diferencias.length === 0) {
    return { ...base, creadas: 0, adminAsignado: false, aplicado: false, diferencias };
  }

  // 1) Las contraseñas se guardan ANTES de crear las cuentas: si el proceso se corta, no queda una cuenta sin contraseña conocida.
  const guardadas: Credencial[] = [...previas];
  for (const c of faltan) {
    if (!guardadas.some((p) => p.correo === c.correo)) guardadas.push({ correo: c.correo, rol: c.rol, contrasena: generarContrasena(o.aleatorios) });
  }
  if (faltan.length > 0) await o.credenciales.guardar(guardadas);
  // 2) Creación de las cuentas.
  const uids = new Map<string, string>();
  for (const [c, u] of estados) if (u !== null) uids.set(c, u.uid);
  for (const c of faltan) {
    const cred = guardadas.find((p) => p.correo === c.correo);
    if (cred === undefined) throw new Error('falta la credencial de una cuenta por crear');
    uids.set(c.correo, await o.auth.crear({ correo: c.correo, contrasena: cred.contrasena, ...(c.nombre !== undefined ? { nombre: c.nombre } : {}) }));
  }
  // 3) Primer administrador (falla cerrado si el tenant no existe, ya hay adm o el correo no está verificado).
  let adminAsignado = false;
  if (!admYaAsignado && admEntrada !== undefined) {
    const uid = uids.get(admEntrada.correo);
    if (uid === undefined) throw new Error('no se encontró la cuenta del administrador');
    await asignarPrimerAdministrador({ auth: o.auth, db: o.db, ...(o.ahora !== undefined ? { ahora: o.ahora } : {}) }, o.tenantId, uid, o.operador);
    adminAsignado = true;
  }
  return { ...base, creadas: faltan.length, adminAsignado, aplicado: true, diferencias };
}
