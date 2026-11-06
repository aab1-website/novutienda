// Zona de cada archivo del repositorio y reglas de importación entre zonas.
// Plano: docs/arquitectura/01-arquitectura-por-zonas.md §3 (regla de frontera por archivo, enmienda H0) y §5.
//
// La zona NO se infiere del contenido: se DECLARA por ruta en `ZONA_POR_ARCHIVO`. Un archivo nuevo
// que no case con ningún patrón hace fallar `fronteras.test.ts` («ningún archivo sin zona»): quien lo
// crea agrega su patrón aquí (o lo ubica en una carpeta que ya tiene zona). `scripts/zonas.mjs` imprime
// el inventario completo a partir de este mismo mapa.
//
// Este archivo no importa a `verificador.ts` a propósito: `scripts/zonas.mjs` lo carga con el
// stripping de tipos de Node (22.18+), que no resuelve `./verificador.js` → `verificador.ts`.
// La única duplicación es la expresión regular de importaciones, y una prueba comprueba que ambas
// extraen lo mismo.
import { posix } from 'node:path';

/**
 * Zonas (plano §3): `nucleo`, `central`, `plataforma`, `modulo:<id>`, `tenant`; piezas con nombre:
 * `coordinador`, `conector:<nombre>`; `pruebas:<zona>` para lo que prueba una zona; `metodo` para la
 * frontera misma.
 */
export type Zona = string;

export interface ReglaZona {
  /** Se evalúa sobre la ruta relativa a la raíz del repo, con `/`. La primera que casa decide. */
  readonly patron: RegExp;
  /** Zona literal, o con `$1` para tomar el primer grupo del patrón (id del módulo). */
  readonly zona: Zona;
  readonly nota?: string;
}

/** Módulos de negocio con paquete propio (sin `nucleo` ni `panel`, que son zonas, no módulos). */
export const MODULOS = ['inventarios', 'pos', 'recibos', 'consola', 'website'] as const;
const M = MODULOS.join('|');

/** Extensiones que tienen zona obligatoria. Los `.d.ts`/`.d.mts` acompañan a su `.mjs` y entran igual. */
export const ES_CODIGO = /\.(ts|tsx|mts|astro|mjs)$/;

/** Carpetas de primer nivel que el inventario recorre. */
export const CARPETAS_CON_ZONA = ['paquetes', 'plataforma', 'pruebas', 'tenants', 'scripts'] as const;

