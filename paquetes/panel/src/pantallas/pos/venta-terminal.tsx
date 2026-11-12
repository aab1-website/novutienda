import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { nuevoId } from '../../api/cliente.js';
import { marcaDe } from '../../api/marca.js';
import type { AprobacionPos, CotizacionesVigentes, Mercado, Moneda, ProductoPanel, Recibo, TurnoPos, UbicacionId } from '../../api/tipos.js';
import { Alerta, Boton, Campo, Cargando, Casilla, ErrorCarga, Selector, Seccion, Vacio } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { AvisoConteoAbierto, ExistenciaOculta, TEXTO_OCULTO } from '../../ui/existencia.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { AccionesRecibo, ReciboVista } from '../recibos/recibo-vista.js';
import { formatearMonto, textoACentavos } from '../../util/dinero.js';
import { MONEDA_DE_MERCADO, precioDeVenta } from '../../util/precio.js';
import { SerieEscrita } from './serie-escrita.js';
import { VentaCobro, type DatosCobro } from './venta-cobro.js';

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

function Cotizacion({ cot, mercado, moneda }: { cot: CotizacionesVigentes; mercado: Mercado; moneda: Moneda }): JSX.Element {
  if (moneda === 'USD') return <p class="texto-suave">Precios en dólares: sin conversión.</p>;
  const c = cot[mercado];
  if (c === null) return <Alerta>No hay una cotización utilizable para este mercado. Venda en dólares o avise al administrador.</Alerta>;
  return (
    <p class="texto-suave" data-prueba="cotizacion">
      Cotización: 1 USD = {String(c.valor).replace('.', ',')} {MONEDA_DE_MERCADO[mercado]} · {c.fuente} · {c.fecha}
      {c.estado === 'ultimo_verificado' ? ' · último valor verificado (la fuente no lo renueva)' : ' · vigente'}
    </p>
  );
}

