// Certificación del sitio desplegado de un tenant: demuestra que lo que sirve el sitio es exactamente lo publicado en la consola.
//
//   node scripts/certificar-sitio.mjs --tenant <t> --url <https://origen> [--resumen <ruta>] [--contenido <ruta>]
//
// Con `--contenido <ruta>` la referencia es el JSON que escribió `contenido-sitio.mjs generar --salida` (el mismo con que se compiló el sitio):
// NO se llama a `/api/sitio/v1/publicado` ni se regenera (evita la falsa alarma si alguien publica entre «generar» y «certificar») y no se
// exigen SITIO_RECONSTRUCCION_SECRETO ni SITIO_NEGOCIO. Archivo ausente o JSON inválido o sin forma de contenido: código 2, sin ruta ni contenido.
// Sin la opción, el comportamiento es el de siempre. La salida y el resumen dicen con qué se comparó («referencia: …»).
//
// Mismo contrato de entorno que `contenido-sitio.mjs generar` (SITIO_RECONSTRUCCION_SECRETO, MEDIOS_BASE_URL, SITIO_NEGOCIO, VITE_*): regenera el
// contenido con el mismo código y lo contrasta con el sitio desplegado. Solo lectura, sin contraseñas de usuario (la firma es la del workflow).
//
// Comprobaciones:
//   1. huella       `/version-contenido.json` contra `versionContenido(contenido)` (esquema, version, publicadoEn, productos, secciones,
//                   huellaSinDisponibilidad). `huella` sola distinta = aviso (la disponibilidad cambió desde el build).
//   2. indice, fichas, portada, secciones: el HTML desplegado pinta lo publicado (índice del buscador, h1, código, props de la isla de precio,
//                   JSON-LD, `data-plantilla`, `cb-config`, secciones 200).
//   3. disponibilidad  `/api/disponibilidad` contra el contenido regenerado y contra las fichas estáticas (avisos, con conteo).
//   4. cotizacion   `/api/cotizacion`: cada mercado del contenido, `vigente` o `ultimo_verificado` (este último, aviso).
//
// Salida: solo conteos y nombres de comprobación (el log de CI es público): nunca ids, nombres, URL, tenant ni valores; un producto se
// nombra por su posición («producto #k»). Códigos de salida:
//   0  coincide (puede haber avisos)
//   1  se compararon cosas y hay diferencias firmes (con diferencias firmes manda 1 aunque otra comprobación no se haya podido leer)
//   2  uso inválido (argumentos, URL, archivo de --contenido, contenido de ejemplo)
//   3  error de operación: no se pudo comparar (falta de secreto, fallo al regenerar el contenido, sitio caído o con 5xx al leer
//      `/version-contenido.json` —se corta sin visitar las fichas—, lectura incompleta, excepción inesperada).
// Un 404 de `/version-contenido.json` NO es de operación: es diferencia firme (el sitio desplegado es anterior al verificador).
// Seguridad: sin redirecciones, 30 s por petición, reintentos y tope de tamaño de `pedirTexto`; los extractores son lineales (sin
// expresiones con retroceso sobre el HTML) y no ejecutan nada del sitio.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  ErrorContenidoSitio,
  cargarDependencias,
  esperarReal,
  generarContenido,
  idsValidos,
  leerDisponibilidad,
  normalizarUrl,
  pedirTexto,
  validarTenant,
  valor,
} from './contenido-sitio.mjs';

export const CONCURRENCIA = 6;
export const MAX_POSICIONES = 10;
const MAX_ETIQUETA = 200_000;
const avisarReal = (mensaje) => console.error(`certificar-sitio: ${mensaje}`);

// ---------------------------------------------------------------------------------------------------------------------------------
// Extractores puros (lineales: se recorre con indexOf y expresiones sin anidar cuantificadores)
// ---------------------------------------------------------------------------------------------------------------------------------

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decodifica las entidades que genera el renderizador (nombradas básicas y numéricas); lo desconocido queda igual. */
export function decodificarEntidades(texto) {
  return String(texto).replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,6});/g, (completo, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : completo;
    }
    return ENTIDADES[e] ?? completo;
  });
}

