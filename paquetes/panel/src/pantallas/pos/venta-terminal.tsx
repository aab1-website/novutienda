import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { nuevoId, type ClienteApi } from '../../api/cliente.js';
import { marcaDe } from '../../api/marca.js';
import type { AprobacionPos, ConfigPos, CotizacionesVigentes, MercadoDeclarado, ProductoPanel, TurnoPos, UbicacionId, VentaPos } from '../../api/tipos.js';
import { Alerta, Boton, Campo, Cargando, Casilla, ErrorCarga, Selector, Seccion, Vacio } from '../../ui/comun.js';
import { useConfiguracionComercial } from '../../ui/comercial.js';
import { useApp } from '../../ui/contexto.js';
import { AvisoConteoAbierto, TEXTO_OCULTO } from '../../ui/existencia.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { AccionesRecibo, ReciboVista } from '../recibos/recibo-vista.js';
import { formatearMonto, textoACentavos } from '../../util/dinero.js';
import { precioDeCobro } from './arqueo.js';
import { type BorradorCarrito, type CarritoServidor, type LineaUI, AVISO_NO_GUARDADO, errorDeCarrito, textoProductos, useCarritoServidor } from './carritos.js';
import { CatalogoVenta } from './venta-catalogo.js';
import { SerieEscrita } from './serie-escrita.js';
import { MENSAJE_TELEFONO, MENSAJE_TELEFONO_SIN_NOMBRE, telefonoValido } from './telefono.js';
import { BarraCarritos } from './venta-carritos.js';
import { useEsperaAprobacion, VentaCobro, type DatosCobro } from './venta-cobro.js';
import './venta.css';

/** El recibo se consulta cada 3 s, hasta 30 s, antes de ofrecer «Reintentar». */
export const MS_ENTRE_CONSULTAS_RECIBO = 3000;
export const CONSULTAS_RECIBO = 10;
export type { LineaUI } from './carritos.js';

const ALMACENES: { valor: UbicacionId; texto: string }[] = [
  { valor: 'tienda', texto: 'Tienda' },
  { valor: 'deposito-1', texto: 'Depósito 1' },
  { valor: 'deposito-2', texto: 'Depósito 2' },
];

/** Lleva la vista y el foco al selector de series de un producto: a su primer control, o a la zona si no hay ninguno (sin series). */
export function enfocarSeries(productoId: string): void {
  const zona = Array.from(document.querySelectorAll<HTMLElement>('[data-series-de]')).find((e) => e.dataset.seriesDe === productoId);
  if (zona === undefined) return;
  zona.scrollIntoView?.({ block: 'center' });
  const control = zona.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled]), select:not([disabled])');
  (control ?? zona).focus();
}

function SelectorSeries({ producto, almacenId, enConteo, elegidas, alCambiar, alListo }: { producto: ProductoPanel; almacenId: UbicacionId; enConteo: boolean; elegidas: string[]; alCambiar: (s: string[]) => void; alListo: () => void }): JSX.Element {
  // Almacén en conteo para quien no es administrador: no se lista lo disponible (su cantidad sería el stock); se escribe o escanea.
  if (enConteo) return <SerieEscrita productoId={producto.id} almacenId={almacenId} elegidas={elegidas} alCambiar={alCambiar} />;
  return <SelectorSeriesLista producto={producto} almacenId={almacenId} elegidas={elegidas} alCambiar={alCambiar} alListo={alListo} />;
}