export const ZONA_POR_ARCHIVO: readonly ReglaZona[] = [
  // ---- Método: la frontera y su medición ---------------------------------------------------------
  { patron: /^pruebas\/fronteras\//, zona: 'metodo' },
  { patron: /^scripts\/zonas\.mjs$/, zona: 'metodo' },

  // ---- Pruebas: la zona que prueban (plano §3, fila `pruebas:<zona>`) ----------------------------
  { patron: /^pruebas\/(funciones|integracion)\//, zona: 'pruebas:coordinador' },
  { patron: /^pruebas\/registro\.test\.ts$/, zona: 'pruebas:coordinador', nota: 'prueba el registro de módulos' },
  { patron: /^pruebas\/panel\//, zona: 'pruebas:central' },
  { patron: new RegExp(`^pruebas/(${M})/`), zona: 'pruebas:modulo:$1' },
  { patron: /^pruebas\/(identidad|limites|tipo-cambio|reglas|tenant)\//, zona: 'pruebas:nucleo' },

  // ---- Tenants: datos y configuración declarativa, nunca lógica (plano §6.4) ---------------------
  { patron: /^tenants\//, zona: 'tenant' },

  // ---- Plataforma: andamiaje del operador (plano §5, «zona sin nombre») --------------------------
  { patron: /^scripts\//, zona: 'plataforma' },
  { patron: /^plataforma\/funciones\/scripts\//, zona: 'plataforma' },

  // ---- Registro y coordinador (plano §3, piezas con nombre propio) -------------------------------
  { patron: /^plataforma\/registro\.ts$/, zona: 'coordinador', nota: 'el registro: el único lugar que enumera los módulos' },
  { patron: /^plataforma\/conectores\/firebase\//, zona: 'conector:firebase' },
  { patron: /^plataforma\/coordinador\//, zona: 'coordinador', nota: 'puertos módulo↔módulo y bandeja' },

  // ---- Borde de ejecución (plataforma/funciones/servidor), por archivo (plano §3 y §5, H0) --------
  { patron: new RegExp(`^plataforma/funciones/servidor/llamadas/(${M})\\.ts$`), zona: 'modulo:$1' },
  { patron: /^plataforma\/funciones\/servidor\/llamadas\/medios\.ts$/, zona: 'modulo:consola' },
  { patron: /^plataforma\/funciones\/servidor\/llamadas\/usuarios\.ts$/, zona: 'central', nota: 'acciones de usuarios (T1)' },
  { patron: /^plataforma\/funciones\/servidor\/trigger-medios\.ts$/, zona: 'modulo:consola' },
  { patron: /^plataforma\/funciones\/servidor\/disparador-sitio\.ts$/, zona: 'modulo:consola' },
  { patron: /^plataforma\/funciones\/servidor\/enlace-pdf\.ts$/, zona: 'modulo:recibos' },
  {
    patron: /^plataforma\/funciones\/servidor\/programadas\/cotizacion\.ts$/,
    zona: 'coordinador',
    nota: 'T1: el plano la preveía núcleo, pero `ejecutarCotizaciones` recorre tenants con el Entorno y dispara la reconstrucción diaria de consola (prueba de ubicación, pregunta 6); el núcleo de la cotización está en paquetes/nucleo/src/tipo-cambio',
  },
  { patron: /^plataforma\/funciones\/servidor\/programadas\/consola\.ts$/, zona: 'modulo:consola', nota: 'T1' },
  { patron: /^plataforma\/funciones\/servidor\/programadas\/tenants\.ts$/, zona: 'coordinador', nota: 'T1 (H0: listarTenants/porTenant son coordinador)' },
  { patron: /^plataforma\/funciones\/servidor\/(redondeo|notificador)\.ts$/, zona: 'nucleo', nota: 'núcleo en ejecución' },
  { patron: /^plataforma\/funciones\/servidor\/http\/novuchat\.ts$/, zona: 'conector:novuchat', nota: 'sirve a inventarios y consola' },
  { patron: /^plataforma\/funciones\/servidor\/http\/sitio\.ts$/, zona: 'conector:sitio', nota: 'sirve a consola' },
  { patron: /^plataforma\/funciones\/servidor\//, zona: 'coordinador' },

  // ---- Paquetes ----------------------------------------------------------------------------------
  { patron: /^paquetes\/nucleo\//, zona: 'nucleo' },
  // Panel: la interfaz de cada módulo vive en su carpeta `pantallas/<m>/` (plano §5.1, enmienda H0; T2): pantallas,
  // sus pruebas y las piezas que solo ese módulo usa (pos: arqueo, pagos; consola: plantillas-vista, esperar; recibos:
  // recibo-vista). `pantallas/{usuarios,configuracion}.tsx` y `pantallas/gestion.test.ts` quedan en la raíz: Central.
  { patron: new RegExp(`^paquetes/panel/src/pantallas/(${M})/`), zona: 'modulo:$1', nota: 'carpeta por módulo (T2)' },
  {
    patron: /^paquetes\/panel\/src\/subidas\//,
    zona: 'central',
    nota: 'T2 (H1, observación 2): el puerto `AlmacenSubidas` y la subida reanudable a Storage son transporte Central, como api/transporte.ts; la espera (`esperarSubida`) es consola y vive en pantallas/consola/',
  },
  // Dobles del panel: material de prueba. Los de módulo, en `doble/<m>/` (T2); no pueden salir a pruebas/ porque
  // servicios.ts (producción, modo humo) y el tsconfig del paquete los alcanzan solo dentro de src/.
  { patron: new RegExp(`^paquetes/panel/src/doble/(${M})/`), zona: 'pruebas:modulo:$1', nota: 'doble de módulo (T2)' },
  { patron: /^paquetes\/panel\/src\/doble\//, zona: 'pruebas:central', nota: 'doble del transporte y del estado' },
  { patron: /^paquetes\/panel\/src\/ayuda-pruebas\.ts$/, zona: 'pruebas:central' },
  { patron: /^paquetes\/panel\//, zona: 'central' },
  { patron: new RegExp(`^paquetes/(${M})/`), zona: 'modulo:$1' },
];

/**
 * Archivos que componen: pueden importar módulos directamente porque su función es juntarlos
 * (plano §3: «el coordinador conoce a todas, solo a través del registro y de los puertos»).
 * Cualquier otro archivo del coordinador o de Central que importe un paquete de módulo es un cruce.
 */
export const COMPOSITORES: readonly RegExp[] = [
  /^plataforma\/registro\.ts$/,
  /^plataforma\/coordinador\/[^/]+\.ts$/, // los puertos mismos
  /^plataforma\/funciones\/servidor\/entorno\.ts$/, // composición de los puertos reales
  /^paquetes\/panel\/src\/ui\/app\.tsx$/, // monta las pantallas de los módulos hasta que el registro las aporte (fase L2)
];

/** A qué zonas sirve cada conector (plano §3: «los conectores dependen de la zona a la que sirven»). `*` = a todas. */
export const SIRVE: Readonly<Record<string, readonly Zona[] | '*'>> = {
  firebase: '*',
  novuchat: ['modulo:inventarios', 'modulo:consola'],
  sitio: ['modulo:consola'],
};

const ES_PRUEBA_EN_PAQUETE = /^paquetes\/.*\.test\.tsx?$/;

/** Zona declarada de una ruta (relativa a la raíz, con `/`), o `undefined` si ningún patrón la cubre. */
export function zonaDe(ruta: string): Zona | undefined {
  // Una prueba dentro de un paquete es `pruebas:<zona del archivo que prueba>`.
  if (ES_PRUEBA_EN_PAQUETE.test(ruta)) {
    const base = zonaDe(ruta.replace(/\.test\.(tsx?)$/, '.$1'));
    if (base === undefined) return undefined;
    return base.startsWith('pruebas:') ? base : `pruebas:${base}`;
  }
  for (const regla of ZONA_POR_ARCHIVO) {
    const m = regla.patron.exec(ruta);
    if (m !== null) return regla.zona.replace('$1', m[1] ?? '');
  }
  return undefined;
}

/** La regla que decide la zona de una ruta (para explicar el inventario). */
export function reglaDe(ruta: string): ReglaZona | undefined {
  return ZONA_POR_ARCHIVO.find((r) => r.patron.test(ruta));
}

export function esCodigo(ruta: string): boolean {
  return ES_CODIGO.test(ruta) && !ruta.includes('/node_modules/') && !/(^|\/)(dist|coverage|\.astro)\//.test(ruta);
}

/** Archivos de código, dentro de las carpetas con zona, que no tienen ninguna. */
export function archivosSinZona(rutas: Iterable<string>): string[] {
  const sin: string[] = [];
  for (const r of rutas) {
    if (!esCodigo(r)) continue;
    if (!CARPETAS_CON_ZONA.some((c) => r.startsWith(`${c}/`))) continue;
    if (zonaDe(r) === undefined) sin.push(r);
  }
  return sin.sort();
}

// ---- Importaciones -------------------------------------------------------------------------------

// Misma expresión que `verificador.ts` (una prueba exige que coincidan).
const IMPORTACION = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"`])((?:(?!\1)[^\n])+)\1/g;

export function importacionesDe(codigo: string): string[] {
  return [...codigo.matchAll(IMPORTACION)].map((m) => m[2] as string);
}

/** Resuelve una importación relativa a un archivo existente del árbol (`.js` → `.ts`/`.tsx`, `index`). */
export function resolverRelativa(archivo: string, imp: string, existe: (ruta: string) => boolean): string | undefined {
  const base = posix.normalize(posix.join(posix.dirname(archivo), imp));
  const candidatos = [
    base,
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    base.replace(/\.mjs$/, '.mts'),
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
  ];
  return candidatos.find(existe);
}

export interface DestinoImportacion {
  readonly zona: Zona;
  /** La importación es relativa (un archivo del repo), no un paquete. */
  readonly relativa: boolean;
}

/**
 * Zona a la que apunta una importación. `undefined` para dependencias externas y para relativas que no
 * resuelven a un archivo con zona (un `.css`, un `.json`…).
 */
export function zonaDeImportacion(archivo: string, imp: string, existe: (ruta: string) => boolean): DestinoImportacion | undefined {
  if (imp.startsWith('.')) {
    const destino = resolverRelativa(archivo, imp, existe);
    const zona = destino === undefined ? undefined : zonaDe(destino);
    return zona === undefined ? undefined : { zona, relativa: true };
  }
  if (imp.startsWith('@tenant/')) return { zona: 'tenant', relativa: false };
  if (imp === '@novutienda/nucleo' || imp.startsWith('@novutienda/nucleo/')) return { zona: 'nucleo', relativa: false };
  if (imp === '@novutienda/panel') return { zona: 'central', relativa: false };
  // `@novutienda/panel/<m>`: la entrada pública de la interfaz de un módulo dentro del panel (`pantallas/<m>/index.ts`).
  const sub = new RegExp(`^@novutienda/panel/(${M})$`).exec(imp);
  if (sub !== null) return { zona: `modulo:${sub[1]}`, relativa: false };
  const m = /^@novutienda\/([^/]+)/.exec(imp);
  if (m !== null) return { zona: `modulo:${m[1]}`, relativa: false };
  return undefined;
}

// ---- Reglas por zona -----------------------------------------------------------------------------

export type Dependencias = Readonly<Record<string, readonly string[]>>;

export interface Cruce {
  readonly archivo: string;
  readonly importacion: string;
  /** Zona declarada del archivo. */
  readonly zona: Zona;
  /** Zona a la que apunta la importación. */
  readonly destino: Zona;
  readonly motivo: string;
}

const esModulo = (z: Zona): boolean => z.startsWith('modulo:');
const esConector = (z: Zona): boolean => z.startsWith('conector:');
const esPruebas = (z: Zona): boolean => z.startsWith('pruebas:');

/**
 * ¿Puede un archivo de `zona` importar algo de `destino`? Tabla del plano §3, con estas aproximaciones
 * (documentadas en docs/arquitectura/zonas.md):
 *  - `coordinador` importa todo; un PAQUETE de módulo (`@novutienda/<m>`) solo desde un compositor
 *    (`COMPOSITORES`); un ARCHIVO de borde de módulo que vive en `plataforma/` (importación relativa)
 *    siempre, porque ese borde existe para que el coordinador lo monte.
 *  - `central` importa núcleo y coordinador; piezas de módulo solo desde un compositor (`ui/app.tsx`).
 *  - `modulo:<m>` importa su módulo, núcleo, Central, el coordinador (puertos y marco), el conector
 *    `firebase` (infraestructura común) y los módulos que su manifiesto declare en `dependeDe`.
 *  - `conector:<n>` importa núcleo, coordinador y las zonas a las que sirve (`SIRVE`).
 *  - `pruebas:<z>` importa lo que importa `z`, más cualquier `pruebas:*` (dobles), `plataforma`,
 *    `coordinador` y conectores; `pruebas:coordinador` y `pruebas:central` importan además módulos.
 *  - `metodo` lee todo el repositorio (sus pruebas contienen árboles inventados con importaciones).
 */
export function permitido(zona: Zona, destino: DestinoImportacion, archivo: string, dependencias: Dependencias): boolean {
  const d = destino.zona;
  if (zona === d) return true;
  if (zona === 'metodo') return true;
  if (d === 'tenant') return false;

  const prueba = esPruebas(zona);
  const base = prueba ? zona.slice('pruebas:'.length) : zona;
  if (prueba) {
    if (esPruebas(d) || d === 'plataforma' || d === 'coordinador' || esConector(d)) return true;
    if (base === d) return true;
  }
  const compone = prueba || COMPOSITORES.some((p) => p.test(archivo));

  if (base === 'nucleo') return d === 'nucleo';
  if (base === 'tenant') return d === 'nucleo';
  if (base === 'plataforma') return d === 'nucleo' || d === 'central' || d === 'coordinador' || d === 'plataforma';
  if (base === 'central') return d === 'nucleo' || d === 'coordinador' || (esModulo(d) && compone);
  if (base === 'coordinador') return !esModulo(d) || compone || destino.relativa;
  if (esConector(base)) {
    if (d === 'nucleo' || d === 'coordinador') return true;
    const sirve = SIRVE[base.slice('conector:'.length)];
    return sirve === '*' ? esModulo(d) || d === 'central' : (sirve ?? []).includes(d);
  }
  if (esModulo(base)) {
    if (d === 'nucleo' || d === 'central' || d === 'coordinador' || d === 'conector:firebase') return true;
    const propio = base.slice('modulo:'.length);
    return esModulo(d) && (dependencias[propio] ?? []).includes(d.slice('modulo:'.length));
  }
  return false;
}

/** Cruces de importación entre zonas en un árbol (ruta → contenido). */
export function crucesDeZona(arbol: Readonly<Record<string, string>>, dependencias: Dependencias = {}): Cruce[] {
  const rutas = new Set(Object.keys(arbol));
  const existe = (r: string): boolean => rutas.has(r);
  const cruces = new Map<string, Cruce>();
  for (const [archivo, codigo] of Object.entries(arbol)) {
    if (!esCodigo(archivo)) continue;
    const zona = zonaDe(archivo);
    if (zona === undefined) continue;
    for (const imp of importacionesDe(codigo)) {
      if (imp.includes('${')) continue; // lo rechaza verificador.ts
      const destino = zonaDeImportacion(archivo, imp, existe);
      if (destino === undefined) continue;
      if (!permitido(zona, destino, archivo, dependencias)) {
        const cruce = { archivo, importacion: imp, zona, destino: destino.zona, motivo: `${zona} no importa ${destino.zona}` };
        cruces.set(claveDeCruce(cruce), cruce); // un cruce por archivo e importación, aunque se repita la línea
      }
    }
  }
  return [...cruces.values()].sort((a, b) => a.archivo.localeCompare(b.archivo) || a.importacion.localeCompare(b.importacion));
}

/** Clave estable de un cruce para compararlo con deuda.json. */
export const claveDeCruce = (c: { readonly archivo: string; readonly importacion: string }): string => `${c.archivo} → ${c.importacion}`;