/** Etiquetas de apertura `<nombre ...>` en orden: [{ atributos, inicio, fin }] (`fin` = posición tras el `>`). Una sola pasada. */
export function etiquetas(html, nombre) {
  const salida = [];
  const minus = html.toLowerCase();
  const patron = `<${nombre.toLowerCase()}`;
  let pos = 0;
  for (;;) {
    const i = minus.indexOf(patron, pos);
    if (i === -1) break;
    const c = minus[i + patron.length];
    if (c !== undefined && c !== ' ' && c !== '>' && c !== '\n' && c !== '\t' && c !== '\r' && c !== '/') {
      pos = i + patron.length;
      continue;
    }
    const j = html.indexOf('>', i);
    if (j === -1) break; // sin más `>` no hay más etiquetas completas
    salida.push({ atributos: html.slice(i + patron.length, j), inicio: i, fin: j + 1 });
    pos = j + 1;
  }
  return salida;
}

/** Atributos de una etiqueta como objeto (valores con entidades decodificadas). Tope de tamaño por etiqueta. */
export function atributos(texto) {
  const entradas = [];
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  const t = texto.length > MAX_ETIQUETA ? texto.slice(0, MAX_ETIQUETA) : texto;
  for (let m = re.exec(t); m !== null; m = re.exec(t)) {
    entradas.push([m[1].toLowerCase(), decodificarEntidades(m[2] ?? m[3] ?? m[4] ?? '')]);
  }
  return Object.fromEntries(entradas);
}

/** Texto plano de un fragmento: sin etiquetas, con entidades decodificadas. */
export function textoPlano(fragmento) {
  const partes = [];
  let pos = 0;
  for (;;) {
    const i = fragmento.indexOf('<', pos);
    if (i === -1) break;
    partes.push(fragmento.slice(pos, i));
    const j = fragmento.indexOf('>', i);
    if (j === -1) { pos = fragmento.length; break; }
    pos = j + 1;
  }
  partes.push(fragmento.slice(pos));
  return decodificarEntidades(partes.join(''));
}

/** Contenido de un elemento que abre en `etiqueta` (resultado de `etiquetas`) y cierra en `</cierre>`; null si no cierra. */
export function interiorDe(html, etiqueta, cierre) {
  const fin = html.toLowerCase().indexOf(`</${cierre}>`, etiqueta.fin);
  return fin === -1 ? null : html.slice(etiqueta.fin, fin);
}

export function primerH1(html) {
  const e = etiquetas(html, 'h1')[0];
  if (e === undefined) return null;
  const dentro = interiorDe(html, e, 'h1');
  return dentro === null ? null : textoPlano(dentro).trim();
}

/** Valor del atributo del primer `<etiqueta>` que lo tenga; null si no hay. */
function atributoDe(html, etiqueta, atributo) {
  for (const e of etiquetas(html, etiqueta)) {
    const a = atributos(e.atributos);
    if (typeof a[atributo] === 'string') return a[atributo];
  }
  return null;
}

/** `<html data-plantilla>`. */
export const plantillaDe = (html) => atributoDe(html, 'html', 'data-plantilla');

/** Contenido textual de los `<script ...>` cuya etiqueta cumple `filtro(atributos)`. */
function scriptsDe(html, filtro) {
  const salida = [];
  const minus = html.toLowerCase();
  for (const e of etiquetas(html, 'script')) {
    if (!filtro(atributos(e.atributos))) continue;
    const fin = minus.indexOf('</script>', e.fin);
    if (fin !== -1) salida.push(html.slice(e.fin, fin));
  }
  return salida;
}

const jsonONulo = (t) => { try { return JSON.parse(t); } catch { return null; } };

/** JSON del `<script id="cb-config">`, o null. */
export function configCliente(html) {
  const t = scriptsDe(html, (a) => a.id === 'cb-config')[0];
  return t === undefined ? null : jsonONulo(t);
}