function SelectorSeriesLista({ producto, almacenId, elegidas, alCambiar, alListo }: { producto: ProductoPanel; almacenId: UbicacionId; elegidas: string[]; alCambiar: (s: string[]) => void; alListo: () => void }): JSX.Element {
  const { api } = useApp();
  const s = useCarga(() => api.llamar('listarSeries', { productoId: producto.id, ubicacionId: almacenId, soloDisponibles: true }), [producto.id, almacenId]);
  // La lista llega después de abrir el selector: cuando está lista, el foco pasa a su primera casilla.
  useEffect(() => {
    if (!s.cargando) alListo();
  }, [s.cargando]);
  if (s.cargando) return <Cargando texto="Cargando series…" />;
  if (s.error) return <ErrorCarga error={s.error} reintentar={s.recargar} />;
  if (!s.datos || s.datos.length === 0) return <p class="texto-suave">No hay series disponibles en este almacén.</p>;
  return (
    <fieldset class="series">
      <legend>Series de {producto.nombre}</legend>
      {s.datos.map((u) => (
        <Casilla key={u.serie} etiqueta={u.serie} marcado={elegidas.includes(u.serie)} onCambio={(v) => alCambiar(v ? [...elegidas, u.serie] : elegidas.filter((x) => x !== u.serie))} />
      ))}
    </fieldset>
  );
}

export function VentaTerminal({ turno, alCambiar, carritoPedido, alUsarPedido }: { turno: TurnoPos; alCambiar: () => void; carritoPedido?: string | undefined; alUsarPedido?: (() => void) | undefined }): JSX.Element {
  const comercial = useConfiguracionComercial();
  if (comercial.estado === 'cargando') return <Cargando />;
  if (comercial.estado === 'error') return <Alerta>{comercial.mensaje}</Alerta>;
  if (comercial.comercial.mercados.length === 0) return <Alerta>El comercio no tiene mercados declarados.</Alerta>;
  return <TerminalLista turno={turno} alCambiar={alCambiar} mercados={comercial.comercial.mercados} carritoPedido={carritoPedido} alUsarPedido={alUsarPedido} />;
}

function TerminalLista({ turno, alCambiar, mercados, carritoPedido, alUsarPedido }: { turno: TurnoPos; alCambiar: () => void; mercados: readonly MercadoDeclarado[]; carritoPedido?: string | undefined; alUsarPedido?: (() => void) | undefined }): JSX.Element {
  const { api } = useApp();
  const datos = useCarga(
    async () => ({
      productos: await api.llamar('listarProductos', {}),
      cot: await api.llamar('cotizacionesVigentes', {}),
      config: await api.llamar('leerConfigPos', {}),
      ventas: await api.llamar('listarVentas', { turnoId: turno.turnoId }),
    }),
    [turno.turnoId],
    undefined,
    { alVolver: true },
  );
  // Los carritos viven en el servidor: sobreviven a recargar la página, a cambiar de usuario y a cerrar la computadora.
  const c = useCarritoServidor(turno.turnoId, mercados, carritoPedido);
  const [recibo, setRecibo] = useState<{ ventaId: string; carritoId: string; repetida: boolean } | null>(null);
  // Precios que se vieron en esta sesión por carrito, para avisar al retomarlo si cambiaron (el servidor no guarda precios).
  const preciosVistos = useRef(new Map<string, Record<string, number>>());
  useEffect(() => {
    if (carritoPedido !== undefined && c.activo?.carritoId === carritoPedido) alUsarPedido?.();
  }, [carritoPedido, c.activo?.carritoId]);

  if (recibo !== null) {
    return <ReciboFinal ventaId={recibo.ventaId} repetida={recibo.repetida} nuevaVenta={() => { const id = recibo.carritoId; setRecibo(null); void c.retirarCobrado(id); alCambiar(); datos.recargar(); }} />;
  }
  if (datos.cargando || c.cargando) return <Cargando />;
  if (datos.error || !datos.datos) return <ErrorCarga error={datos.error ?? 'Sin datos'} reintentar={datos.recargar} />;
  if (c.error !== null) return <ErrorCarga error={c.error} reintentar={c.recargar} />;
  if (c.activo === undefined || c.borrador === null) return <Cargando />;
  const carritoActivoId = c.activo.carritoId;
  return (
    <div>
      <BarraCarritos c={c} lineasActivo={c.borrador.lineas.length} />
      <CarritoActivo
        key={carritoActivoId}
        carritoId={carritoActivoId}
        version={c.activo.version}
        borrador={c.borrador}
        c={c}
        mercados={mercados}
        datos={datos.datos}
        vistos={preciosVistos.current}
        alVender={(ventaId, repetida) => setRecibo({ ventaId, carritoId: carritoActivoId, repetida })}
      />
    </div>
  );
}

