import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { nuevoId } from '../../api/cliente.js';
import { marcaDe } from '../../api/marca.js';
import type { AprobacionPos, CotizacionesVigentes, MercadoDeclarado, Moneda, ProductoPanel, Recibo, TurnoPos, UbicacionId } from '../../api/tipos.js';
import { Alerta, Boton, Campo, Cargando, Casilla, ErrorCarga, Selector, Seccion, Vacio } from '../../ui/comun.js';
import { useConfiguracionComercial } from '../../ui/comercial.js';
import { useAvisos } from '../../ui/avisos.js';
import { useApp } from '../../ui/contexto.js';
import { useBorrador } from '../../ui/guardia.js';
import { AvisoConteoAbierto, ExistenciaOculta, TEXTO_OCULTO } from '../../ui/existencia.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { AccionesRecibo, ReciboVista } from '../recibos/recibo-vista.js';
import { formatearMonto, textoACentavos } from '../../util/dinero.js';
import { cotizacionDeMercado, hayReglaDeRedondeo, monedasDeCobro, precioDeCobro } from './arqueo.js';
import { SerieEscrita } from './serie-escrita.js';
import { useEsperaAprobacion, VentaCobro, type DatosCobro } from './venta-cobro.js';
import './venta.css';

/** El recibo se consulta cada 3 s, hasta 30 s, antes de ofrecer «Reintentar». */
export const MS_ENTRE_CONSULTAS_RECIBO = 3000;
export const CONSULTAS_RECIBO = 10;
/** Por debajo de este ancho el carrito queda debajo de la lista (misma cifra que `venta.css`). */
const ANCHO_DOS_COLUMNAS = 960;

const esPantallaAngosta = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia(`(max-width: ${ANCHO_DOS_COLUMNAS - 0.02}px)`).matches;

export interface LineaUI {
  productoId: string;
  almacenId: UbicacionId;
  cantidad: number;
  series: string[];
}

const ALMACENES: { valor: UbicacionId; texto: string }[] = [
  { valor: 'tienda', texto: 'Tienda' },
  { valor: 'deposito-1', texto: 'Depósito 1' },
  { valor: 'deposito-2', texto: 'Depósito 2' },
];

function SelectorSeries({ producto, almacenId, enConteo, elegidas, alCambiar }: { producto: ProductoPanel; almacenId: UbicacionId; enConteo: boolean; elegidas: string[]; alCambiar: (s: string[]) => void }): JSX.Element {
  // Almacén en conteo para quien no es administrador: no se lista lo disponible (su cantidad sería el stock); se escribe o escanea.
  if (enConteo) return <SerieEscrita productoId={producto.id} almacenId={almacenId} elegidas={elegidas} alCambiar={alCambiar} />;
  return <SelectorSeriesLista producto={producto} almacenId={almacenId} elegidas={elegidas} alCambiar={alCambiar} />;
}