export function VentaTerminal({ turno, alCambiar }: { turno: TurnoPos; alCambiar: () => void }): JSX.Element {
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
  const [mercado, setMercado] = useState<Mercado>('BO');
  const [moneda, setMoneda] = useState<Moneda>('BOB');
  const [lineas, setLineas] = useState<LineaUI[]>([]);
  const [verSeries, setVerSeries] = useState<string | null>(null);
  const [descTexto, setDescTexto] = useState('');
  const [descMotivo, setDescMotivo] = useState('');
  const [aprobacionId, setAprobacionId] = useState('');
  const [cliente, setCliente] = useState('');
  const [telefono, setTelefono] = useState('');
  const [paso, setPaso] = useState<'carrito' | 'cobro'>('carrito');
  const [recibo, setRecibo] = useState<{ recibo: Recibo | null; ventaId: string } | null>(null);
  const solicitud = useAccion();
  const [solicitadaId, setSolicitadaId] = useState<string | null>(null);
  const aprobs = useCarga(() => api.llamar('listarAprobaciones', {}), [solicitadaId, paso]);

  // La marca viaja como propiedad de la lista: se lee antes de filtrar o mapear.
  const conteos = marcaDe(datos.datos?.productos)?.conteosAbiertos ?? [];
  const productos = datos.datos?.productos ?? [];
  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);

  if (recibo !== null) {
    return <ReciboFinal ventaId={recibo.ventaId} nuevaVenta={() => { setRecibo(null); setLineas([]); setDescTexto(''); setDescMotivo(''); setAprobacionId(''); setCliente(''); setTelefono(''); setPaso('carrito'); alCambiar(); datos.recargar(); }} />;
  }
  if (datos.cargando) return <Cargando />;
  if (datos.error || !datos.datos) return <ErrorCarga error={datos.error ?? 'Sin datos'} reintentar={datos.recargar} />;
  const { cot, config, ventas } = datos.datos;

  const monedas: Moneda[] = [MONEDA_DE_MERCADO[mercado], 'USD'];
  const cambiarMercado = (m: Mercado): void => {
    setMercado(m);
    setMoneda(MONEDA_DE_MERCADO[m]);
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

  const precioDe = (p: ProductoPanel): ReturnType<typeof precioDeVenta> =>
    precioDeVenta(mercado === 'BO' ? p.precioUSD.bo : p.precioUSD.ar, mercado, moneda, cot[mercado]);

  const agregar = (p: ProductoPanel): void => {
    setLineas((ls) => {
      const i = ls.findIndex((l) => l.productoId === p.id && l.almacenId === 'tienda');
      if (i >= 0 && !p.conSerie) return ls.map((l, j) => (j === i ? { ...l, cantidad: l.cantidad + 1 } : l));
      if (i >= 0) return ls;
      return [...ls, { productoId: p.id, almacenId: 'tienda', cantidad: p.conSerie ? 0 : 1, series: [] }];
    });
    if (p.conSerie) setVerSeries(p.id);
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
  const falta = excede && aprobacionId === '';
  const listo = lineas.length > 0 && lineas.every(lineaValida) && todosConPrecio && !descInvalido && !falta && config.mediosHabilitados.length > 0;

  const pedirAprobacion = (): void => {
    void solicitud.ejecutar(async () => {
      const id = nuevoId();
      await api.llamar('solicitarAprobacion', { aprobacionId: id, solicitud: { tipo: 'descuento', moneda, monto, motivo: descMotivo.trim() } });
      setSolicitadaId(id);
    });
  };

  if (paso === 'cobro') {
    const cobro: DatosCobro = {
      mercado, moneda, config, total,
      carrito: {
        mercado, moneda,
        lineas: lineas.map((l, i) => ({ productoId: l.productoId, cantidad: l.cantidad, almacenId: l.almacenId, ...(l.series.length > 0 ? { series: l.series } : {}), ...(precios[i]?.tipo === 'precio' ? { precioMostrado: (precios[i] as { centavos: number }).centavos } : {}) })),
        ...(monto > 0 ? { descuento: { monto, motivo: descMotivo.trim() } } : {}),
        ...(cliente.trim() !== '' ? { cliente: { nombre: cliente.trim(), ...(telefono.trim() !== '' ? { telefono: telefono.trim() } : {}) } } : {}),
        totalMostrado: total,
      },
      aprobacionId: excede ? aprobacionId : undefined,
    };
    return <VentaCobro datos={cobro} volver={() => setPaso('carrito')} alVender={(ventaId) => setRecibo({ ventaId, recibo: null })} />;
  }

  return (
    <div class="terminal">
      <AvisoConteoAbierto conteos={conteos} />
      <Seccion titulo="Productos">
        <div class="cuadricula">
          <Campo etiqueta="Buscar por nombre, SKU o marca" valor={busqueda} onInput={setBusqueda} nombre="buscar" />
          <Selector etiqueta="Categoría" valor={categoria} onCambio={setCategoria} opciones={[{ valor: '', texto: 'Todas' }, ...categorias.map((c) => ({ valor: c, texto: c }))]} />
          <Selector etiqueta="Lista de precios" valor={mercado} onCambio={(v) => cambiarMercado(v as Mercado)} opciones={[{ valor: 'BO', texto: 'Bolivia' }, { valor: 'AR', texto: 'Argentina' }]} />
          <Selector etiqueta="Moneda de la venta" valor={moneda} onCambio={(v) => setMoneda(v as Moneda)} opciones={monedas.map((m) => ({ valor: m, texto: m }))} />
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
                      {pr.tipo === 'precio' ? formatearMonto(pr.centavos, pr.moneda) : pr.tipo === 'sin_precio' ? 'A consultar' : 'Sin cotización'}
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
                <Alerta tipo="info">Solicitud enviada. Espere la aprobación del supervisor y actualice.</Alerta>
              ) : (
                <Boton chico variante="secundario" onClick={pedirAprobacion} ocupado={solicitud.ocupado}>
                  Solicitar aprobación
                </Boton>
              )}
              {pendiente && (
                <Boton chico variante="secundario" onClick={aprobs.recargar}>
                  Actualizar aprobaciones
                </Boton>
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
        <Boton onClick={() => setPaso('cobro')} deshabilitado={!listo}>
          Cobrar
        </Boton>
      </Seccion>
    </div>
  );
}

function ReciboFinal({ ventaId, nuevaVenta }: { ventaId: string; nuevaVenta: () => void }): JSX.Element {
  const { api, usuario } = useApp();
  // El módulo de recibos emite el comprobante al consumir el evento; puede tardar unos segundos.
  const r = useCarga(
    async () => {
      for (let i = 0; i < 5; i++) {
        const x = await api.llamar('obtenerRecibo', { ventaId });
        if (x !== null) return x;
        await new Promise((res) => setTimeout(res, 800));
      }
      return null;
    },
    [ventaId],
  );
  return (
    <Seccion titulo="Venta registrada" acciones={<Boton onClick={nuevaVenta}>Nueva venta</Boton>}>
      <Alerta tipo="ok">La venta se registró correctamente.</Alerta>
      {r.cargando && <Cargando texto="Preparando el recibo…" />}
      {r.error && <ErrorCarga error={r.error} reintentar={r.recargar} />}
      {!r.cargando && r.datos === null && <Alerta tipo="info">El recibo todavía no está listo. Búsquelo en «Mis recibos» en unos instantes.</Alerta>}
      {r.datos && (
        <>
          <AccionesRecibo recibo={r.datos} alCambiar={r.recargar} />
          <ReciboVista recibo={r.datos} registradoPor={{ qr: usuario.correo }} />
        </>
      )}
    </Seccion>
  );
}