interface DatosTerminal {
  productos: readonly ProductoPanel[];
  cot: CotizacionesVigentes;
  config: ConfigPos;
  ventas: readonly VentaPos[];
}

/**
 * Avisos al retomar un carrito: lo que pudo cambiar mientras estaba guardado. El aviso de precio solo compara con lo que esta
 * pantalla vio en la misma sesión (el servidor no guarda precios): tras recargar o entrar desde otro equipo no hay con qué
 * comparar y no se avisa. El servidor igual valida el total al cobrar.
 */
export async function avisosAlRetomar(b: BorradorCarrito, porId: ReadonlyMap<string, ProductoPanel>, conteos: readonly { ubicacionId: string }[], api: ClienteApi, vistos: Record<string, number> | undefined, precioDe: (p: ProductoPanel) => number | null): Promise<string[]> {
  const avisos: string[] = [];
  for (const l of b.lineas) {
    const p = porId.get(l.productoId);
    if (p === undefined || !p.activo) {
      avisos.push(`El producto ${p?.nombre ?? 'de una línea'} ya no está activo: quítelo del carrito.`);
      continue;
    }
    const precio = precioDe(p);
    const antes = vistos?.[p.id];
    if (antes !== undefined && precio !== null && antes !== precio) avisos.push(`El precio de ${p.nombre} cambió desde que lo vio en esta sesión: antes ${formatearMonto(antes, b.moneda)}, ahora ${formatearMonto(precio, b.moneda)}. El total se vuelve a validar al cobrar.`);
    // En un almacén en conteo no se lista lo disponible (sería mostrar el stock): no se puede comprobar la serie.
    if (l.series.length === 0 || conteos.some((x) => x.ubicacionId === l.almacenId)) continue;
    try {
      const libres = new Set((await api.llamar('listarSeries', { productoId: p.id, ubicacionId: l.almacenId, soloDisponibles: true })).map((u) => u.serie));
      for (const s of l.series) if (!libres.has(s)) avisos.push(`La serie ${s} de ${p.nombre} ya no está disponible: quítela o elija otra.`);
    } catch {
      // Sin la lista no se avisa; el servidor vuelve a comprobar al cobrar.
    }
  }
  return avisos;
}

