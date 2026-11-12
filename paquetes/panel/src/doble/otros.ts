import type { Entrada, NombreCallable, Salida } from '../api/contrato.js';
import type { Medio, Recibo } from '../api/tipos.js';
import { LIMITES_PANEL, PLANTILLAS_SITIO } from '../api/tipos.js';
import { normalizar } from '../util/buscar.js';
import { aCsv } from '../util/csv.js';
import { auditar, exigirRol, fallo, iso, vistaProducto, type Contexto } from './estado.js';

type H<N extends NombreCallable> = (c: Contexto, e: Entrada<N>) => Salida<N> | Promise<Salida<N>>;

const FACTURA = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function recibo(c: Contexto, id: string): Recibo {
  const r = c.e.recibos.get(id);
  if (r === undefined) throw fallo('recibo-no-encontrado', 'Comprobante inexistente');
  return r;
}

function anotarCambio(c: Contexto): void {
  c.e.cambiosSinPublicar += 1;
  c.e.ultimoCambioEn = iso(c.ahora);
}

/** Procesa una subida reservada (lo hace el disparador simulado o el respaldo `finalizarSubida`). */
function procesarSubida(c: Contexto, subidaId: string): Medio {
  const s = c.e.subidas.get(subidaId);
  if (s === undefined) throw fallo('no-encontrado', 'La subida no existe');
  const m: Medio = { id: subidaId, productoId: s.productoId, tipo: s.tipo, bytesOriginal: s.bytes, ancho: 1200, alto: 800, ...(s.tipo === 'video' ? { duracionSeg: 30 } : {}), creadoEn: c.ahora, por: c.uid };
  c.e.medios.set(m.id, m);
  c.e.subidas.set(subidaId, { ...s, estado: 'procesada' });
  anotarCambio(c);
  auditar(c, 'medio.subir', `medios/${m.id}`);
  return m;
}