function SelectorSeriesLista({ producto, almacenId, elegidas, alCambiar }: { producto: ProductoPanel; almacenId: UbicacionId; elegidas: string[]; alCambiar: (s: string[]) => void }): JSX.Element {
  const { api } = useApp();
  const s = useCarga(() => api.llamar('listarSeries', { productoId: producto.id, ubicacionId: almacenId, soloDisponibles: true }), [producto.id, almacenId]);
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

const NOMBRE_EN_TEXTO: Readonly<Record<string, string>> = { USD: 'dólares', BOB: 'bolivianos', ARS: 'pesos argentinos' };
const enTexto = (m: string): string => NOMBRE_EN_TEXTO[m] ?? m;

function Cotizacion({ cot, mercado, moneda }: { cot: CotizacionesVigentes; mercado: MercadoDeclarado; moneda: string }): JSX.Element | null {
  if (!hayReglaDeRedondeo(mercado) && moneda === mercado.monedaVenta) {
    return <Alerta>Falta la regla de redondeo de {mercado.monedaVenta} para este comercio: no se muestran precios en esa moneda. Avise al administrador.</Alerta>;
  }
  if (!mercado.tieneTipoCambio) return null;
  if (moneda === mercado.monedaBase) return <p class="texto-suave">Precios en {enTexto(moneda)}: sin conversión.</p>;
  const c = cotizacionDeMercado(cot, mercado.id);
  if (c === null) return <Alerta>No hay una cotización utilizable para este mercado. Venda en {enTexto(mercado.monedaBase)} o avise al administrador.</Alerta>;
  return (
    <p class="texto-suave" data-prueba="cotizacion">
      Cotización: 1 {mercado.monedaBase} = {String(c.valor).replace('.', ',')} {mercado.monedaVenta} · {c.fuente} · {c.fecha}
      {c.estado === 'ultimo_verificado' ? ' · último valor verificado (la fuente no lo renueva)' : ' · vigente'}
    </p>
  );
}

interface BorradorVenta {
  mercadoId: string;
  moneda: string;
  lineas: LineaUI[];
  descTexto: string;
  descMotivo: string;
  aprobacionId: string;
  cliente: string;
  telefono: string;
  /** Identificador del cobro: se renueva solo al descartar el borrador (venta confirmada o «Nueva venta»). */
  requestId: string;
  solicitadaId: string | null;
}

export function VentaTerminal({ turno, alCambiar }: { turno: TurnoPos; alCambiar: () => void }): JSX.Element {
  const comercial = useConfiguracionComercial();
  if (comercial.estado === 'cargando') return <Cargando />;
  if (comercial.estado === 'error') return <Alerta>{comercial.mensaje}</Alerta>;
  if (comercial.comercial.mercados.length === 0) return <Alerta>El comercio no tiene mercados declarados.</Alerta>;
  return <TerminalLista turno={turno} alCambiar={alCambiar} mercados={comercial.comercial.mercados} />;
}

function TerminalLista({ turno, alCambiar, mercados }: { turno: TurnoPos; alCambiar: () => void; mercados: readonly MercadoDeclarado[] }): JSX.Element {
  const { api, usuario } = useApp();
  const datos = useCarga(
    async () => ({
      productos: await api.llamar('listarProductos', {}),
      cot: await api.llamar('cotizacionesVigentes', {}),
      config: await api.llamar('leerConfigPos', {}),
      ventas: await api.llamar('listarVentas', { turnoId: turno.turnoId }),
    }),
    [turno.turnoId],
  );
  const [busqueda, setBusqueda] = useState('');
  const [categoria, setCategoria] = useState('');
  // Mercado y moneda iniciales: el primer mercado declarado y su moneda de venta.
  // La venta en curso sobrevive a ir a otra pestaña y volver (sin guardia: se conserva sola). «Nueva venta» la descarta.
  const borrador = useBorrador<BorradorVenta>(`venta:carrito:${turno.turnoId}`, {
    mercadoId: mercados[0]?.id ?? '',
    moneda: mercados[0]?.monedaVenta ?? '',
    lineas: [],
    descTexto: '',
    descMotivo: '',
    aprobacionId: '',
    cliente: '',
    telefono: '',
    requestId: nuevoId(),
    solicitadaId: null,
  });
  const { mercadoId, moneda, lineas, descTexto, descMotivo, aprobacionId, cliente, telefono } = borrador.valor;
  const cambiar = (c: Partial<BorradorVenta>): void => borrador.poner((p) => ({ ...p, ...c }));
  const setMercadoId = (v: string): void => cambiar({ mercadoId: v });
  const setMoneda = (v: string): void => cambiar({ moneda: v });
  const setLineas = (v: LineaUI[] | ((p: LineaUI[]) => LineaUI[])): void => borrador.poner((p) => ({ ...p, lineas: typeof v === 'function' ? v(p.lineas) : v }));
  const setDescTexto = (v: string): void => cambiar({ descTexto: v });
  const setDescMotivo = (v: string): void => cambiar({ descMotivo: v });
  const setAprobacionId = (v: string): void => cambiar({ aprobacionId: v });
  const setCliente = (v: string): void => cambiar({ cliente: v });
  const setTelefono = (v: string): void => cambiar({ telefono: v });
  const [verSeries, setVerSeries] = useState<string | null>(null);
  const [paso, setPaso] = useState<'carrito' | 'cobro'>('carrito');
  const [recibo, setRecibo] = useState<{ recibo: Recibo | null; ventaId: string; repetida: boolean } | null>(null);
  const solicitud = useAccion();
  const avisos = useAvisos();
  const solicitadaId = borrador.valor.solicitadaId;
  const setSolicitadaId = (v: string | null): void => cambiar({ solicitadaId: v });
  const aprobs = useCarga(() => api.llamar('listarAprobaciones', {}), [solicitadaId, paso]);
  // Solo se espera la solicitud que esta pantalla acaba de pedir; vive en el borrador y se va con él.
  const espera = useEsperaAprobacion(solicitadaId, aprobs.recargar);
  const refCarrito = useRef<HTMLDivElement>(null);

  // La marca viaja como propiedad de la lista: se lee antes de filtrar o mapear.
  const conteos = marcaDe(datos.datos?.productos)?.conteosAbiertos ?? [];
  const productos = datos.datos?.productos ?? [];
  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);

  if (recibo !== null) {
    return <ReciboFinal ventaId={recibo.ventaId} repetida={recibo.repetida} nuevaVenta={() => { setRecibo(null); borrador.descartar(); setPaso('carrito'); alCambiar(); datos.recargar(); }} />;
  }
  if (datos.cargando) return <Cargando />;
  if (datos.error || !datos.datos) return <ErrorCarga error={datos.error ?? 'Sin datos'} reintentar={datos.recargar} />;
  const { cot, config, ventas } = datos.datos;

  const mercado = mercados.find((m) => m.id === mercadoId) ?? mercados[0];
  if (mercado === undefined) return <Alerta>El comercio no tiene mercados declarados.</Alerta>;
  const monedas = monedasDeCobro(mercado);
  const cambiarMercado = (id: string): void => {
    setMercadoId(id);
    setMoneda(mercados.find((m) => m.id === id)?.monedaVenta ?? '');
  };
  const categorias = [...new Set(productos.map((p) => p.categoria))].sort();
  const q = busqueda.trim().toLowerCase();
  const visibles = productos
    .filter((p) => p.activo)
    .filter((p) => categoria === '' || p.categoria === categoria)
    .filter((p) => q === '' || p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.marca ?? '').toLowerCase().includes(q));
  const vendidos = new Map<string, number>();
  for (const v of ventas) for (const l of v.lineas) vendidos.set(l.productoId, (vendidos.get(l.productoId) ?? 0) + l.cantidad);
  const rapidos = [...productos.filter((p) => p.activo && p.disponible !== false)].sort((a, b) => (vendidos.get(b.id) ?? 0) - (vendidos.get(a.id) ?? 0) || a.nombre.localeCompare(b.nombre)).slice(0, 6);

  const precioDe = (p: ProductoPanel): ReturnType<typeof precioDeCobro> => precioDeCobro(p, mercado, moneda, cot);

  const agregar = (p: ProductoPanel): void => {
    setLineas((ls) => {
      const i = ls.findIndex((l) => l.productoId === p.id && l.almacenId === 'tienda');
      if (i >= 0 && !p.conSerie) return ls.map((l, j) => (j === i ? { ...l, cantidad: l.cantidad + 1 } : l));
      if (i >= 0) return ls;
      return [...ls, { productoId: p.id, almacenId: 'tienda', cantidad: p.conSerie ? 0 : 1, series: [] }];
    });
    if (p.conSerie) setVerSeries(p.id);
    // En pantalla angosta el carrito queda debajo de la lista: sin esto «Agregar» no cambiaría nada a la vista.
    if (esPantallaAngosta()) avisos.info(`Se agregó ${p.nombre} al carrito.`);
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
  const pendiente = (aprobs.datos ?? []).find((a) => a.tipo === 'descuento' && a.estado === 'pendiente' && a.moneda === moneda && a.monto >= monto);
  const rechazada = solicitadaId === null ? undefined : (aprobs.datos ?? []).find((a) => a.aprobacionId === solicitadaId && a.estado === 'rechazada');
  const falta = excede && aprobacionId === '';
  const motivoNoCobrar = ((): string | undefined => {
    if (lineas.length === 0) return 'Agregue al menos un producto al carrito.';
    const sinSerie = lineas.find((l) => porId.get(l.productoId)?.conSerie === true && (l.series.length === 0 || l.series.length !== l.cantidad));
    if (sinSerie !== undefined) return `Elija las series de ${porId.get(sinSerie.productoId)?.nombre ?? 'un producto'}.`;
    if (!lineas.every(lineaValida)) return 'Indique una cantidad de al menos 1 en cada producto.';
    if (!todosConPrecio) return 'Hay productos sin precio en esta moneda: quítelos o cambie la moneda.';
    if (descInvalido) return 'Corrija el descuento: debe ser menor al subtotal y llevar un motivo.';
    if (falta) return 'El descuento necesita la aprobación de un supervisor: solicítela abajo.';
    if (config.mediosHabilitados.length === 0) return 'No hay medios de pago habilitados: avise al administrador.';
    return undefined;
  })();
  const unidades = lineas.reduce((n, l) => n + l.cantidad, 0);

  const pedirAprobacion = (): void => {
    void solicitud.ejecutar(async () => {
      const id = nuevoId();
      await api.llamar('solicitarAprobacion', { aprobacionId: id, solicitud: { tipo: 'descuento', moneda: moneda as Moneda, monto, motivo: descMotivo.trim() } });
      setSolicitadaId(id);
    }, { exito: 'Solicitud enviada al supervisor.', error: 'ambos' });
  };

  if (paso === 'cobro') {
    const cobro: DatosCobro = {
      mercado: mercado.id, moneda, config, total,
      carrito: {
        // El mercado viaja como id declarado por el comercio; el contrato del carrito tipa la moneda con las conocidas y el servidor valida contra lo declarado.
        mercado: mercado.id, moneda: moneda as Moneda,
        lineas: lineas.map((l, i) => ({ productoId: l.productoId, cantidad: l.cantidad, almacenId: l.almacenId, ...(l.series.length > 0 ? { series: l.series } : {}), ...(precios[i]?.tipo === 'precio' ? { precioMostrado: (precios[i] as { centavos: number }).centavos } : {}) })),
        ...(monto > 0 ? { descuento: { monto, motivo: descMotivo.trim() } } : {}),
        ...(cliente.trim() !== '' ? { cliente: { nombre: cliente.trim(), ...(telefono.trim() !== '' ? { telefono: telefono.trim() } : {}) } } : {}),
        totalMostrado: total,
      },
      aprobacionId: excede ? aprobacionId : undefined,
      requestId: borrador.valor.requestId,
      nombreProducto: (id) => porId.get(id)?.nombre,
      nombreAlmacen: (id) => ALMACENES.find((a) => a.valor === id)?.texto,
    };
    // La venta ya está registrada: el borrador se descarta aquí para que no reaparezca al volver a la pestaña.
    return <VentaCobro datos={cobro} volver={() => setPaso('carrito')} alVender={(ventaId, repetida) => { borrador.descartar(); setRecibo({ ventaId, recibo: null, repetida }); }} />;
  }

  return (
    <div>
      <div class="terminal">
      <AvisoConteoAbierto conteos={conteos} />
      <Seccion titulo="Productos">
        <div class="cuadricula">
          <Campo etiqueta="Buscar por nombre, SKU o marca" valor={busqueda} onInput={setBusqueda} nombre="buscar" />
          <Selector etiqueta="Categoría" valor={categoria} onCambio={setCategoria} opciones={[{ valor: '', texto: 'Todas' }, ...categorias.map((c) => ({ valor: c, texto: c }))]} />
          {mercados.length > 1 && <Selector etiqueta="Lista de precios" valor={mercado.id} onCambio={cambiarMercado} opciones={mercados.map((m) => ({ valor: m.id, texto: m.nombre }))} />}
          {monedas.length > 1 && <Selector etiqueta="Moneda de la venta" valor={moneda} onCambio={setMoneda} opciones={monedas.map((m) => ({ valor: m, texto: m }))} />}
        </div>
        <Cotizacion cot={cot} mercado={mercado} moneda={moneda} />
        {rapidos.length > 0 && (
          <div role="group" aria-label="Accesos rápidos" class="fila rapidos">
            {rapidos.map((p) => (
              <button key={p.id} type="button" class="boton boton-secundario boton-chico" onClick={() => agregar(p)}>
                {p.nombre}
              </button>
            ))}
          </div>
        )}
        {visibles.length === 0 ? (
          <Vacio titulo="No hay productos que coincidan" detalle="Pruebe con otra búsqueda o categoría." />
        ) : (
          <ul class="lista-productos">
            {visibles.map((p) => {
              const pr = precioDe(p);
              return (
                <li key={p.id} class="producto-tarjeta">
                  <div>
                    <strong>{p.nombre}</strong>
                    <div class="texto-suave">
                      {p.categoria}
                      {p.marca ? ` · ${p.marca}` : ''} · Tienda: {p.existencias.tienda === null ? <ExistenciaOculta /> : p.existencias.tienda}
                      {p.conSerie ? ' · con serie' : ''}
                    </div>
                    <div class="precio" data-prueba="precio">
                      {pr.tipo === 'precio' ? formatearMonto(pr.centavos, pr.moneda) : pr.tipo === 'sin_precio' ? 'A consultar' : pr.tipo === 'sin_redondeo' ? 'Sin regla de redondeo' : 'Sin cotización'}
                    </div>
                  </div>
                  <Boton chico variante="secundario" onClick={() => agregar(p)} deshabilitado={pr.tipo !== 'precio'} etiqueta={`Agregar ${p.nombre}`}>
                    Agregar
                  </Boton>
                </li>
              );
            })}
          </ul>
        )}
      </Seccion>

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
                    <SelectorSeries producto={p} almacenId={l.almacenId} enConteo={conteos.some((c) => c.ubicacionId === l.almacenId)} elegidas={l.series} alCambiar={(s) => setLineas(lineas.map((x, j) => (j === i ? { ...x, series: s, cantidad: s.length } : x)))} />
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
                <Selector
                  etiqueta="Aprobación a usar"
                  valor={aprobacionId}
                  onCambio={setAprobacionId}
                  opciones={[{ valor: '', texto: 'Elija una aprobación' }, ...aprobadas.map((a) => ({ valor: a.aprobacionId, texto: `Hasta ${formatearMonto(a.monto, a.moneda)} · ${a.motivo}` }))]}
                />
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
            <Campo etiqueta="Cliente (opcional)" valor={cliente} onInput={setCliente} />
            <Campo etiqueta="Teléfono del cliente (opcional)" valor={telefono} onInput={setTelefono} inputMode="numeric" />
          </div>
        </div>

        <dl class="totales">
          <div><dt>Subtotal</dt><dd>{formatearMonto(subtotal, moneda)}</dd></div>
          {monto > 0 && !descInvalido && <div><dt>Descuento</dt><dd>-{formatearMonto(monto, moneda)}</dd></div>}
          <div class="total"><dt>Total</dt><dd data-prueba="total">{formatearMonto(total, moneda)}</dd></div>
        </dl>
        <Boton onClick={() => setPaso('cobro')} motivo={motivoNoCobrar}>
          Cobrar
        </Boton>
      </Seccion>
      </div>
      </div>
      {unidades > 0 && (
        <div class="venta-barra" role="region" aria-label="Resumen del carrito">
          <span data-prueba="barra-resumen">
            {unidades} {unidades === 1 ? 'producto' : 'productos'} · {formatearMonto(total, moneda)}
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