function CarritoActivo({ carritoId, version, borrador, c, mercados, datos, vistos, alVender }: { carritoId: string; version: number; borrador: BorradorCarrito; c: CarritoServidor; mercados: readonly MercadoDeclarado[]; datos: DatosTerminal; vistos: Map<string, Record<string, number>>; alVender: (ventaId: string, repetida: boolean) => void }): JSX.Element {
  const { api, usuario } = useApp();
  const { cot, config, ventas } = datos;
  const { mercadoId, moneda, lineas, descTexto, descMotivo, aprobacionId, cliente, telefono } = borrador;
  const cambiar = (x: Partial<BorradorCarrito>): void => c.cambiar((p) => ({ ...p, ...x }));
  const setMercadoId = (v: string): void => cambiar({ mercadoId: v });
  const setMoneda = (v: string): void => cambiar({ moneda: v });
  const setLineas = (v: LineaUI[] | ((p: LineaUI[]) => LineaUI[])): void => c.cambiar((p) => ({ ...p, lineas: typeof v === 'function' ? v(p.lineas) : v }));
  const setDescTexto = (v: string): void => cambiar({ descTexto: v });
  const setDescMotivo = (v: string): void => cambiar({ descMotivo: v });
  const setAprobacionId = (v: string): void => cambiar({ aprobacionId: v });
  const setCliente = (v: string): void => cambiar({ cliente: v });
  const setTelefono = (v: string): void => cambiar({ telefono: v });
  const [verSeries, setVerSeries] = useState<string | null>(null);
  // Al abrir el selector de series, la vista y el foco van a él (en pantalla angosta queda debajo de la lista).
  useEffect(() => {
    if (verSeries !== null) enfocarSeries(verSeries);
  }, [verSeries]);
  const [paso, setPaso] = useState<'carrito' | 'cobro'>('carrito');
  const solicitud = useAccion();
  const cobrando = useAccion();
  const solicitadaId = borrador.solicitadaId;
  const setSolicitadaId = (v: string | null): void => cambiar({ solicitadaId: v });
  // La aprobación elegida ya está en la lista que se carga: elegirla (también sola) no vuelve a consultar.
  const elegidaRef = useRef(aprobacionId);
  elegidaRef.current = aprobacionId;
  const aprobs = useCarga(async () => (await api.llamar('listarAprobaciones', {})).filter((a) => a.aprobacionId === solicitadaId || (elegidaRef.current !== '' && a.aprobacionId === elegidaRef.current)), [solicitadaId, paso], undefined, { alVolver: true });
  // Con una sola aprobación válida se elige sola; con varias, la más reciente. Lo que ya eligió la persona y sigue válido se respeta.
  const aprobadasVigentes = useRef<readonly AprobacionPos[]>([]);
  useEffect(() => {
    const l = aprobadasVigentes.current;
    if (l.length === 0 || l.some((a) => a.aprobacionId === aprobacionId)) return;
    const masReciente = l.reduce((x, y) => (y.solicitadoEnMs > x.solicitadoEnMs ? y : x));
    setAprobacionId(masReciente.aprobacionId);
  });
  // Una aprobación sirve solo al carrito para el que se pidió: aquí solo se ven las de este carrito.
  // Solo se espera la solicitud que esta pantalla acaba de pedir; vive en el carrito y se va con él.
  const espera = useEsperaAprobacion(solicitadaId, aprobs.recargar, 'descuento');
  const refCarrito = useRef<HTMLDivElement>(null);
  const [alRetomar, setAlRetomar] = useState<string[]>([]);

  // La marca viaja como propiedad de la lista: se lee antes de filtrar o mapear.
  const conteos = marcaDe(datos.productos)?.conteosAbiertos ?? [];
  const productos = datos.productos;
  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);

  const mercado = mercados.find((m) => m.id === mercadoId) ?? mercados[0];

  // Al retomar (abrir) este carrito: lo que cambió mientras estaba guardado.
  useEffect(() => {
    if (mercado === undefined || lineas.length === 0) return undefined;
    let activo = true;
    const precioDe = (p: ProductoPanel): number | null => {
      const r = precioDeCobro(p, mercado, moneda, cot);
      return r.tipo === 'precio' ? r.centavos : null;
    };
    void avisosAlRetomar(borrador, porId, conteos, api, vistos.get(`${carritoId}:${moneda}`), precioDe).then((a) => {
      if (activo) setAlRetomar(a);
    });
    return () => {
      activo = false;
    };
  }, []);
  // Los precios que se ven ahora quedan anotados (solo en memoria) para compararlos si el carrito se retoma luego.
  useEffect(() => {
    if (mercado === undefined) return;
    const m: Record<string, number> = {};
    for (const l of lineas) {
      const p = porId.get(l.productoId);
      const r = p === undefined ? null : precioDeCobro(p, mercado, moneda, cot);
      if (r?.tipo === 'precio') m[l.productoId] = r.centavos;
    }
    vistos.set(`${carritoId}:${moneda}`, m);
  }, [lineas, moneda, mercadoId]);

  if (mercado === undefined) return <Alerta>El comercio no tiene mercados declarados.</Alerta>;
  const cambiarMercado = (id: string): void => {
    setMercadoId(id);
    setMoneda(mercados.find((m) => m.id === id)?.monedaVenta ?? '');
  };
  const precioDe = (p: ProductoPanel): ReturnType<typeof precioDeCobro> => precioDeCobro(p, mercado, moneda, cot);

  const agregar = (p: ProductoPanel): void => {
    setLineas((ls) => {
      const i = ls.findIndex((l) => l.productoId === p.id && l.almacenId === 'tienda');
      if (i >= 0 && !p.conSerie) return ls.map((l, j) => (j === i ? { ...l, cantidad: l.cantidad + 1 } : l));
      if (i >= 0) return ls;
      return [...ls, { productoId: p.id, almacenId: 'tienda', cantidad: p.conSerie ? 0 : 1, series: [] }];
    });
    if (p.conSerie) setVerSeries(p.id);
  };
  const irAlCarrito = (): void => {
    const el = refCarrito.current;
    if (el === null) return;
    el.scrollIntoView?.({ block: 'start' });
    el.focus();
  };

  const lineaValida = (l: LineaUI): boolean => {
    const p = porId.get(l.productoId);
    return p !== undefined && l.cantidad >= 1 && (!p.conSerie || l.series.length === l.cantidad);
  };
  const precios = lineas.map((l) => {
    const p = porId.get(l.productoId);
    return p === undefined ? null : precioDe(p);
  });
  const todosConPrecio = precios.every((x) => x?.tipo === 'precio');
  const subtotal = lineas.reduce((s, l, i) => {
    const pr = precios[i];
    return s + (pr?.tipo === 'precio' ? pr.centavos * l.cantidad : 0);
  }, 0);

  const descMonto = descTexto.trim() === '' ? 0 : textoACentavos(descTexto);
  const descInvalido = descMonto === null || (descMonto > 0 && (descMonto >= subtotal || descMotivo.trim() === ''));
  const monto = descMonto ?? 0;
  const tope = config.topesDescuentoBp[usuario.rol];
  const excede = monto > 0 && monto * 10000 > tope * subtotal;
  const total = subtotal - (descInvalido ? 0 : monto);
  const aprobadas: AprobacionPos[] = (aprobs.datos ?? []).filter((a) => a.tipo === 'descuento' && a.estado === 'aprobada' && a.moneda === moneda && a.monto >= monto);
  aprobadasVigentes.current = aprobadas;
  const pendiente = (aprobs.datos ?? []).find((a) => a.tipo === 'descuento' && a.estado === 'pendiente' && a.moneda === moneda && a.monto >= monto);
  const rechazada = solicitadaId === null ? undefined : (aprobs.datos ?? []).find((a) => a.aprobacionId === solicitadaId && a.estado === 'rechazada');
  const falta = excede && aprobacionId === '';
  const errorCliente = telefono.trim() !== '' && cliente.trim() === '' ? MENSAJE_TELEFONO_SIN_NOMBRE : undefined;
  const errorTelefono = telefonoValido(telefono) ? undefined : MENSAJE_TELEFONO;
  const motivoNoCobrar = ((): string | undefined => {
    if (lineas.length === 0) return 'Agregue al menos un producto al carrito.';
    const sinSerie = lineas.find((l) => porId.get(l.productoId)?.conSerie === true && (l.series.length === 0 || l.series.length !== l.cantidad));
    if (sinSerie !== undefined) return `Elija las series de ${porId.get(sinSerie.productoId)?.nombre ?? 'un producto'}.`;
    if (!lineas.every(lineaValida)) return 'Indique una cantidad de al menos 1 en cada producto.';
    if (!todosConPrecio) return 'Hay productos sin precio en esta moneda: quítelos o cambie la moneda.';
    if (descInvalido) return 'Corrija el descuento: debe ser menor al subtotal y llevar un motivo.';
    if (errorCliente !== undefined) return errorCliente;
    if (errorTelefono !== undefined) return errorTelefono;
    if (falta) return 'El descuento necesita la aprobación de un supervisor: solicítela abajo.';
    if (config.mediosHabilitados.length === 0) return 'No hay medios de pago habilitados: avise al administrador.';
    return undefined;
  })();

  const pedirAprobacion = (): void => {
    void solicitud.ejecutar(async () => {
      const id = nuevoId();
      await api.llamar('solicitarAprobacion', { aprobacionId: id, solicitud: { tipo: 'descuento', moneda, monto, motivo: descMotivo.trim(), carritoId } });
      setSolicitadaId(id);
    }, { exito: 'Solicitud enviada al supervisor.', error: 'ambos' });
  };

  if (paso === 'cobro') {
    const cobro: DatosCobro = {
      mercado: mercado.id, moneda, config, total,
      carrito: {
        // El mercado viaja como id declarado por el comercio; el selector ofrece solo las monedas declaradas y el servidor valida la moneda contra ellas.
        mercado: mercado.id, moneda,
        lineas: lineas.map((l, i) => ({ productoId: l.productoId, cantidad: l.cantidad, almacenId: l.almacenId, ...(l.series.length > 0 ? { series: l.series } : {}), ...(precios[i]?.tipo === 'precio' ? { precioMostrado: (precios[i] as { centavos: number }).centavos } : {}) })),
        ...(monto > 0 ? { descuento: { monto, motivo: descMotivo.trim() } } : {}),
        ...(cliente.trim() !== '' ? { cliente: { nombre: cliente.trim(), ...(telefono.trim() !== '' ? { telefono: telefono.trim() } : {}) } } : {}),
        totalMostrado: total,
      },
      aprobacionId: excede ? aprobacionId : undefined,
      requestId: carritoId, carritoId, carritoVersion: version,
      solicitudCreditoId: borrador.creditoSolicitadoId,
      guardarSolicitudCredito: async (id) => {
        c.cambiar((p) => ({ ...p, creditoSolicitadoId: id }));
        if (!(await c.vaciar())) {
          // Si otra ventana cambió o cerró el carrito, se vuelve a él para ver el aviso y la versión vigente.
          if (c.motivoNoGuardado() !== AVISO_NO_GUARDADO) setPaso('carrito');
          throw errorDeCarrito(`La solicitud se envió, pero no quedó guardada en el carrito. ${c.motivoNoGuardado()}`);
        }
      },
      alConflicto: (e) => {
        if (!c.tomarConflicto(e)) return false;
        setPaso('carrito');
        return true;
      },
      nombreProducto: (id) => porId.get(id)?.nombre,
      nombreAlmacen: (id) => ALMACENES.find((a) => a.valor === id)?.texto,
    };
    // La venta ya está registrada: el servidor cerró el carrito; «Nueva venta» lo retira de la lista.
    return <VentaCobro datos={cobro} volver={() => setPaso('carrito')} alVender={alVender} />;
  }

  return (
    <div>
      {alRetomar.length > 0 && (
        <Alerta tipo="info">
          <span>Al retomar este carrito:</span>
          <ul>{alRetomar.map((t) => <li key={t}>{t}</li>)}</ul>
          <Boton chico variante="secundario" onClick={() => setAlRetomar([])}>Entendido</Boton>
        </Alerta>
      )}
      <div class="terminal">
      <AvisoConteoAbierto conteos={conteos} />
      <CatalogoVenta productos={productos} ventas={ventas} cot={cot} mercados={mercados} mercado={mercado} moneda={moneda} cambiarMercado={cambiarMercado} cambiarMoneda={setMoneda} alAgregar={agregar} />

      <div ref={refCarrito} tabIndex={-1} class="venta-carrito" role="group" aria-label="Carrito">
      <Seccion titulo="Carrito">
        {lineas.length === 0 ? (
          <Vacio titulo="El carrito está vacío" detalle="Agregue productos desde la lista." />
        ) : (
          <ul class="lista-simple carrito">
            {lineas.map((l, i) => {
              const p = porId.get(l.productoId);
              const pr = precios[i];
              if (p === undefined) return null;
              return (
                <li key={`${l.productoId}-${l.almacenId}`} class="linea-carrito">
                  <div class="fila fila-entre">
                    <strong>{p.nombre}</strong>
                    <span>{pr?.tipo === 'precio' ? formatearMonto(pr.centavos * l.cantidad, pr.moneda) : '—'}</span>
                  </div>
                  <div class="fila fila-alinear">
                    <Selector
                      etiqueta="Almacén"
                      valor={l.almacenId}
                      opciones={ALMACENES.map((a) => ({ valor: a.valor, texto: `${a.texto} (${p.existencias[a.valor] ?? TEXTO_OCULTO})` }))}
                      onCambio={(v) => setLineas(lineas.map((x, j) => (j === i ? { ...x, almacenId: v as UbicacionId, series: [], cantidad: p.conSerie ? 0 : x.cantidad } : x)))}
                    />
                    {p.conSerie ? (
                      <>
                        <p>Unidades: {l.series.length}</p>
                        <Boton chico variante="secundario" onClick={() => setVerSeries(verSeries === p.id ? null : p.id)}>
                          {verSeries === p.id ? 'Ocultar series' : 'Elegir series'}
                        </Boton>
                      </>
                    ) : (
                      <Campo etiqueta="Cantidad" tipo="number" min={1} inputMode="numeric" valor={String(l.cantidad)} onInput={(v) => setLineas(lineas.map((x, j) => (j === i ? { ...x, cantidad: Math.max(0, Math.floor(Number(v) || 0)) } : x)))} />
                    )}
                    <Boton chico variante="peligro" etiqueta={`Quitar ${p.nombre}`} onClick={() => setLineas(lineas.filter((_, j) => j !== i))}>
                      Quitar
                    </Boton>
                  </div>
                  {p.conSerie && verSeries === p.id && (
                    <div data-series-de={p.id} tabIndex={-1}>
                      <SelectorSeries producto={p} almacenId={l.almacenId} enConteo={conteos.some((c) => c.ubicacionId === l.almacenId)} elegidas={l.series} alCambiar={(s) => setLineas(lineas.map((x, j) => (j === i ? { ...x, series: s, cantidad: s.length } : x)))} alListo={() => enfocarSeries(p.id)} />
                    </div>
                  )}
                  {p.conSerie && l.series.length === 0 && <p class="texto-suave">{conteos.some((c) => c.ubicacionId === l.almacenId) ? 'Escriba o escanee al menos una serie.' : 'Elija al menos una serie.'}</p>}
                </li>
              );
            })}
          </ul>
        )}

        <div class="formulario">
          <div class="cuadricula">
            <Campo etiqueta="Descuento (monto)" valor={descTexto} onInput={setDescTexto} inputMode="decimal" ayuda={`Su tope sin permiso es ${tope / 100} % del subtotal.`} />
            <Campo etiqueta="Motivo del descuento" valor={descMotivo} onInput={setDescMotivo} />
          </div>
          {descInvalido && descTexto.trim() !== '' && <Alerta>El descuento debe ser un monto menor al subtotal y llevar un motivo.</Alerta>}
          {excede && !descInvalido && (
            <div class="caja-aviso">
              <p>El descuento supera su tope: necesita la aprobación de un supervisor.</p>
              {aprobadas.length > 0 ? (
                <>
                {aprobadas.some((a) => a.aprobacionId === aprobacionId) && <Alerta tipo="ok">Aprobación del supervisor lista</Alerta>}
                <Selector
                  etiqueta="Aprobación a usar"
                  valor={aprobacionId}
                  onCambio={setAprobacionId}
                  opciones={[{ valor: '', texto: 'Elija una aprobación' }, ...aprobadas.map((a) => ({ valor: a.aprobacionId, texto: `Hasta ${formatearMonto(a.monto, a.moneda)} · ${a.motivo}` }))]}
                />
                </>
              ) : pendiente ? (
                espera.consultando && pendiente.aprobacionId === solicitadaId ? (
                <Alerta tipo="info">Esperando la aprobación del supervisor: se consulta sola cada pocos segundos.</Alerta>
              ) : (
                <>
                  <Alerta tipo="info">Hay una solicitud pendiente y ya no se consulta sola.</Alerta>
                  <Boton chico variante="secundario" onClick={() => { aprobs.recargar(); espera.reanudar(); }}>Volver a consultar</Boton>
                </>
              )
              ) : (
                <>
                  {rechazada && (
                    <Alerta>
                      Su solicitud fue rechazada.{rechazada.motivoRechazo !== undefined && rechazada.motivoRechazo !== '' ? ` Motivo: ${rechazada.motivoRechazo}` : ''}
                    </Alerta>
                  )}
                  <Boton chico variante="secundario" onClick={pedirAprobacion} ocupado={solicitud.ocupado}>
                    {rechazada ? 'Solicitar de nuevo' : 'Solicitar aprobación'}
                  </Boton>
                </>
              )}
              {solicitud.error && <Alerta>{solicitud.error}</Alerta>}
            </div>
          )}
          <div class="cuadricula">
            <Campo etiqueta="Cliente (opcional)" valor={cliente} onInput={setCliente} error={errorCliente} />
            <Campo etiqueta="Teléfono del cliente (opcional, exige el nombre)" valor={telefono} onInput={setTelefono} inputMode="numeric" error={errorTelefono} />
          </div>
        </div>

        <dl class="totales">
          <div><dt>Subtotal</dt><dd>{formatearMonto(subtotal, moneda)}</dd></div>
          {monto > 0 && !descInvalido && <div><dt>Descuento</dt><dd>-{formatearMonto(monto, moneda)}</dd></div>}
          <div class="total"><dt>Total</dt><dd data-prueba="total">{formatearMonto(total, moneda)}</dd></div>
        </dl>
        {cobrando.error && <Alerta>{cobrando.error}</Alerta>}
        <Boton
          ocupado={cobrando.ocupado}
          onClick={() =>
            void cobrando.ejecutar(async () => {
              // Lo pendiente se guarda antes de cobrar: el cobro usa la versión que el servidor ya tiene.
              if (!(await c.vaciar())) throw errorDeCarrito(c.motivoNoGuardado());
              setPaso('cobro');
            })
          }
          motivo={motivoNoCobrar}
        >
          Cobrar
        </Boton>
      </Seccion>
      </div>
      </div>
      {lineas.length > 0 && (
        <div class="venta-barra" role="region" aria-label="Resumen del carrito">
          <span data-prueba="barra-resumen" aria-live="polite">
            {textoProductos(lineas.length)} · {formatearMonto(total, moneda)}
          </span>
          <Boton chico onClick={irAlCarrito}>Ver carrito</Boton>
        </div>
      )}
    </div>
  );
}