export const handlersOtros: {
  [N in 'buscarComprobantes' | 'enviarRecibo' | 'referenciarFacturaSuma' | 'guardarPlantilla' | 'leerPlantilla' | 'obtenerRecibo' | 'obtenerTablero' | 'publicarSitio' | 'cambiarPrecioUSD' | 'guardarFicha' | 'reservarSubida' | 'estadoSubida' | 'finalizarSubida' | 'borrarMedio' | 'guardarSeccion' | 'eliminarSeccion' | 'ordenarSecciones' | 'guardarCarrusel' | 'guardarConfigSitio' | 'exportarProductosCsvSitio' | 'asignarRol' | 'quitarRol' | 'buscarUsuarioPorCorreo' | 'listarFichas' | 'listarMedios' | 'leerConfigSitio' | 'listarSecciones' | 'listarCarruseles' | 'listarUsuarios' | 'modulosActivos']: H<N>;
} = {
  buscarComprobantes(c, e) {
    const q = e.consulta;
    for (const f of [q.desde, q.hasta]) if (f !== undefined && !FECHA.test(f)) throw fallo('entrada-invalida', 'Las fechas deben tener la forma aaaa-mm-dd');
    const limite = q.limite ?? 50;
    if (!Number.isInteger(limite) || limite < 1 || limite > 200) throw fallo('entrada-invalida', 'limite entre 1 y 200');
    const propias = c.rol === 'caj' ? new Set([...c.e.ventas.values()].filter((v) => v.cajeroUid === c.uid).map((v) => v.ventaId)) : undefined;
    return [...c.e.recibos.values()]
      .filter((r) => propias === undefined || propias.has(r.ventaId))
      .filter((r) => q.numero === undefined || normalizar(r.numero).includes(normalizar(q.numero)))
      .filter((r) => q.desde === undefined || r.fecha >= q.desde)
      .filter((r) => q.hasta === undefined || r.fecha <= q.hasta)
      .filter((r) => q.cliente === undefined || (r.cliente !== undefined && normalizar(r.cliente.nombre).includes(normalizar(q.cliente))))
      .sort((a, b) => b.emitidoEn.localeCompare(a.emitidoEn) || b.numero.localeCompare(a.numero))
      .slice(0, limite);
  },
  enviarRecibo(c, e) {
    const r = recibo(c, e.reciboId);
    if (r.estado === 'ANULADO') throw fallo('accion-no-permitida', 'No se envía un comprobante anulado');
    const tel = r.cliente?.telefono;
    let res: Salida<'enviarRecibo'>;
    if (tel === undefined) res = { estado: 'sin_telefono' };
    else {
      // El servidor genera el PDF y firma su enlace; aquí basta un enlace de ejemplo.
      const enlacePdf = `https://recibos.ejemplo.test/${r.reciboId}.pdf`;
      const d = tel.replace(/\D/g, '');
      const num = d.length <= 8 ? `${e.codigoPais ?? '591'}${d}` : d;
      res = { estado: 'enlace_generado', enlace: `https://wa.me/${num}?text=${encodeURIComponent(`Su recibo N.º ${r.numero}: ${enlacePdf}`)}` };
    }
    c.e.recibos.set(r.reciboId, { ...r, envioWhatsapp: { estado: res.estado, actualizadoEn: iso(c.ahora) } });
    auditar(c, 'recibos.enviar', `recibos/${r.reciboId}`);
    return res;
  },
  referenciarFacturaSuma(c, e) {
    const r = recibo(c, e.reciboId);
    if (!FACTURA.test(e.facturaSuma)) throw fallo('entrada-invalida', 'facturaSuma inválida (hasta 40 caracteres: letras, números y . _ / - espacio)');
    if (r.estado === 'ANULADO') throw fallo('accion-no-permitida', 'El comprobante está anulado');
    c.e.recibos.set(r.reciboId, { ...r, facturaSuma: e.facturaSuma });
    auditar(c, 'recibos.factura-suma', `recibos/${r.reciboId}`);
    return { ok: true };
  },
  guardarPlantilla(c, e) {
    if (e.plantilla.negocio.nombre.trim() === '') throw fallo('plantilla-invalida', 'El nombre del negocio es obligatorio');
    if (e.plantilla.logoUrl !== undefined && !/^https:\/\/\S+$/.test(e.plantilla.logoUrl)) throw fallo('plantilla-invalida', 'El logo debe ser una URL https');
    c.e.plantilla = e.plantilla;
    auditar(c, 'recibos.plantilla.guardar', 'plantillas_recibo/main');
    return { ok: true };
  },
  leerPlantilla: (c) => c.e.plantilla,
  obtenerRecibo: (c, e) => c.e.recibos.get(`recibo-${e.ventaId}`) ?? null,

  obtenerTablero(c) {
    const cot = (['BO', 'AR'] as const).map((m) => {
      const x = c.e.cotizaciones[m];
      return x === null ? { mercado: m, estado: 'sin_cotizacion' as const, motivo: 'No hay una cotización utilizable' } : { mercado: m, estado: x.estado, par: x.par, valor: x.valor, fecha: x.fecha, fuente: x.fuente };
    });
    return {
      cambiosSinPublicar: c.e.cambiosSinPublicar, ultimoCambioEn: c.e.ultimoCambioEn, publicadoEn: c.e.publicadoEn, versionPublicada: c.e.versionPublicada, cotizaciones: cot,
      uso: {
        productos: { usados: c.e.productos.size, tope: LIMITES_PANEL.productos }, usuarios: { usados: c.e.usuarios.length, tope: LIMITES_PANEL.usuarios },
        originalesBytes: { usados: c.e.bytesOriginales, tope: LIMITES_PANEL.cuotaOriginalesBytes },
      },
    };
  },
  publicarSitio(c) {
    if (c.e.configSitio === null) throw fallo('estado', 'Configure el sitio (plantilla y WhatsApp) antes de publicar');
    c.e.versionPublicada += 1;
    c.e.cambiosSinPublicar = 0;
    c.e.publicadoEn = iso(c.ahora);
    auditar(c, 'sitio.publicar', 'publicado/estado');
    return { version: c.e.versionPublicada, productos: [...c.e.productos.values()].filter((p) => p.activo).length, decision: { accion: 'programar', para: c.ahora + 600_000 }, advertencias: [] };
  },
  cambiarPrecioUSD(c, e) {
    const p = c.e.productos.get(e.productoId);
    if (p === undefined) throw fallo('no-encontrado', 'El producto no existe');
    for (const v of [e.precioUSD.bo, e.precioUSD.ar]) {
      if (!Number.isSafeInteger(v) || v < 0 || v > 999_999_900) throw fallo('entrada-invalida', 'Precio: centavos enteros de 0 a 9 999 999');
    }
    p.precioUSD = { bo: e.precioUSD.bo, ar: e.precioUSD.ar };
    anotarCambio(c);
    auditar(c, 'producto.precio', `productos/${p.id}`);
    return { ok: true };
  },
  guardarFicha(c, e) {
    if (!c.e.productos.has(e.productoId)) throw fallo('no-encontrado', 'El producto no existe');
    const f = e.ficha;
    if (!SLUG.test(f.slug) || f.slug.length < 2) throw fallo('entrada-invalida', 'slug: use minúsculas, números y guiones');
    if (f.estado === 'publicado' && f.descripcion.trim() === '') throw fallo('entrada-invalida', 'descripcion: es obligatoria para publicar');
    for (const [otro, x] of c.e.fichas) if (otro !== e.productoId && x.slug === f.slug) throw fallo('conflicto', 'Ese slug ya lo usa otro producto');
    const tipos = f.medios.map((m) => c.e.medios.get(m.medioId));
    if (tipos.some((m) => m === undefined || m.productoId !== e.productoId)) throw fallo('no-encontrado', 'Un medio de la ficha no existe');
    if (f.medios.some((m) => m.alt.trim() === '')) throw fallo('entrada-invalida', 'Todo medio lleva texto alternativo');
    if (tipos.filter((m) => m?.tipo === 'foto').length > LIMITES_PANEL.fotosPorProducto) throw fallo('limite', 'Máximo 5 fotos');
    if (tipos.filter((m) => m?.tipo === 'video').length > LIMITES_PANEL.videosPorProducto) throw fallo('limite', 'Máximo 1 video');
    c.e.fichas.set(e.productoId, f);
    anotarCambio(c);
    auditar(c, 'ficha.guardar', `fichasWeb/${e.productoId}`);
    return { ok: true };
  },
  reservarSubida(c, e) {
    if (!c.e.productos.has(e.productoId)) throw fallo('no-encontrado', 'El producto no existe');
    const previa = c.e.subidas.get(e.subidaId);
    if (previa !== undefined) {
      if (previa.productoId === e.productoId && previa.tipo === e.tipo && previa.bytes === e.bytes && previa.estado === 'reservada') {
        return { subidaId: e.subidaId, rutaOriginal: `privado/${e.productoId}/${e.subidaId}`, venceEn: c.ahora + 6 * 3600_000 };
      }
      throw fallo('conflicto', 'Ya existe una subida con ese identificador');
    }
    if (!Number.isSafeInteger(e.bytes) || e.bytes <= 0) throw fallo('entrada-invalida', 'Tamaño inválido');
    if (e.tipo === 'foto' && e.bytes > LIMITES_PANEL.bytesFoto) throw fallo('limite', 'La foto supera 15 MB');
    if (e.tipo === 'video' && e.bytes > LIMITES_PANEL.bytesVideo) throw fallo('limite', 'El video supera 200 MB');
    const delProducto = [...c.e.medios.values()].filter((m) => m.productoId === e.productoId && m.tipo === e.tipo).length
      + [...c.e.subidas.values()].filter((s) => s.productoId === e.productoId && s.tipo === e.tipo && s.estado === 'reservada').length;
    if (delProducto >= (e.tipo === 'foto' ? LIMITES_PANEL.fotosPorProducto : LIMITES_PANEL.videosPorProducto)) {
      throw fallo('limite', e.tipo === 'foto' ? 'Máximo 5 fotos por producto' : 'Máximo 1 video por producto');
    }
    if (c.e.bytesOriginales + e.bytes > LIMITES_PANEL.cuotaOriginalesBytes) throw fallo('cuota-excedida');
    c.e.subidas.set(e.subidaId, { subidaId: e.subidaId, productoId: e.productoId, tipo: e.tipo, estado: 'reservada', bytes: e.bytes });
    c.e.bytesOriginales += e.bytes;
    return { subidaId: e.subidaId, rutaOriginal: `privado/${e.productoId}/${e.subidaId}`, venceEn: c.ahora + 6 * 3600_000 };
  },
  estadoSubida(c, e) {
    const s = c.e.subidas.get(e.subidaId);
    if (s === undefined) throw fallo('no-encontrado', 'La subida no existe');
    if (s.estado === 'reservada') {
      // Disparador de Storage simulado: resuelve la subida unos milisegundos después de la primera consulta.
      const desde = s.consultadaDesde ?? Date.now();
      c.e.subidas.set(e.subidaId, { ...s, consultadaDesde: desde });
      if (Date.now() - desde >= c.e.disparador.demoraMs) {
        const rechazo = c.e.disparador.rechazo;
        if (rechazo === undefined) procesarSubida(c, e.subidaId);
        else {
          c.e.subidas.set(e.subidaId, { ...s, consultadaDesde: desde, estado: 'rechazada', motivo: rechazo });
          c.e.bytesOriginales = Math.max(0, c.e.bytesOriginales - s.bytes);
        }
      }
    }
    const actual = c.e.subidas.get(e.subidaId) as NonNullable<ReturnType<typeof c.e.subidas.get>>;
    const medio = actual.estado === 'procesada' ? c.e.medios.get(e.subidaId) : undefined;
    return { estado: actual.estado, ...(medio !== undefined ? { medio } : {}), ...(actual.motivo !== undefined ? { motivo: actual.motivo } : {}) };
  },
  finalizarSubida(c, e) {
    const s = c.e.subidas.get(e.subidaId);
    if (s === undefined) throw fallo('no-encontrado', 'La subida no existe');
    const previo = c.e.medios.get(e.subidaId);
    if (s.estado === 'procesada' && previo !== undefined) return previo;
    if (s.estado !== 'reservada') throw fallo('estado', 'La subida ya no está pendiente');
    return procesarSubida(c, e.subidaId);
  },
  borrarMedio(c, e) {
    const m = c.e.medios.get(e.medioId);
    if (m === undefined) throw fallo('no-encontrado', 'El medio no existe');
    const enSeccion = c.e.secciones.find((s) => s.bloques.some((b) => (b.tipo === 'imagen' && b.medioId === e.medioId) || (b.tipo === 'carrusel' && b.items.some((i) => i.medioId === e.medioId))));
    if (enSeccion !== undefined) throw fallo('conflicto', `El medio se usa en la sección «${enSeccion.titulo}»; quítelo primero`);
    c.e.medios.delete(e.medioId);
    c.e.bytesOriginales = Math.max(0, c.e.bytesOriginales - m.bytesOriginal);
    const f = c.e.fichas.get(m.productoId);
    if (f !== undefined) c.e.fichas.set(m.productoId, { ...f, medios: f.medios.filter((x) => x.medioId !== e.medioId) });
    anotarCambio(c);
    auditar(c, 'medio.borrar', `medios/${e.medioId}`);
    return { ok: true };
  },
  guardarSeccion(c, e) {
    const s = e.seccion;
    if (s.titulo.trim() === '' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(s.id)) throw fallo('entrada-invalida', 'Sección inválida');
    if (s.bloques.length < 1 || s.bloques.length > 10) throw fallo('entrada-invalida', 'La sección lleva entre 1 y 10 bloques');
    const i = c.e.secciones.findIndex((x) => x.id === s.id);
    if (i < 0 && c.e.secciones.length >= LIMITES_PANEL.seccionesMax) throw fallo('limite', 'Máximo 5 secciones');
    for (const b of s.bloques) {
      if (b.tipo === 'enlaces') for (const it of b.items) if (!/^(https:\/\/|\/)/.test(it.url) || /^\/\//.test(it.url)) throw fallo('entrada-invalida', 'Enlace no permitido (solo https o rutas del sitio)');
    }
    if (i < 0) c.e.secciones.push(s);
    else c.e.secciones[i] = s;
    anotarCambio(c);
    auditar(c, 'seccion.guardar', `secciones/${s.id}`);
    return { ok: true };
  },
  eliminarSeccion(c, e) {
    const i = c.e.secciones.findIndex((x) => x.id === e.seccionId);
    if (i < 0) throw fallo('no-encontrado', 'La sección no existe');
    c.e.secciones.splice(i, 1);
    anotarCambio(c);
    auditar(c, 'seccion.eliminar', `secciones/${e.seccionId}`);
    return { ok: true };
  },
  ordenarSecciones(c, e) {
    const ids = c.e.secciones.map((s) => s.id);
    if (e.orden.length !== ids.length || new Set(e.orden).size !== ids.length || !e.orden.every((x) => ids.includes(x))) throw fallo('entrada-invalida', 'El orden debe incluir exactamente las secciones existentes');
    c.e.secciones = e.orden.map((id) => c.e.secciones.find((s) => s.id === id)).filter((s) => s !== undefined);
    anotarCambio(c);
    return { ok: true };
  },
  guardarCarrusel(c, e) {
    if (!PLANTILLAS_SITIO.includes(e.carrusel.plantilla)) throw fallo('entrada-invalida', 'Plantilla inválida');
    if (e.carrusel.items.length > 8) throw fallo('entrada-invalida', 'Hasta 8 fotos');
    for (const it of e.carrusel.items) if (c.e.medios.get(it.medioId)?.tipo !== 'foto') throw fallo('no-encontrado', 'Un medio del carrusel no existe');
    c.e.carruseles.set(e.carrusel.plantilla, e.carrusel);
    anotarCambio(c);
    return { ok: true };
  },
  guardarConfigSitio(c, e) {
    if (!PLANTILLAS_SITIO.includes(e.config.plantillaActiva)) throw fallo('entrada-invalida', 'Plantilla inválida');
    if (!/^[1-9]\d{7,14}$/.test(e.config.whatsappNovuchat)) throw fallo('entrada-invalida', 'whatsappNovuchat: solo dígitos, con código de país (8 a 15 dígitos)');
    const m = e.config.medicion;
    if (m.ga4 !== undefined && !/^G-[A-Z0-9]{4,12}$/.test(m.ga4)) throw fallo('entrada-invalida', 'ga4: formato G-XXXXXXXX');
    if (m.metaPixel !== undefined && !/^\d{8,20}$/.test(m.metaPixel)) throw fallo('entrada-invalida', 'metaPixel: solo dígitos');
    c.e.configSitio = e.config;
    anotarCambio(c);
    auditar(c, 'sitio.config', 'sitio/config');
    return { ok: true };
  },
  exportarProductosCsvSitio(c) {
    const filas = [...c.e.productos.values()].map((p) => [p.id, p.nombre, p.categoria, p.marca ?? '', p.sku, p.activo ? 'si' : 'no', p.garantiaMeses ?? '', p.precioUSD.bo / 100, p.precioUSD.ar / 100]);
    return { csv: aCsv(['id', 'nombre', 'categoria', 'marca', 'sku', 'activo', 'garantiaMeses', 'precioBO', 'precioAR'], filas) };
  },
  asignarRol(c, e) {
    if (e.rol === 'adm') throw fallo('jerarquia');
    const u = c.e.usuarios.find((x) => x.uid === e.uid);
    if (u === undefined) {
      // Alta: la cuenta ya existe en Auth (el panel no la crea); exige correo verificado y cupo en el plan.
      const i = c.e.cuentasSinRol.findIndex((x) => x.uid === e.uid);
      const cuenta = c.e.cuentasSinRol[i];
      if (cuenta === undefined) throw fallo('no-miembro');
      if (!cuenta.verificado) throw fallo('correo-no-verificado');
      if (c.e.usuarios.length >= LIMITES_PANEL.usuarios) throw fallo('limite', 'Máximo 3 usuarios');
      c.e.cuentasSinRol.splice(i, 1);
      c.e.usuarios.push({ ...cuenta, rol: e.rol });
      auditar(c, 'identidad.asignar-rol', `usuarios/${e.uid}`);
      return { ok: true };
    }
    if (u.rol === 'adm') throw fallo('jerarquia');
    u.rol = e.rol;
    auditar(c, 'identidad.asignar-rol', `usuarios/${e.uid}`);
    return { ok: true };
  },
  quitarRol(c, e) {
    const i = c.e.usuarios.findIndex((x) => x.uid === e.uid);
    const u = c.e.usuarios[i];
    if (u === undefined) throw fallo('no-miembro');
    if (u.rol === 'adm') throw fallo('jerarquia');
    c.e.usuarios.splice(i, 1);
    c.e.cuentasSinRol.push({ ...u, rol: 'caj' });
    auditar(c, 'identidad.quitar-rol', `usuarios/${e.uid}`);
    return { ok: true };
  },
  listarFichas: (c) => [...c.e.fichas].map(([productoId, ficha]) => ({ productoId, ficha })),
  listarMedios: (c, e) => [...c.e.medios.values()].filter((m) => m.productoId === e.productoId),
  leerConfigSitio: (c) => c.e.configSitio,
  listarSecciones: (c) => c.e.secciones,
  listarCarruseles: (c) => [...c.e.carruseles.values()],
  listarUsuarios: (c) => c.e.usuarios,
  modulosActivos: (c) => [...c.e.modulos],
  buscarUsuarioPorCorreo(c, e) {
    exigirRol(c, ['adm']);
    const buscado = e.correo.trim().toLowerCase();
    const u = [...c.e.usuarios, ...c.e.cuentasSinRol].find((x) => x.correo.toLowerCase() === buscado);
    if (u === undefined) throw fallo('no-encontrado', 'No existe una cuenta con ese correo.');
    return { uid: u.uid, correoVerificado: u.verificado, conContrasena: true };
  },
};

export { vistaProducto };
