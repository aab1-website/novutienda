import { registrarAuditoria, type Actor, type Rol, type TransaccionIdentidad } from '@novutienda/nucleo';
import { anotarCambio, leerEstadoSitio } from './cambios.js';
import { ErrorConsola } from './errores.js';
import { exigirRol, ROLES } from './permisos.js';
import type { BaseDatosConsola, CatalogoPuerto, Reloj } from './puertos.js';
import { ID_PRODUCTO, rutaCarrusel, rutaFicha, rutaMedio, rutaSeccion, rutaSitio, tenantValido } from './rutas.js';
import { mediosDeSeccion, validarSeccion } from './secciones.js';
import { validarFichaWeb } from './fichas.js';
import { validarCarrusel, validarConfigSitio } from './sitio.js';
import { LIMITES_CONSOLA as L } from './limites.js';
import { esObjeto, type Validacion } from './validar.js';

export interface DepsSitio {
  readonly db: BaseDatosConsola;
  readonly catalogo: CatalogoPuerto;
  readonly reloj: Reloj;
}

function exigirValido<T>(v: Validacion<T>): T {
  if (!v.ok) throw new ErrorConsola('entrada-invalida', 'Hay datos inválidos', v.errores);
  return v.valor;
}

const ahoraIso = (d: DepsSitio): string => new Date(d.reloj.ahora()).toISOString();

/** Lee los medios referenciados dentro de la transacción: deben existir y ser del tipo esperado. */
async function leerMedios(
  tx: TransaccionIdentidad, t: string, ids: readonly string[], opciones: { readonly productoId?: string; readonly soloFotos?: boolean },
): Promise<Map<string, 'foto' | 'video'>> {
  const tipos = new Map<string, 'foto' | 'video'>();
  for (const id of new Set(ids)) {
    const m = (await tx.get(rutaMedio(t, id))).data();
    if (m === undefined || (m['tipo'] !== 'foto' && m['tipo'] !== 'video')) throw new ErrorConsola('no-encontrado', `El medio ${id} no existe o aún no está procesado`);
    if (opciones.productoId !== undefined && m['productoId'] !== opciones.productoId) {
      throw new ErrorConsola('conflicto', `El medio ${id} pertenece a otro producto`);
    }
    if (opciones.soloFotos === true && m['tipo'] !== 'foto') throw new ErrorConsola('entrada-invalida', `El medio ${id} debe ser una foto`);
    tipos.set(id, m['tipo']);
  }
  return tipos;
}

function listaDeTexto(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : [];
}

// ---------------------------------------------------------------------------------------------
// Fichas
// ---------------------------------------------------------------------------------------------

export interface EntradaFicha {
  readonly tenantId: string;
  readonly actor: Actor;
  readonly productoId: string;
  readonly ficha: unknown;
}

/**
 * Crea o edita la ficha web de un producto. Roles: sup y adm. Verifica el slug único (índice `sitio/slugs`),
 * que los medios existan y sean del producto, y el tope de 5 fotos y 1 video.
 */