function ReciboFinal({ ventaId, repetida, nuevaVenta }: { ventaId: string; repetida: boolean; nuevaVenta: () => void }): JSX.Element {
  const { api, usuario } = useApp();
  const [intento, setIntento] = useState(0);
  const viva = useRef(true);
  useEffect(() => () => void (viva.current = false), []);
  // El módulo de recibos emite el comprobante al consumir el evento; puede tardar unos segundos: se consulta cada 3 s hasta 30 s.
  const r = useCarga(
    async () => {
      for (let i = 0; ; i++) {
        const x = await api.llamar('obtenerRecibo', { ventaId });
        if (x !== null) return x;
        if (i >= CONSULTAS_RECIBO || !viva.current) return null;
        await new Promise((res) => setTimeout(res, MS_ENTRE_CONSULTAS_RECIBO));
      }
    },
    [ventaId, intento],
  );
  return (
    <Seccion titulo="Venta registrada" acciones={<Boton onClick={nuevaVenta}>Nueva venta</Boton>}>
      {repetida ? (
        <Alerta tipo="info">Esta venta ya estaba registrada: el cobro anterior sí llegó al servidor. No se cobró de nuevo; este es su recibo original.</Alerta>
      ) : (
        <Alerta tipo="ok">La venta se registró correctamente.</Alerta>
      )}
      {r.cargando && <Cargando texto="Preparando el recibo…" />}
      {r.error && <ErrorCarga error={r.error} reintentar={r.recargar} />}
      {!r.cargando && !r.error && r.datos === null && (
        <Alerta tipo="info">
          El recibo todavía no está listo.
          <Boton chico variante="secundario" onClick={() => setIntento((n) => n + 1)}>Reintentar</Boton>
        </Alerta>
      )}
      {r.datos && (
        <>
          <AccionesRecibo recibo={r.datos} alCambiar={r.recargar} />
          <ReciboVista recibo={r.datos} registradoPor={{ qr: usuario.correo }} />
        </>
      )}
    </Seccion>
  );
}
