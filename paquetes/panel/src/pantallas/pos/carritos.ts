import { useCallback, useContext, useEffect, useRef, useState } from 'preact/hooks';
import { nuevoId } from '../../api/cliente.js';
import { ErrorApi } from '../../api/errores.js';
import type { CarritoGuardado, ContenidoCarritoGuardado, MercadoDeclarado, UbicacionId } from '../../api/tipos.js';
import { CtxApp } from '../../ui/contexto.js';
import { centavosATexto, textoACentavos } from '../../util/dinero.js';

/** Debe coincidir con el tope de carritos abiertos por turno del servidor (`MAX_CARRITOS_ABIERTOS` de `@novutienda/pos`). */
export const TOPE_CARRITOS = 10;
/** Espera tras el último cambio antes de guardar: como máximo una escritura cada 0,6 s. */
export const MS_GUARDADO_CARRITO = 600;
/** Espera antes de reintentar un guardado que falló por la red. */
export const MS_REINTENTO_GUARDADO = 3000;
export const AVISO_CONFLICTO = 'Este carrito cambió en otra ventana o equipo. Se muestra la versión más reciente.';
export const AVISO_NO_GUARDADO = 'Este carrito no se pudo guardar todavía. Espere a que diga «Guardado» antes de cambiar de carrito.';
export const AVISO_CERRADO = 'Este carrito ya no está abierto: se cobró o se canceló desde otra ventana o equipo.';
/** Aviso de «Cobrar» cuando lo guardado no es lo que la cajera vio (otra ventana lo cambió). */
export const AVISO_COBRO_CONFLICTO = 'El carrito cambió en otra ventana o equipo. Revise la versión que se muestra y pulse «Cobrar» de nuevo.';

export interface LineaUI {
  productoId: string;
  almacenId: UbicacionId;
  cantidad: number;
  series: string[];
}

/** Lo que la cajera ve y edita del carrito activo (el descuento va como texto mientras lo escribe). */
export interface BorradorCarrito {
  mercadoId: string;
  moneda: string;
  lineas: LineaUI[];
  descTexto: string;
  descMotivo: string;
  aprobacionId: string;
  cliente: string;
  telefono: string;
  solicitadaId: string | null;
  /** Solicitud de aprobación de crédito pedida desde este carrito: viaja con él para sobrevivir a «Volver», a recargar y a cambiar de carrito. */
  creditoSolicitadoId: string | null;
}

export type EstadoGuardado = 'guardado' | 'guardando' | 'sin-guardar';
export const TEXTO_GUARDADO: Readonly<Record<EstadoGuardado, string>> = {
  guardado: 'Guardado',
  guardando: 'Guardando…',
  'sin-guardar': 'Sin guardar, reintentando',
};

/** Líneas (productos distintos) de un carrito guardado: es lo que cuentan la barra de carritos y el cierre de turno. */
export const lineasGuardadas = (k: CarritoGuardado): number => (k.contenido?.lineas ?? []).length;
/** «1 producto», «3 productos»: cuenta líneas, no unidades. */
export const textoProductos = (n: number): string => `${n} ${n === 1 ? 'producto' : 'productos'}`;

export function deContenido(k: CarritoGuardado, mercados: readonly MercadoDeclarado[]): BorradorCarrito {
  const c = k.contenido;
  const mercado = mercados.find((m) => m.id === c?.mercadoId) ?? mercados[0];
  const moneda = c !== undefined && mercado?.id === c.mercadoId ? c.moneda : (mercado?.monedaVenta ?? '');
  return {
    mercadoId: mercado?.id ?? '',
    moneda,
    lineas: (c?.lineas ?? []).map((l) => ({ productoId: l.productoId, almacenId: l.almacenId as UbicacionId, cantidad: l.cantidad, series: [...l.series] })),
    descTexto: c?.descuento === undefined ? '' : centavosATexto(c.descuento.monto),
    descMotivo: c?.descuento?.motivo ?? '',
    aprobacionId: c?.aprobacionDescuentoId ?? '',
    cliente: c?.cliente?.nombre ?? '',
    telefono: c?.cliente?.telefono ?? '',
    solicitadaId: c?.solicitudDescuentoId ?? null,
    creditoSolicitadoId: c?.solicitudCreditoId ?? null,
  };
}