/** Todos los bloques JSON-LD válidos de la página. */
export function jsonLdDe(html) {
  return scriptsDe(html, (a) => (a.type ?? '').toLowerCase() === 'application/ld+json').map(jsonONulo).filter((x) => x !== null && typeof x === 'object');
}

// Formato de props de Astro (devalue simplificado): cada valor es [tipo, v]; 0 = valor u objeto de pares, 1 = arreglo de pares.
function valorAstro(par, prof = 0) {
  if (!Array.isArray(par) || par.length < 2 || prof > 20) return undefined;
  const [tipo, v] = par;
  if (tipo === 1) return Array.isArray(v) ? v.map((x) => valorAstro(x, prof + 1)) : undefined;
  if (tipo !== 0) return undefined;
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, valorAstro(x, prof + 1)]));
  return v;
}

/** Islas de la página: [{ componente: nombre del archivo del componente, props }]. */
export function islasDe(html) {
  const salida = [];
  for (const e of etiquetas(html, 'astro-island')) {
    const a = atributos(e.atributos);
    const crudo = jsonONulo(a.props ?? '');
    if (crudo === null || typeof crudo !== 'object' || Array.isArray(crudo)) continue;
    const archivo = String(a['component-url'] ?? '').split('/').pop() ?? '';
    salida.push({ componente: archivo.split('.')[0], props: Object.fromEntries(Object.entries(crudo).map(([k, x]) => [k, valorAstro(x)])) });
  }
  return salida;
}

