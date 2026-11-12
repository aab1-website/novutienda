import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { nuevoId } from '../../api/cliente.js';
import type { ProductoPanel, TipoMovimiento, UbicacionId } from '../../api/tipos.js';
import { Alerta, Boton, BotonConfirmado, Campo, Cargando, Casilla, ErrorCarga, Selector, Seccion, Vacio, fechaHora } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { aCsv, descargarTexto } from '../../util/csv.js';
import { separar } from './movimientos-resumen.js';
import { nombreAlmacen, nombreTipo } from './nombres.js';

const ALMACENES = [{ valor: 'tienda', texto: 'Tienda' }, { valor: 'deposito-1', texto: 'Depósito 1' }, { valor: 'deposito-2', texto: 'Depósito 2' }];

export function useProductos(): { lista: ProductoPanel[]; cargando: boolean; error: string | null; recargar: () => void } {
  const { api } = useApp();
  const c = useCarga(() => api.llamar('listarProductos', {}), []);
  return { lista: c.datos ? [...c.datos] : [], cargando: c.cargando, error: c.error, recargar: c.recargar };
}


export function Conteo(): JSX.Element {
  const { api } = useApp();
  const conteos = useCarga(() => api.llamar('listarConteos', {}), []);
  const prod = useProductos();
  const accion = useAccion();
  const [ubicacion, setUbicacion] = useState<UbicacionId>('tienda');
  const [activo, setActivo] = useState<string | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  if (conteos.cargando || prod.cargando) return <Cargando />;
  if (conteos.error || !conteos.datos) return <ErrorCarga error={conteos.error ?? 'Sin datos'} reintentar={conteos.recargar} />;
  const abierto = conteos.datos.find((c) => c.conteoId === activo) ?? conteos.datos.find((c) => c.estado === 'abierto');
  const nombre = (id: string): string => prod.lista.find((p) => p.id === id)?.nombre ?? id;

  const abrir = (): void => {
    void accion.ejecutar(async () => {
      const conteoId = `conteo-${nuevoId().slice(0, 8)}`;
      await api.llamar('abrirConteo', { operacionId: nuevoId(), conteoId, ubicacionId: ubicacion });
      setActivo(conteoId);
      conteos.recargar();
    });
  };
  const registrar = (conteoId: string, p: ProductoPanel): void => {
    const t = valores[p.id] ?? '';
    void accion.ejecutar(async () => {
      if (p.conSerie) {
        const series = separar(t);
        await api.llamar('registrarLineaConteo', { operacionId: nuevoId(), conteoId, productoId: p.id, series });
      } else {
        await api.llamar('registrarLineaConteo', { operacionId: nuevoId(), conteoId, productoId: p.id, contado: Math.floor(Number(t)) });
      }
      setMsg(`Registrado: ${p.nombre}.`);
      conteos.recargar();
    });
  };
  const cerrar = (conteoId: string): void => {
    void accion.ejecutar(async () => {
      const r = await api.llamar('cerrarConteo', { operacionId: nuevoId(), conteoId });
      const avisos = Array.isArray(r.resultado['avisos']) ? (r.resultado['avisos'] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
      setMsg(`Conteo cerrado y firmado. Los faltantes quedaron como mermas por resolver; los sobrantes se ingresaron.${avisos.length > 0 ? ` Atención: ${avisos.join(' ')}` : ''}`);
      setActivo(null);
      conteos.recargar();
      prod.recargar();
    });
  };

  return (
    <div>
      <Seccion titulo="Conteo ciego">
        <p class="texto-suave">Quien cuenta no ve las existencias del sistema. Al cerrar, el servidor compara y registra las diferencias.</p>
        {abierto === undefined || abierto.estado === 'cerrado' ? (
          <div class="fila fila-alinear">
            <Selector etiqueta="Almacén a contar" valor={ubicacion} onCambio={(v) => setUbicacion(v as UbicacionId)} opciones={ALMACENES} />
            <Boton onClick={abrir} ocupado={accion.ocupado}>Abrir conteo</Boton>
          </div>
        ) : (
          <div>
            <p>Conteo abierto en <strong>{abierto.ubicacionId}</strong>. Escriba lo que cuenta de cada producto (para productos con serie, escriba las series).</p>
            <table class="tabla">
              <caption class="solo-lectores">Productos a contar</caption>
              <thead><tr><th scope="col">Producto</th><th scope="col">Contado</th><th scope="col"><span class="solo-lectores">Acción</span></th></tr></thead>
              <tbody>
                {prod.lista.filter((p) => p.stockTotal !== undefined).map((p) => {
                  const hecha = abierto.lineas.find((l) => l.productoId === p.id);
                  return (
                    <tr key={p.id}>
                      <th scope="row">{p.nombre}{hecha ? <span class="texto-suave"> · contado: {hecha.contado}</span> : null}</th>
                      <td><Campo etiqueta={p.conSerie ? `Series de ${p.nombre}` : `Cantidad de ${p.nombre}`} valor={valores[p.id] ?? ''} onInput={(v) => setValores({ ...valores, [p.id]: v })} inputMode={p.conSerie ? 'text' : 'numeric'} /></td>
                      <td><Boton chico variante="secundario" onClick={() => registrar(abierto.conteoId, p)} deshabilitado={(valores[p.id] ?? '').trim() === ''}>Registrar</Boton></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <BotonConfirmado texto="Cerrar y firmar el conteo" pregunta="¿Cerrar el conteo? Se compararán los datos con las existencias del sistema y se firmará con su usuario." textoConfirmar="Sí, cerrar y firmar" onConfirmar={() => cerrar(abierto.conteoId)} />
          </div>
        )}
        {accion.error && <Alerta>{accion.error}</Alerta>}
        {msg && <Alerta tipo="ok">{msg}</Alerta>}
      </Seccion>
      <Seccion titulo="Conteos anteriores">
        {conteos.datos.filter((c) => c.estado === 'cerrado').length === 0 && <Vacio titulo="Todavía no hay conteos cerrados" />}
        {conteos.datos.filter((c) => c.estado === 'cerrado').map((c) => (
          <div key={c.conteoId} class="tarjeta-interna">
            <strong>{c.ubicacionId}</strong> · {fechaHora(c.fecha)}
            {c.resultado && (
              <table class="tabla">
                <caption class="solo-lectores">Resultado del conteo</caption>
                <thead><tr><th scope="col">Producto</th><th scope="col" class="num">Sistema</th><th scope="col" class="num">Contado</th><th scope="col" class="num">Diferencia</th></tr></thead>
                <tbody>{c.resultado.map((r) => <tr key={r.productoId}><th scope="row">{nombre(r.productoId)}</th><td class="num">{r.teorico}</td><td class="num">{r.contado}</td><td class={`num ${r.diferencia < 0 ? 'texto-error' : ''}`}>{r.diferencia}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        ))}
      </Seccion>
    </div>
  );
}

export function Series(): JSX.Element {
  const { api } = useApp();
  const [q, setQ] = useState('');
  const [buscar, setBuscar] = useState('');
  const r = useCarga(() => (buscar === '' ? Promise.resolve([]) : api.llamar('buscarSerie', { serie: buscar })), [buscar]);
  const prod = useProductos();
  return (
    <Seccion titulo="Buscar por número de serie">
      <form class="formulario" role="search" onSubmit={(e) => { e.preventDefault(); setBuscar(q.trim()); }} noValidate>
        <Campo etiqueta="Número de serie (o parte)" valor={q} onInput={setQ} />
        <Boton tipo="submit" deshabilitado={q.trim() === ''}>Buscar</Boton>
      </form>
      {r.error && <ErrorCarga error={r.error} reintentar={r.recargar} />}
      {buscar !== '' && r.datos && r.datos.length === 0 && <Vacio titulo="No se encontró esa serie" />}
      {r.datos && r.datos.length > 0 && (
        <table class="tabla">
          <caption class="solo-lectores">Resultado de la búsqueda por serie</caption>
          <thead><tr><th scope="col">Serie</th><th scope="col">Producto</th><th scope="col">Estado</th><th scope="col">Almacén</th><th scope="col">Venta</th><th scope="col">Garantía hasta</th></tr></thead>
          <tbody>
            {r.datos.map((u) => (
              <tr key={`${u.productoId}-${u.serie}`}>
                <th scope="row">{u.serie}</th>
                <td>{prod.lista.find((p) => p.id === u.productoId)?.nombre ?? u.productoId}</td>
                <td>{u.estado === 'disponible' ? 'Disponible' : u.estado === 'vendida' ? 'Vendida' : 'Merma'}</td>
                <td>{u.ubicacionId}</td>
                <td>{u.ventaRef ?? '—'}</td>
                <td>{u.garantiaHasta ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Seccion>
  );
}

const TIPOS: { valor: string; texto: string }[] = [
  { valor: '', texto: 'Todos' }, { valor: 'ingreso', texto: 'Ingreso' }, { valor: 'traspaso', texto: 'Traspaso' }, { valor: 'ajuste', texto: 'Ajuste' },
  { valor: 'venta', texto: 'Venta' }, { valor: 'anulacion', texto: 'Anulación' }, { valor: 'merma', texto: 'Merma' }, { valor: 'conteo', texto: 'Conteo' }, { valor: 'pedido', texto: 'Pedido' },
];

export function TablaMovimientos({ movs, productos }: { movs: readonly import('../../api/tipos.js').MovimientoVista[]; productos: ProductoPanel[] }): JSX.Element {
  return (
    <table class="tabla">
      <caption class="solo-lectores">Movimientos de inventario</caption>
      <thead><tr><th scope="col">Fecha</th><th scope="col">Tipo</th><th scope="col">Producto</th><th scope="col">Almacén</th><th scope="col" class="num">Cantidad</th><th scope="col">Usuario</th></tr></thead>
      <tbody>
        {movs.map((m) => (
          <tr key={m.id}>
            <td>{fechaHora(m.fecha)}</td><td>{nombreTipo(m.tipo)}</td><td>{productos.find((p) => p.id === m.productoId)?.nombre ?? m.productoId}</td><td>{nombreAlmacen(m.ubicacionId)}</td>
            <td class="num">{m.delta > 0 ? `+${m.delta}` : m.delta}</td><td>{m.por} ({m.rol})</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Registro(): JSX.Element {
  const { api } = useApp();
  const prod = useProductos();
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [tipo, setTipo] = useState('');
  const [productoId, setProductoId] = useState('');
  const [filtro, setFiltro] = useState({});
  const r = useCarga(() => api.llamar('listarMovimientos', filtro), [filtro]);
  const exportar = (): void => {
    descargarTexto('movimientos-inventario.csv', aCsv(['fecha', 'tipo', 'productoId', 'almacen', 'cantidad', 'saldo', 'usuario', 'rol', 'motivo'], (r.datos ?? []).map((m) => [m.fecha, m.tipo, m.productoId, m.ubicacionId, m.delta, m.saldoUbicacion, m.por, m.rol, m.motivo])));
  };
  return (
    <Seccion titulo="Registro de acciones">
      <form class="formulario" role="search" onSubmit={(e) => { e.preventDefault(); setFiltro({ ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}), ...(tipo ? { tipo: tipo as TipoMovimiento } : {}), ...(productoId ? { productoId } : {}) }); }} noValidate>
        <div class="cuadricula">
          <Campo etiqueta="Desde" tipo="date" valor={desde} onInput={setDesde} />
          <Campo etiqueta="Hasta" tipo="date" valor={hasta} onInput={setHasta} />
          <Selector etiqueta="Tipo" valor={tipo} onCambio={setTipo} opciones={TIPOS} />
          <Selector etiqueta="Producto" valor={productoId} onCambio={setProductoId} opciones={[{ valor: '', texto: 'Todos' }, ...prod.lista.map((p) => ({ valor: p.id, texto: p.nombre }))]} />
        </div>
        <div class="fila">
          <Boton tipo="submit">Filtrar</Boton>
          <Boton variante="secundario" onClick={exportar} deshabilitado={!r.datos?.length}>Exportar CSV</Boton>
        </div>
      </form>
      {r.cargando && <Cargando />}
      {r.error && <ErrorCarga error={r.error} reintentar={r.recargar} />}
      {r.datos && r.datos.length === 0 && <Vacio titulo="No hay movimientos con esos filtros" />}
      {r.datos && r.datos.length > 0 && <TablaMovimientos movs={r.datos} productos={prod.lista} />}
    </Seccion>
  );
}

export function ImportarExportar(): JSX.Element {
  const { api, usuario } = useApp();
  const accion = useAccion();
  const [inicial, setInicial] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const exportar = (): void => {
    void accion.ejecutar(async () => {
      const { csv } = await api.llamar('exportarProductosCsv', {});
      descargarTexto('productos.csv', csv);
      setMsg('Archivo exportado.');
    });
  };
  const importar = (e: Event): void => {
    const input = e.currentTarget as HTMLInputElement;
    const archivo = input.files?.[0];
    if (archivo === undefined) return;
    void accion.ejecutar(async () => {
      const csv = await archivo.text();
      const r = await api.llamar('importarProductosCsv', { operacionId: nuevoId(), csv, cargaInicial: inicial });
      setMsg(`Importación terminada: ${String(r.resultado['creados'] ?? 0)} productos creados.`);
    });
    input.value = '';
  };
  return (
    <Seccion titulo="Importar y exportar productos (CSV)">
      <p class="texto-suave">El CSV no modifica el stock, salvo en la carga inicial. Las celdas que empiezan con = + - @ se neutralizan para que la planilla no las lea como fórmula.</p>
      <div class="fila">
        <Boton variante="secundario" onClick={exportar} ocupado={accion.ocupado}>Exportar productos</Boton>
      </div>
      {usuario.rol === 'adm' && (
        <div class="formulario">
          <Casilla etiqueta="Es la carga inicial (permite columnas de stock)" marcado={inicial} onCambio={setInicial} />
          <div class="campo">
            <label for="archivo-csv">Archivo CSV a importar</label>
            <input id="archivo-csv" type="file" accept=".csv,text/csv" onChange={importar} />
          </div>
        </div>
      )}
      {accion.error && <Alerta>{accion.error}</Alerta>}
      {msg && <Alerta tipo="ok">{msg}</Alerta>}
    </Seccion>
  );
}