/** Lo que se guarda: solo líneas completas y sin repetir, y un descuento solo si ya es válido (monto y motivo). */
export function aContenido(b: BorradorCarrito): ContenidoCarritoGuardado {
  const vistas = new Set<string>();
  const lineas = b.lineas.filter((l) => {
    const clave = `${l.almacenId}/${l.productoId}`;
    if (l.cantidad < 1 || vistas.has(clave)) return false;
    vistas.add(clave);
    return true;
  });
  const monto = b.descTexto.trim() === '' ? null : textoACentavos(b.descTexto);
  const nombre = b.cliente.trim();
  const telefono = b.telefono.trim();
  return {
    mercadoId: b.mercadoId,
    moneda: b.moneda,
    lineas: lineas.map((l) => ({ productoId: l.productoId, almacenId: l.almacenId, cantidad: l.cantidad, series: [...l.series] })),
    ...(monto !== null && monto > 0 && b.descMotivo.trim() !== '' ? { descuento: { monto, motivo: b.descMotivo.trim() } } : {}),
    ...(nombre !== '' ? { cliente: { nombre, ...(telefono !== '' ? { telefono } : {}) } } : {}),
    ...(b.aprobacionId !== '' ? { aprobacionDescuentoId: b.aprobacionId } : {}),
    ...(b.solicitadaId !== null ? { solicitudDescuentoId: b.solicitadaId } : {}),
    ...(b.creditoSolicitadoId !== null ? { solicitudCreditoId: b.creditoSolicitadoId } : {}),
  };
}

/** Un aviso de la pantalla como error que `useAccion` muestra tal cual (un `Error` común se vería como «error inesperado»). */
export const errorDeCarrito = (mensaje: string): ErrorApi => new ErrorApi('failed-precondition', mensaje);
const codigoDe = (e: unknown): string | undefined => (e instanceof ErrorApi ? e.detalle.codigo : undefined);
const huella = (b: BorradorCarrito): string => JSON.stringify(aContenido(b));
const porCreacion = (a: CarritoGuardado, b: CarritoGuardado): number => a.creadoEnMs - b.creadoEnMs;

export interface CarritoServidor {
  readonly cargando: boolean;
  readonly error: string | null;
  readonly recargar: () => void;
  /** Carritos abiertos del turno, del más viejo al más nuevo. */
  readonly carritos: readonly CarritoGuardado[];
  readonly activo: CarritoGuardado | undefined;
  readonly borrador: BorradorCarrito | null;
  readonly estado: EstadoGuardado;
  /** Avisos de lo que cambió fuera de la pantalla (otra ventana o equipo, carrito que ya no está abierto). */
  readonly aviso: string | null;
  readonly descartarAviso: () => void;
  /** Cambia el carrito activo; el guardado se hace solo, 0,6 s después. */
  readonly cambiar: (f: (b: BorradorCarrito) => BorradorCarrito) => void;
  /**
   * Guarda lo pendiente ya. `false` si lo guardado no es lo que la cajera vio: falló la red, otra ventana cambió el carrito
   * (se toma su versión) o ya no está abierto. En ese caso no debe cambiarse de carrito ni cobrar; `motivoNoGuardado` dice por qué.
   */
  readonly vaciar: () => Promise<boolean>;
  readonly motivoNoGuardado: () => string;
  /** Si `e` es un conflicto de versión del carrito activo, toma la versión del servidor y avisa; `true` si lo era. */
  readonly tomarConflicto: (e: unknown) => boolean;
  readonly crear: () => Promise<void>;
  readonly activar: (carritoId: string) => Promise<void>;
  readonly renombrar: (carritoId: string, etiqueta: string) => Promise<void>;
  readonly cancelar: (carritoId: string, motivo: string) => Promise<void>;
  /** Un carrito ya cobrado sale de la lista y se pasa a otro abierto (o se crea uno). */
  readonly retirarCobrado: (carritoId: string) => Promise<void>;
}