/** Texto del elemento `<p class="ficha-meta">` de la ficha. */
export function metaFicha(html) {
  for (const e of etiquetas(html, 'p')) {
    if ((atributos(e.atributos).class ?? '').split(/\s+/).includes('ficha-meta')) {
      const dentro = interiorDe(html, e, 'p');
      return dentro === null ? null : textoPlano(dentro).trim();
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Comparadores puros: devuelven nombres de campo, nunca valores
// ---------------------------------------------------------------------------------------------------------------------------------

/** JSON con las claves ordenadas, para comparar objetos sin importar el orden. */
export function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined';
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
}
const igual = (a, b) => canon(a) === canon(b);

const CAMPOS_HUELLA = ['esquema', 'version', 'publicadoEn', 'productos', 'secciones', 'huellaSinDisponibilidad'];

/** Compara `version-contenido.json`. Devuelve { errores: [campo], avisos: [campo], motivo? }. */
export function compararVersion(esperada, desplegada) {
  if (desplegada === null || typeof desplegada !== 'object' || Array.isArray(desplegada)) return { errores: ['respuesta'], avisos: [], motivo: 'el sitio no sirvió un JSON de versión' };
  if (desplegada.esquema !== 2) return { errores: ['esquema'], avisos: [], motivo: 'el sitio desplegado es anterior al verificador (esquema de versión distinto de 2)' };
  const errores = CAMPOS_HUELLA.filter((c) => !igual(esperada[c], desplegada[c]));
  const avisos = errores.length === 0 && !igual(esperada.huella, desplegada.huella) ? ['huella'] : [];
  return { errores, avisos };
}

/** Compara el índice del buscador con los productos. Devuelve { campos: { campo: n } }. */
export function compararIndice(productos, indice) {
  const campos = {};
  const suma = (c, n = 1) => { campos[c] = (campos[c] ?? 0) + n; };
  if (!Array.isArray(indice)) return { campos: { formato: 1 } };
  const porId = new Map();
  for (const f of indice) {
    if (f === null || typeof f !== 'object' || typeof f.i !== 'string') { suma('formato'); continue; }
    if (porId.has(f.i)) suma('duplicadas');
    porId.set(f.i, f);
  }
  for (const p of productos) {
    const f = porId.get(p.id);
    if (f === undefined) { suma('faltan'); continue; }
    if (f.ruta !== `/producto/${p.slug}`) suma('ruta');
    if (f.nombre !== p.nombre) suma('nombre');
  }
  const ids = new Set(productos.map((p) => p.id));
  const sobran = [...porId.keys()].filter((i) => !ids.has(i)).length;
  if (sobran > 0) suma('sobran', sobran);
  return { campos };
}

const precioLd = (n) => n.toFixed(2);

/** Compara una ficha pintada con su producto. Devuelve { campos: [campo], disponibleHtml }. */
export function compararFicha(p, config, html) {
  const campos = [];
  const h1 = primerH1(html);
  if (h1 === null || h1 !== p.nombre.trim()) campos.push('h1');
  const meta = metaFicha(html);
  if (meta === null || !meta.endsWith(`Código: ${p.id}`)) campos.push('codigo');
  const islas = islasDe(html);
  const precio = islas.find((i) => i.componente === 'Precio');
  if (precio === undefined) campos.push('isla-precio');
  else {
    if (!igual(precio.props.usd, p.precioUsd)) campos.push('precioUsd');
    if (!igual(precio.props.redondeo, config.redondeo)) campos.push('redondeo');
  }
  const boton = islas.find((i) => i.componente === 'BotonComprar');
  if (boton === undefined || typeof boton.props.disponible !== 'boolean') campos.push('isla-boton');
  const ld = jsonLdDe(html).find((x) => x['@type'] === 'Product');
  if (ld === undefined) campos.push('jsonld');
  else {
    if (ld.name !== p.nombre) campos.push('jsonld.nombre');
    const esperadas = config.mercados.filter((m) => p.precioUsd[m] > 0).map((m) => `${m}:${precioLd(p.precioUsd[m])}`).sort();
    const ofertas = Array.isArray(ld.offers) ? ld.offers : [];
    const vistas = ofertas.map((o) => `${o?.eligibleRegion?.name}:${o?.price}`).sort();
    if (!igual(esperadas, vistas)) campos.push('jsonld.precio');
  }
  return { campos, disponibleHtml: typeof boton?.props.disponible === 'boolean' ? boton.props.disponible : undefined };
}

/** Compara la portada: `data-plantilla` y `cb-config`. Devuelve [campo]. */
export function compararPortada(config, html) {
  const campos = [];
  if (plantillaDe(html) !== config.plantilla) campos.push('plantilla');
  const cb = configCliente(html);
  if (cb === null) return [...campos, 'cb-config'];
  if (cb.whatsappNovuchat !== config.whatsappNovuchat) campos.push('whatsappNovuchat');
  if (!igual(cb.mercados, config.mercados)) campos.push('mercados');
  if (!igual(cb.redondeo, config.redondeo)) campos.push('redondeo');
  return campos;
}

/** Estado de la cotización por mercado: { diferencias: [campo], avisos: [campo] }. */
export function compararCotizacion(mercados, cuerpo) {
  const diferencias = [];
  const avisos = [];
  const cot = cuerpo !== null && typeof cuerpo === 'object' ? cuerpo.cotizaciones : undefined;
  for (const m of mercados) {
    const estado = cot?.[m]?.estado;
    if (estado === 'vigente') continue;
    if (estado === 'ultimo_verificado') avisos.push(`ultimo_verificado.${m}`);
    else diferencias.push(`estado.${m}`);
  }
  return { diferencias, avisos };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Informe: solo conteos y nombres
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * `operacion: true` = la comprobación no pudo leer lo que debía comparar (no es una diferencia del sitio).
 * Comprobación: { nombre, estado: 'ok'|'aviso'|'error', conteos: { clave: n }, diferencias: [{ campo, n, posiciones? }], avisos: [{ campo, n }], motivo? }.
 * `motivo` es siempre una frase fija del verificador, nunca un valor del sitio.
 */
export function comprobacion(nombre) {
  return { nombre, estado: 'ok', conteos: {}, diferencias: [], avisos: [], motivo: undefined, operacion: false };
}

export function cerrar(c) {
  c.estado = c.diferencias.length > 0 || c.motivo !== undefined ? 'error' : c.avisos.length > 0 ? 'aviso' : 'ok';
  return c;
}

/** Suma las diferencias por campo desde una lista [{ posicion?, campos: [campo] }]. */
export function agruparCampos(lista) {
  const porCampo = new Map();
  for (const { posicion, campos } of lista) {
    for (const campo of campos) {
      const g = porCampo.get(campo) ?? { campo, n: 0, posiciones: [] };
      g.n++;
      if (posicion !== undefined) g.posiciones.push(posicion);
      porCampo.set(campo, g);
    }
  }
  return [...porCampo.values()];
}

const posiciones = (g) => (g.posiciones === undefined || g.posiciones.length === 0 ? '' : ` (producto ${g.posiciones.slice(0, MAX_POSICIONES).map((k) => `#${k}`).join(', ')}${g.posiciones.length > MAX_POSICIONES ? ', …' : ''})`);

/** Error firme: hay diferencias, o un motivo que describe al sitio (no a una lectura fallida). */
const esFirme = (c) => c.estado === 'error' && !(c.operacion === true && c.diferencias.length === 0);

/** 0 coincide; 1 diferencias firmes; 3 no se pudo comparar (lectura incompleta sin diferencias firmes). */
export function codigoDe(comprobaciones) {
  if (comprobaciones.some(esFirme)) return 1;
  return comprobaciones.some((c) => c.estado === 'error') ? 3 : 0;
}

export const REF_BUILD = 'referencia: contenido del build';
export const REF_REGENERADO = 'referencia: contenido regenerado desde lo publicado';

export function armarSalida(comprobaciones, referencia = undefined) {
  const lineas = referencia === undefined ? [] : [referencia];
  for (const c of comprobaciones) {
    const conteos = Object.entries(c.conteos).map(([k, n]) => `${k}: ${n}`).join(', ');
    lineas.push(`${c.nombre}: ${c.estado}${conteos === '' ? '' : ` (${conteos})`}`);
    if (c.motivo !== undefined) lineas.push(`  motivo: ${c.motivo}`);
    for (const d of c.diferencias) lineas.push(`  diferencias: ${d.n} en ${c.nombre}.${d.campo}${posiciones(d)}`);
    for (const a of c.avisos) lineas.push(`  aviso: ${a.n === undefined ? '' : `${a.n} en `}${c.nombre}.${a.campo}${posiciones(a)}`);
  }
  const errores = comprobaciones.filter((c) => c.estado === 'error').length;
  const avisos = comprobaciones.filter((c) => c.estado === 'aviso').length;
  const codigo = codigoDe(comprobaciones);
  lineas.push(codigo === 3 ? `certificación: NO CONCLUYENTE (${errores} comprobaciones sin poder leerse, ${avisos} con avisos)` : errores > 0 ? `certificación: FALLÓ (${errores} comprobaciones con diferencias, ${avisos} con avisos)` : `certificación: correcta (${avisos} comprobaciones con avisos)`);
  return lineas.join('\n');
}

// Celda de tabla Markdown: se escapan primero las barras invertidas y luego las barras verticales.
const celda = (t) => String(t).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

export function armarResumen(comprobaciones, referencia = undefined) {
  const filas = comprobaciones.map((c) => {
    const detalle = [
      ...Object.entries(c.conteos).map(([k, n]) => `${k}: ${n}`),
      ...(c.motivo === undefined ? [] : [c.motivo]),
      ...c.diferencias.map((d) => `diferencias: ${d.n} en ${c.nombre}.${d.campo}${posiciones(d)}`),
      ...c.avisos.map((a) => `aviso: ${a.n === undefined ? '' : `${a.n} en `}${c.nombre}.${a.campo}`),
    ].join('; ');
    return `| ${c.nombre} | ${c.estado} | ${celda(detalle)} |`;
  });
  const cod = codigoDe(comprobaciones);
  const total = cod === 0 ? 'correcta' : cod === 3 ? 'NO CONCLUYENTE' : 'FALLÓ';
  return `## Certificación del sitio: ${total}\n\n${referencia === undefined ? '' : `${referencia}\n\n`}| Comprobación | Resultado | Conteos |\n|---|---|---|\n${filas.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Ejecución contra el sitio
// ---------------------------------------------------------------------------------------------------------------------------------

/** Ejecuta `tarea(x, i)` para cada elemento con a lo más `n` en vuelo; conserva el orden. */
export async function conConcurrencia(lista, n, tarea) {
  const salida = new Array(lista.length);
  let siguiente = 0;
  const trabajador = async () => {
    for (;;) {
      const i = siguiente++;
      if (i >= lista.length) return;
      salida[i] = await tarea(lista[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, lista.length)) }, trabajador));
  return salida;
}

/** Contrasta el contenido regenerado con el sitio desplegado. Devuelve la lista de comprobaciones. */
export async function certificar({ url, contenido, versionContenido, fetchFn = fetch, esperar = esperarReal, avisar = avisarReal }) {
  const config = contenido.config;
  const productos = contenido.productos;
  const secciones = contenido.secciones;
  const red = { url, fetchFn, esperar, avisar };
  // Una ruta inalcanzable no detiene la certificación: se informa como estado 0.
  const obtener = async (ruta) => {
    try {
      return await pedirTexto({ ...red, ruta });
    } catch {
      return { estado: 0, texto: '' };
    }
  };
  const noLeido = (r) => r.estado === 0 || r.estado >= 500;
  const json = (r) => (r.estado === 200 ? jsonONulo(r.texto) : null);
  const resultado = [];

  // 1. Huella.
  {
    const c = comprobacion('huella');
    const r = await obtener('/version-contenido.json');
    // Sitio caído: no se puede comparar nada; se corta sin visitar las fichas.
    if (noLeido(r)) throw new ErrorContenidoSitio('el sitio no respondió al leer la versión del contenido (error de red o 5xx)', 3);
    if (r.estado === 404) { c.motivo = 'el sitio desplegado es anterior al verificador (no sirve la versión del contenido)'; }
    else if (r.estado !== 200) { c.motivo = 'no se pudo leer la versión del contenido del sitio'; }
    else {
      const cmp = compararVersion(versionContenido(contenido), jsonONulo(r.texto));
      if (cmp.motivo !== undefined) c.motivo = cmp.motivo;
      c.diferencias = cmp.errores.map((campo) => ({ campo, n: 1 }));
      c.avisos = cmp.avisos.map((campo) => ({ campo: campo === 'huella' ? 'disponibilidad-cambio-desde-el-build' : campo }));
    }
    resultado.push(cerrar(c));
  }

  // 2a. Índice del buscador.
  {
    const c = comprobacion('indice');
    const r = await obtener('/indice-productos.json');
    if (r.estado !== 200) { c.motivo = 'no se pudo leer el índice de productos del sitio'; c.operacion = noLeido(r); }
    else {
      c.conteos['fichas esperadas'] = productos.length;
      c.diferencias = Object.entries(compararIndice(productos, jsonONulo(r.texto)).campos).map(([campo, n]) => ({ campo, n }));
    }
    resultado.push(cerrar(c));
  }

  // 2b. Fichas.
  const fichas = await conConcurrencia(productos, CONCURRENCIA, async (p) => {
    const r = await obtener(`/producto/${encodeURIComponent(p.slug)}`);
    if (r.estado !== 200) return { campos: ['estado'], disponibleHtml: undefined };
    return compararFicha(p, config, r.texto);
  });
  {
    const c = comprobacion('fichas');
    c.conteos['fichas verificadas'] = productos.length;
    c.diferencias = agruparCampos(fichas.map((f, i) => ({ posicion: i + 1, campos: f.campos })));
    c.conteos['fichas con diferencias'] = fichas.filter((f) => f.campos.length > 0).length;
    if (productos.length === 0) c.avisos.push({ campo: '0 fichas' });
    resultado.push(cerrar(c));
  }

  // 2c. Portada.
  {
    const c = comprobacion('portada');
    const r = await obtener('/');
    if (r.estado !== 200) c.diferencias = [{ campo: 'estado', n: 1 }];
    else c.diferencias = compararPortada(config, r.texto).map((campo) => ({ campo, n: 1 }));
    resultado.push(cerrar(c));
  }

  // 2d. Secciones.
  {
    const c = comprobacion('secciones');
    const estados = await conConcurrencia(secciones, CONCURRENCIA, async (s) => (await obtener(`/seccion/${encodeURIComponent(s.slug)}`)).estado);
    c.conteos['secciones verificadas'] = secciones.length;
    const malas = estados.filter((e) => e !== 200).length;
    if (malas > 0) c.diferencias = [{ campo: 'estado', n: malas }];
    resultado.push(cerrar(c));
  }

  // 3. Disponibilidad viva.
  {
    const c = comprobacion('disponibilidad');
    let viva = null;
    try {
      viva = await leerDisponibilidad({ url, ids: idsValidos(productos.map((p) => p.id)), fetchFn, esperar, avisar });
    } catch {
      c.motivo = 'no se pudo leer la disponibilidad viva del sitio';
      c.operacion = true;
    }
    if (viva !== null) {
      // Un id que la respuesta viva no trae (o sin mapa) NO es «agotado»: es una diferencia firme aparte.
      const traido = (p) => Object.hasOwn(viva, p.id);
      const ausentes = productos.filter((p) => !traido(p)).length;
      if (ausentes > 0) c.diferencias.push({ campo: 'ids-ausentes', n: ausentes });
      const vivaDe = (p) => viva[p.id] === true;
      const coherencia = productos.filter((p) => traido(p) && p.disponible !== vivaDe(p)).length;
      const estaticas = productos.filter((p, i) => traido(p) && fichas[i].disponibleHtml !== undefined && fichas[i].disponibleHtml !== vivaDe(p)).length;
      c.conteos['fichas con disponibilidad distinta de la viva'] = estaticas;
      if (coherencia > 0) c.avisos.push({ campo: 'contenido-regenerado-vs-viva', n: coherencia });
      if (estaticas > 0) c.avisos.push({ campo: 'html-estatico-vs-viva', n: estaticas });
    }
    resultado.push(cerrar(c));
  }

  // 4. Cotización.
  {
    const c = comprobacion('cotizacion');
    const r = await obtener('/api/cotizacion');
    if (r.estado !== 200) { c.motivo = 'la API de cotización del sitio no respondió 200'; c.operacion = noLeido(r); }
    else {
      const cmp = compararCotizacion(config.mercados, json(r));
      c.conteos['mercados verificados'] = config.mercados.length;
      c.diferencias = agruparCampos([{ campos: cmp.diferencias }]);
      c.avisos = agruparCampos([{ campos: cmp.avisos }]).map(({ campo, n }) => ({ campo, n }));
    }
    resultado.push(cerrar(c));
  }
  return resultado;
}

/** Lee el `Contenido` que escribió `generar`; uso inválido (2) si falta, no es JSON o no tiene la forma mínima. No revela ruta ni contenido. */
export function leerContenidoDelBuild(ruta) {
  if (ruta === '') throw new ErrorContenidoSitio('--contenido: falta la ruta del archivo', 2);
  let texto;
  try {
    texto = readFileSync(ruta, 'utf8');
  } catch {
    throw new ErrorContenidoSitio('--contenido: no se pudo leer el archivo de contenido', 2);
  }
  const c = jsonONulo(texto);
  const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  if (!esObjeto(c) || !esObjeto(c.config) || !Array.isArray(c.productos) || !Array.isArray(c.secciones) || !Array.isArray(c.config.mercados)) {
    throw new ErrorContenidoSitio('--contenido: el archivo no es un JSON de contenido válido (se esperaba config, productos y secciones)', 2);
  }
  if (c.config.esEjemplo === true) throw new ErrorContenidoSitio('--contenido: es el contenido de ejemplo; no se certifica', 2);
  return c;
}

/** Punto de entrada: devuelve { codigo, salida?, error? }; las dependencias se pueden inyectar en pruebas. */
export async function ejecutar(args, env = process.env, deps = undefined, fetchFn = fetch, red = {}) {
  const { esperar = esperarReal, avisar = avisarReal } = red;
  try {
    const tenantCrudo = valor(args, 'tenant');
    if (tenantCrudo === undefined) throw new ErrorContenidoSitio('uso: certificar-sitio.mjs --tenant <t> --url <https://origen> [--resumen <ruta>] [--contenido <ruta>]', 2);
    let tenant;
    try {
      tenant = validarTenant(tenantCrudo);
    } catch (e) {
      throw new ErrorContenidoSitio(e instanceof Error ? e.message : '--tenant inválido', 2);
    }
    let url;
    try {
      url = normalizarUrl(valor(args, 'url'), env.NODE_ENV === 'test');
    } catch (e) {
      throw new ErrorContenidoSitio(e instanceof Error ? e.message : '--url inválida', 2);
    }
    for (const opcion of ['resumen', 'contenido']) {
      if (args.includes(`--${opcion}`) && valor(args, opcion) === undefined) throw new ErrorContenidoSitio(`--${opcion} requiere un valor`, 2);
    }
    const rutaResumen = valor(args, 'resumen') ?? (env.GITHUB_STEP_SUMMARY === undefined || env.GITHUB_STEP_SUMMARY === '' ? undefined : env.GITHUB_STEP_SUMMARY);
    const rutaContenido = valor(args, 'contenido');
    const d = deps ?? (await cargarDependencias());
    if (typeof d.versionContenido !== 'function') throw new ErrorContenidoSitio('plataforma/registro.ts no exporta versionContenido');
    let contenido;
    let referencia;
    if (rutaContenido !== undefined) {
      contenido = leerContenidoDelBuild(rutaContenido);
      referencia = REF_BUILD;
    } else {
      const secreto = env.SITIO_RECONSTRUCCION_SECRETO ?? '';
      if (secreto === '') throw new ErrorContenidoSitio('falta SITIO_RECONSTRUCCION_SECRETO');
      ({ contenido } = await generarContenido({ tenant, url, secreto, env, calcularFirma: d.calcularFirma, mapear: d.mapear, fetchFn, esperar, avisar }));
      referencia = REF_REGENERADO;
    }
    const comprobaciones = await certificar({ url, contenido, versionContenido: d.versionContenido, fetchFn, esperar, avisar });
    if (rutaResumen !== undefined) {
      const md = armarResumen(comprobaciones, referencia);
      // Permisos 0600: el resumen puede vivir en un directorio temporal compartido del corredor.
      if (valor(args, 'resumen') !== undefined) writeFileSync(rutaResumen, md, { mode: 0o600 });
      else appendFileSync(rutaResumen, md, { mode: 0o600 });
    }
    const codigo = codigoDe(comprobaciones);
    const error = codigo === 1 ? 'el sitio desplegado no corresponde a lo publicado' : 'no se pudo comparar todo el sitio desplegado';
    return { codigo, salida: armarSalida(comprobaciones, referencia), ...(codigo === 0 ? {} : { error }) };
  } catch (e) {
    // El código 1 por defecto de ErrorContenidoSitio es un fallo de operación (3); 2 se conserva.
    if (e instanceof ErrorContenidoSitio) return { codigo: e.codigo === 2 ? 2 : 3, error: e.message };
    const nombre = typeof e?.name === 'string' ? e.name : 'Error';
    const codigo = typeof e?.code === 'string' ? ` ${e.code}` : '';
    return { codigo: 3, error: `error inesperado (${nombre}${codigo})` };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = await ejecutar(process.argv.slice(2));
  if (r.salida !== undefined) console.log(r.salida);
  if (r.error !== undefined) console.error(`certificar-sitio: ${r.error}`);
  process.exit(r.codigo);
}