export async function guardarFicha(deps: DepsSitio, e: EntradaFicha): Promise<void> {
  const t = tenantValido(e.tenantId);
  const rol = exigirRol(e.actor, t, ROLES.editarFichas);
  if (!ID_PRODUCTO.test(e.productoId)) throw new ErrorConsola('entrada-invalida', 'productoId inválido');
  const ficha = exigirValido(validarFichaWeb(e.ficha));
  if ((await deps.catalogo.leerProducto(t, e.productoId)) === undefined) throw new ErrorConsola('no-encontrado', 'El producto no existe');
  const ahora = ahoraIso(deps);

  await deps.db.runTransaction(async (tx) => {
    const previa = (await tx.get(rutaFicha(t, e.productoId))).data();
    const mapa = (await tx.get(rutaSitio(t, 'slugs'))).data()?.['mapa'];
    const slugs: Record<string, string> = {};
    if (esObjeto(mapa)) for (const [k, v] of Object.entries(mapa)) if (typeof v === 'string') slugs[k] = v;
    const tipos = await leerMedios(tx, t, ficha.medios.map((m) => m.medioId), { productoId: e.productoId });
    const estado = await leerEstadoSitio(tx, t);

    const dueno = slugs[ficha.slug];
    if (dueno !== undefined && dueno !== e.productoId) throw new ErrorConsola('conflicto', 'Ese slug ya lo usa otro producto');
    const fotos = [...tipos.values()].filter((x) => x === 'foto').length;
    const videos = tipos.size - fotos;
    if (fotos > L.fotosPorProducto || videos > L.videosPorProducto) throw new ErrorConsola('limite', 'Máximo 5 fotos y 1 video por producto');

    const siguiente: Record<string, string> = {};
    for (const [s, p] of Object.entries(slugs)) if (p !== e.productoId) siguiente[s] = p;
    siguiente[ficha.slug] = e.productoId;
    const version = typeof previa?.['version'] === 'number' ? previa['version'] + 1 : 1;
    tx.set(rutaFicha(t, e.productoId), { ...ficha, productoId: e.productoId, version, actualizadaEn: ahora, por: e.actor.uid });
    tx.set(rutaSitio(t, 'slugs'), { mapa: siguiente });
    anotarCambio(tx, t, estado, ahora);
    registrarAuditoria(tx, {
      tenantId: t, uid: e.actor.uid, rol, accion: 'ficha.guardar', ruta: rutaFicha(t, e.productoId),
      resumenDespues: { slug: ficha.slug, estado: ficha.estado, medios: ficha.medios.length },
      ...(typeof previa?.['estado'] === 'string' ? { resumenAntes: { estado: previa['estado'] } } : {}),
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Secciones (hasta 5)
// ---------------------------------------------------------------------------------------------

async function leerIndice(tx: TransaccionIdentidad, t: string): Promise<string[]> {
  return listaDeTexto((await tx.get(rutaSitio(t, 'indice'))).data()?.['secciones']);
}

export async function guardarSeccion(deps: DepsSitio, e: { tenantId: string; actor: Actor; seccion: unknown }): Promise<void> {
  const t = tenantValido(e.tenantId);
  const rol = exigirRol(e.actor, t, ROLES.administrar);
  const s = exigirValido(validarSeccion(e.seccion));
  const ahora = ahoraIso(deps);
  await deps.db.runTransaction(async (tx) => {
    const indice = await leerIndice(tx, t);
    await leerMedios(tx, t, mediosDeSeccion(s), { soloFotos: true });
    const estado = await leerEstadoSitio(tx, t);
    const nueva = !indice.includes(s.id);
    if (nueva && indice.length >= L.seccionesMax) throw new ErrorConsola('limite', `Máximo ${String(L.seccionesMax)} secciones`);
    tx.set(rutaSeccion(t, s.id), { ...s });
    if (nueva) tx.set(rutaSitio(t, 'indice'), { secciones: [...indice, s.id] });
    anotarCambio(tx, t, estado, ahora);
    registrarAuditoria(tx, {
      tenantId: t, uid: e.actor.uid, rol, accion: nueva ? 'seccion.crear' : 'seccion.editar', ruta: rutaSeccion(t, s.id),
      resumenDespues: { bloques: s.bloques.length, visible: s.visible },
    });
  });
}

export async function eliminarSeccion(deps: DepsSitio, e: { tenantId: string; actor: Actor; seccionId: string }): Promise<void> {
  const t = tenantValido(e.tenantId);
  const rol = exigirRol(e.actor, t, ROLES.administrar);
  const ahora = ahoraIso(deps);
  await deps.db.runTransaction(async (tx) => {
    const indice = await leerIndice(tx, t);
    const estado = await leerEstadoSitio(tx, t);
    if (!indice.includes(e.seccionId)) throw new ErrorConsola('no-encontrado', 'La sección no existe');
    tx.delete(rutaSeccion(t, e.seccionId));
    tx.set(rutaSitio(t, 'indice'), { secciones: indice.filter((x) => x !== e.seccionId) });
    anotarCambio(tx, t, estado, ahora);
    registrarAuditoria(tx, { tenantId: t, uid: e.actor.uid, rol, accion: 'seccion.eliminar', ruta: rutaSeccion(t, e.seccionId) });
  });
}

/** Reordena el menú: `orden` debe ser una permutación exacta de las secciones existentes. */
export async function ordenarSecciones(deps: DepsSitio, e: { tenantId: string; actor: Actor; orden: readonly string[] }): Promise<void> {
  const t = tenantValido(e.tenantId);
  const rol = exigirRol(e.actor, t, ROLES.administrar);
  const ahora = ahoraIso(deps);
  await deps.db.runTransaction(async (tx) => {
    const indice = await leerIndice(tx, t);
    const estado = await leerEstadoSitio(tx, t);
    const igual = e.orden.length === indice.length && new Set(e.orden).size === indice.length && e.orden.every((x) => indice.includes(x));
    if (!igual) throw new ErrorConsola('entrada-invalida', 'El orden debe incluir exactamente las secciones existentes');
    tx.set(rutaSitio(t, 'indice'), { secciones: [...e.orden] });
    anotarCambio(tx, t, estado, ahora);
    registrarAuditoria(tx, { tenantId: t, uid: e.actor.uid, rol, accion: 'seccion.ordenar', ruta: rutaSitio(t, 'indice') });
  });
}

// ---------------------------------------------------------------------------------------------
// Carruseles y configuración del sitio
// ---------------------------------------------------------------------------------------------

export async function guardarCarrusel(deps: DepsSitio, e: { tenantId: string; actor: Actor; carrusel: unknown }): Promise<void> {
  const t = tenantValido(e.tenantId);
  const rol = exigirRol(e.actor, t, ROLES.administrar);
  const c = exigirValido(validarCarrusel(e.carrusel));
  const ahora = ahoraIso(deps);
  await deps.db.runTransaction(async (tx) => {
    await leerMedios(tx, t, c.items.map((i) => i.medioId), { soloFotos: true });
    const estado = await leerEstadoSitio(tx, t);
    tx.set(rutaCarrusel(t, c.plantilla), { ...c });
    anotarCambio(tx, t, estado, ahora);
    registrarAuditoria(tx, {
      tenantId: t, uid: e.actor.uid, rol, accion: 'carrusel.guardar', ruta: rutaCarrusel(t, c.plantilla),
      resumenDespues: { items: c.items.length },
    });
  });
}

/** Plantilla activa, número de WhatsApp de NovuChat e identificadores de medición. Solo adm. */
export async function guardarConfigSitio(deps: DepsSitio, e: { tenantId: string; actor: Actor; config: unknown }): Promise<void> {
  const t = tenantValido(e.tenantId);
  const rol: Rol = exigirRol(e.actor, t, ROLES.administrar);
  const c = exigirValido(validarConfigSitio(e.config));
  const ahora = ahoraIso(deps);
  await deps.db.runTransaction(async (tx) => {
    const previa = (await tx.get(rutaSitio(t, 'config'))).data();
    const estado = await leerEstadoSitio(tx, t);
    tx.set(rutaSitio(t, 'config'), { ...c });
    anotarCambio(tx, t, estado, ahora);
    registrarAuditoria(tx, {
      tenantId: t, uid: e.actor.uid, rol, accion: 'sitio.config', ruta: rutaSitio(t, 'config'),
      resumenDespues: { plantillaActiva: c.plantillaActiva },
      ...(typeof previa?.['plantillaActiva'] === 'string' ? { resumenAntes: { plantillaActiva: previa['plantillaActiva'] } } : {}),
    });
  });
}