/**
 * Carritos de la cajera guardados en el servidor: todos los abiertos de su turno, uno activo. El cambio se guarda solo
 * (espera de 0,6 s tras el último cambio; se vacía antes de cobrar, de cambiar de carrito y al salir de la pantalla).
 * Al cerrar la pestaña o dejarla oculta se intenta guardar de inmediato, pero el navegador no garantiza que la llamada termine:
 * un cambio hecho en los últimos 0,6 s antes de cerrar la pestaña puede perderse.
 * Si el servidor tiene otra versión (otra ventana o equipo), se toma la suya y se avisa. Nada se guarda en el dispositivo.
 */
export function useCarritoServidor(turnoId: string, mercados: readonly MercadoDeclarado[], inicial?: string): CarritoServidor {
  const ctx = useContext(CtxApp);
  if (ctx === null) throw new Error('useCarritoServidor fuera de la aplicación');
  const { api } = ctx;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const mercadosRef = useRef(mercados);
  mercadosRef.current = mercados;

  const [carritos, setCarritos] = useState<readonly CarritoGuardado[]>([]);
  const [activoId, setActivoId] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<BorradorCarrito | null>(null);
  const [estado, setEstado] = useState<EstadoGuardado>('guardado');
  const [aviso, setAviso] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ronda, setRonda] = useState(0);

  const carritosRef = useRef<readonly CarritoGuardado[]>([]);
  const activoRef = useRef<string | null>(null);
  const borradorRef = useRef<BorradorCarrito | null>(null);
  const huellaRef = useRef('');
  const sucioRef = useRef(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cola = useRef<Promise<unknown>>(Promise.resolve());
  const vivo = useRef(true);
  const motivoRef = useRef(AVISO_NO_GUARDADO);
  /** Motivo de un guardado fallido que nadie esperaba (lo lanzó el temporizador): `vaciar` lo debe ver aunque su propia escritura no encuentre nada pendiente. */
  const motivoSinVer = useRef<string | null>(null);

  const fijarCarritos = (ls: readonly CarritoGuardado[]): void => {
    carritosRef.current = ls;
    if (vivo.current) setCarritos(ls);
  };
  const fijarBorrador = (b: BorradorCarrito | null): void => {
    borradorRef.current = b;
    if (vivo.current) setBorrador(b);
  };
  const ponerEstado = (e: EstadoGuardado): void => {
    if (vivo.current) setEstado(e);
  };
  const avisar = (t: string): void => {
    if (vivo.current) setAviso(t);
  };
  /** Pone `k` como carrito activo con su contenido; lo pendiente ya se guardó o se descartó antes. */
  const mostrar = (k: CarritoGuardado | undefined): void => {
    activoRef.current = k?.carritoId ?? null;
    if (vivo.current) setActivoId(activoRef.current);
    const b = k === undefined ? null : deContenido(k, mercadosRef.current);
    fijarBorrador(b);
    huellaRef.current = b === null ? '' : huella(b);
    sucioRef.current = false;
    ponerEstado('guardado');
  };

  const enCola = <T,>(fn: () => Promise<T>): Promise<T> => {
    const p = cola.current.then(fn, fn);
    cola.current = p.catch(() => undefined);
    return p;
  };

  const programar = (ms: number): void => {
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => void escribir(), ms);
  };

  /** Una llamada que puede topar con una sesión vencida: se renueva una vez, como en el resto del panel. */
  const llamar = async <R,>(fn: () => Promise<R>): Promise<R> => {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ErrorApi) || e.codigoHttps !== 'unauthenticated') throw e;
      const ok = await ctxRef.current.renovarSesion().catch(() => false);
      if (!ok) {
        ctxRef.current.sesionVencida();
        throw e;
      }
      return fn();
    }
  };

  /** Una versión distinta en el servidor: se toma la suya, se recarga lo que se ve y se avisa. `true` si era un conflicto. */
  const tomarConflicto = (e: unknown, id: string): boolean => {
    if (codigoDe(e) !== 'carrito-conflicto' || !(e instanceof ErrorApi) || e.detalle.carrito === undefined) return false;
    const vigente = e.detalle.carrito;
    fijarCarritos(carritosRef.current.map((x) => (x.carritoId === id ? vigente : x)));
    if (activoRef.current === id) mostrar(vigente);
    avisar(AVISO_CONFLICTO);
    return true;
  };
  const conflictoActivo = (e: unknown): boolean => {
    const id = activoRef.current;
    return id !== null && tomarConflicto(e, id);
  };

  const escribir = (): Promise<boolean> =>
    enCola(async () => {
      clearTimeout(temporizador.current);
      if (!sucioRef.current) return true;
      const id = activoRef.current;
      const b = borradorRef.current;
      const k = carritosRef.current.find((x) => x.carritoId === id);
      if (id === null || b === null || k === undefined) {
        sucioRef.current = false;
        return true;
      }
      sucioRef.current = false;
      ponerEstado('guardando');
      try {
        const n = await llamar(() => api.llamar('guardarCarrito', { carritoId: id, version: k.version, contenido: aContenido(b) }));
        fijarCarritos(carritosRef.current.map((x) => (x.carritoId === id ? { ...x, ...n } : x)));
        huellaRef.current = huella(b);
        if (sucioRef.current) programar(MS_GUARDADO_CARRITO);
        else ponerEstado('guardado');
        return true;
      } catch (e) {
        // Lo guardado no es lo que la cajera vio: se toma lo del servidor, pero quien espera (cobrar, cambiar) no debe seguir.
        if (tomarConflicto(e, id)) {
          motivoRef.current = AVISO_COBRO_CONFLICTO;
          motivoSinVer.current = AVISO_COBRO_CONFLICTO;
          return false;
        }
        const codigo = codigoDe(e);
        if (codigo === 'carrito-cerrado' || codigo === 'carrito-inexistente') {
          // Ya no está abierto (se cobró o se canceló en otra ventana): se recarga la lista.
          avisar(AVISO_CERRADO);
          motivoRef.current = AVISO_CERRADO;
          motivoSinVer.current = AVISO_CERRADO;
          if (vivo.current) setRonda((n) => n + 1);
          return false;
        }
        motivoRef.current = AVISO_NO_GUARDADO;
        sucioRef.current = true;
        ponerEstado('sin-guardar');
        programar(MS_REINTENTO_GUARDADO);
        return false;
      }
    });

  const vaciar = async (): Promise<boolean> => {
    clearTimeout(temporizador.current);
    const ok = await escribir();
    const sinVer = motivoSinVer.current;
    motivoSinVer.current = null;
    if (sinVer !== null) {
      motivoRef.current = sinVer;
      return false;
    }
    return ok && !sucioRef.current;
  };

  const cambiar = (f: (b: BorradorCarrito) => BorradorCarrito): void => {
    const previo = borradorRef.current;
    if (previo === null) return;
    const n = f(previo);
    fijarBorrador(n);
    if (huella(n) === huellaRef.current) return;
    sucioRef.current = true;
    ponerEstado('guardando');
    programar(MS_GUARDADO_CARRITO);
  };

  // Carga al entrar al turno: los abiertos; si no hay ninguno, se crea el primero.
  useEffect(() => {
    vivo.current = true;
    let activa = true;
    setCargando(true);
    void (async () => {
      try {
        let ls = [...(await llamar(() => api.llamar('misCarritos', {})))].filter((k) => k.estado === 'abierto').sort(porCreacion);
        if (ls.length === 0) ls = [await llamar(() => api.llamar('crearCarrito', { carritoId: nuevoId() }))];
        if (!activa) return;
        fijarCarritos(ls);
        const previo = activoRef.current;
        mostrar(ls.find((k) => k.carritoId === previo) ?? ls.find((k) => k.carritoId === inicial) ?? ls[0]);
        setError(null);
      } catch (e) {
        if (activa) setError(e instanceof Error ? e.message : 'No se pudieron cargar los carritos.');
      } finally {
        if (activa) setCargando(false);
      }
    })();
    return () => {
      activa = false;
    };
  }, [turnoId, ronda]);

  // Al salir de la pantalla o cerrar la pestaña se guarda lo pendiente de inmediato.
  useEffect(() => {
    const alSalir = (): void => void escribir();
    const alOcultar = (): void => {
      if (document.visibilityState === 'hidden') void escribir();
    };
    window.addEventListener('pagehide', alSalir);
    document.addEventListener('visibilitychange', alOcultar);
    return () => {
      window.removeEventListener('pagehide', alSalir);
      document.removeEventListener('visibilitychange', alOcultar);
      void escribir();
      vivo.current = false;
    };
  }, []);

  const crear = async (): Promise<void> => {
    if (carritosRef.current.length >= TOPE_CARRITOS) throw errorDeCarrito(`Hay ${TOPE_CARRITOS} carritos abiertos: cobre o cancele alguno antes de abrir otro.`);
    if (!(await vaciar())) throw errorDeCarrito(motivoRef.current);
    const k = await llamar(() => api.llamar('crearCarrito', { carritoId: nuevoId() }));
    fijarCarritos([...carritosRef.current.filter((x) => x.carritoId !== k.carritoId), k].sort(porCreacion));
    mostrar(k);
  };

  const activar = async (carritoId: string): Promise<void> => {
    if (carritoId === activoRef.current) return;
    if (!(await vaciar())) throw errorDeCarrito(motivoRef.current);
    const k = carritosRef.current.find((x) => x.carritoId === carritoId);
    if (k !== undefined) mostrar(k);
  };

  const renombrar = async (carritoId: string, etiqueta: string): Promise<void> => {
    if (!(await vaciar())) throw errorDeCarrito(motivoRef.current);
    await enCola(async () => {
      const k = carritosRef.current.find((x) => x.carritoId === carritoId);
      if (k === undefined) return;
      try {
        const n = await llamar(() => api.llamar('guardarCarrito', { carritoId, version: k.version, etiqueta }));
        fijarCarritos(carritosRef.current.map((x) => (x.carritoId === carritoId ? { ...x, ...n } : x)));
      } catch (e) {
        if (!tomarConflicto(e, carritoId)) throw e;
      }
    });
  };

  /** Deja de mostrar `carritoId` y pasa a otro abierto, o crea uno si era el último. */
  const pasarAOtro = async (carritoId: string): Promise<void> => {
    const resto = carritosRef.current.filter((x) => x.carritoId !== carritoId);
    fijarCarritos(resto);
    if (activoRef.current !== carritoId) return;
    if (resto[0] !== undefined) {
      mostrar(resto[0]);
      return;
    }
    // Sin carrito activo mientras se crea el siguiente; si falla, la pantalla muestra el error con «Reintentar» (recargar).
    mostrar(undefined);
    try {
      const nuevo = await llamar(() => api.llamar('crearCarrito', { carritoId: nuevoId() }));
      fijarCarritos([nuevo]);
      mostrar(nuevo);
    } catch (e) {
      if (vivo.current) setError(e instanceof Error ? e.message : 'No se pudo abrir un carrito nuevo.');
      throw e;
    }
  };

  const cancelar = async (carritoId: string, motivo: string): Promise<void> => {
    const esActivo = carritoId === activoRef.current;
    if (esActivo) {
      // Nada se escribe mientras se cancela; lo pendiente se descarta solo si la cancelación tiene éxito.
      clearTimeout(temporizador.current);
      await cola.current;
    }
    try {
      await llamar(() => api.llamar('cancelarCarrito', { carritoId, motivo }));
    } catch (e) {
      // El carrito sigue abierto: lo pendiente vuelve a guardarse.
      if (esActivo && activoRef.current === carritoId && sucioRef.current) {
        ponerEstado('guardando');
        programar(MS_GUARDADO_CARRITO);
      }
      throw e;
    }
    if (esActivo) sucioRef.current = false;
    await pasarAOtro(carritoId);
  };

  /** Tras cobrar: el carrito sale de la lista. Si no se puede abrir otro, el error queda en `error` (con «Reintentar»), no se pierde. */
  const retirarCobrado = async (carritoId: string): Promise<void> => {
    sucioRef.current = false;
    clearTimeout(temporizador.current);
    await pasarAOtro(carritoId).catch(() => undefined);
  };

  const activo = carritos.find((k) => k.carritoId === activoId);
  return {
    cargando, error, recargar: useCallback(() => setRonda((n) => n + 1), []), carritos, activo, borrador, estado, aviso,
    descartarAviso: () => setAviso(null), cambiar, vaciar, motivoNoGuardado: () => motivoRef.current, tomarConflicto: conflictoActivo, crear, activar, renombrar, cancelar, retirarCobrado,
  };
}
