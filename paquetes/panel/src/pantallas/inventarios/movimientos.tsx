import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { nuevoId } from '../../api/cliente.js';
import type { ProductoPanel, UbicacionId } from '../../api/tipos.js';
import { useAvisos } from '../../ui/avisos.js';
import { Alerta, Boton, Campo, Cargando, ErrorCarga, Selector, Seccion, Vacio } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { Dialogo } from '../../ui/dialogo.js';
import { enfocarPrimerError } from '../../ui/formulario.js';
import { useBorrador, useCambiosSinGuardar } from '../../ui/guardia.js';
import { useAccion, useCarga, type Accion } from '../../ui/hooks.js';
import { SelectorBuscable } from '../../ui/selector-buscable.js';
import { TablaMovimientos, useProductos } from './inventario-ops.js';
import {
  claveLinea, haySeQuedan, leerDiferencia, MAX_LINEAS, resumenAjuste, resumenIngreso, resumenTraspaso, revisarAjuste, revisarLineas, type FilaLinea, type LecturaExistencia, type Resumen,
} from './movimientos-resumen.js';
import { nombreAlmacen, OPCIONES_ALMACEN } from './nombres.js';
import './inventario.css';

const filaVacia = (): FilaLinea => ({ id: nuevoId(), productoId: '', cantidad: '', series: '' });
const lineaSucia = (f: FilaLinea): boolean => f.productoId !== '' || f.cantidad.trim() !== '' || f.series.trim() !== '';

/** Producto elegido de una lista con búsqueda, sin valor por omisión (nada queda elegido hasta que la persona elige). */
export function SelectorProducto(p: {
  productos: readonly ProductoPanel[];
  valor: string;
  onCambio: (id: string) => void;
  error?: string | undefined;
  etiqueta?: string;
  ayuda?: string | undefined;
}): JSX.Element {
  return (
    <SelectorBuscable
      etiqueta={p.etiqueta ?? 'Producto'}
      requerido
      valor={p.valor === '' ? null : p.valor}
      onCambio={p.onCambio}
      error={p.error}
      ayuda={p.ayuda}
      opciones={p.productos.map((x) => ({ valor: x.id, texto: x.nombre, detalle: `${x.sku}${x.conSerie ? ' · con serie' : ''}` }))}
    />
  );
}

/** Un identificador de operación por intento: el mismo mientras los datos no cambien (un reintento no duplica). */
function useIdDeOperacion(): { idPara: (firma: string) => string; liberar: () => void } {
  const actual = useRef<{ firma: string; id: string } | null>(null);
  return {
    idPara: (firma) => {
      if (actual.current === null || actual.current.firma !== firma) actual.current = { firma, id: nuevoId() };
      return actual.current.id;
    },
    liberar: () => {
      actual.current = null;
    },
  };
}

/** Piezas comunes de ingreso, traspaso y ajuste: revisar, confirmar, enviar, guardia y foco al primer error. */
function useEnvio(clave: string, sucio: boolean) {
  const accion = useAccion();
  const avisos = useAvisos();
  const ids = useIdDeOperacion();
  const { marcarGuardado } = useCambiosSinGuardar(sucio, [clave]);
  const [intento, setIntento] = useState(false);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [pideFoco, setPideFoco] = useState(0);
  const formulario = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (pideFoco > 0 && formulario.current !== null) enfocarPrimerError(formulario.current);
  }, [pideFoco]);
  return { accion, avisos, ids, marcarGuardado, intento, setIntento, resumen, setResumen, pideFoco, pedirFoco: () => setPideFoco((n) => n + 1), formulario };
}

function Confirmacion({ resumen, accion, alConfirmar, alVolver, leyendo = false }: { resumen: Resumen; accion: Accion; alConfirmar: () => void; alVolver: () => void; leyendo?: boolean }): JSX.Element {
  return (
    <Dialogo
      variante="centro"
      titulo={resumen.titulo}
      descripcion="Revise antes de confirmar. Esto no se deshace desde aquí."
      foco="seguro"
      onCerrar={alVolver}
      pie={
        <>
          <button type="button" class="boton boton-secundario" data-seguro onClick={alVolver}>Volver</button>
          <Boton onClick={alConfirmar} ocupado={accion.ocupado || leyendo}>{resumen.confirmar}</Boton>
        </>
      }
    >
      <ul class="lista-simple inv-resumen" data-prueba="resumen-movimiento" aria-busy={leyendo ? 'true' : undefined}>
        {resumen.lineas.map((l) => <li key={l}>{l}</li>)}
      </ul>
      {accion.error !== null && <Alerta>{accion.error}</Alerta>}
    </Dialogo>
  );
}

function LineasProducto({ filas, setFilas, productos, errores, origen }: {
  filas: readonly FilaLinea[];
  setFilas: (f: FilaLinea[]) => void;
  productos: readonly ProductoPanel[];
  errores: Readonly<Record<string, string>>;
  /** En un traspaso, el almacén de salida: la ayuda de la cantidad dice cuánto hay. */
  origen?: UbicacionId | null;
}): JSX.Element {
  return (
    <div class="inv-lineas">
      {filas.map((f, i) => {
        const p = productos.find((x) => x.id === f.productoId);
        const cambiar = (c: Partial<FilaLinea>): void => setFilas(filas.map((x) => (x.id === f.id ? { ...x, ...c } : x)));
        return (
          <fieldset key={f.id} class="fila-pago inv-linea">
            <legend>Línea {i + 1}</legend>
            <div class="cuadricula">
              <SelectorProducto productos={productos} valor={f.productoId} onCambio={(v) => cambiar({ productoId: v })} error={errores[claveLinea(f, 'producto')]} />
              {p?.conSerie ? (
                <Campo etiqueta="Series" valor={f.series} requerido onInput={(v) => cambiar({ series: v })} ayuda="Una por unidad, separadas por coma o espacio." error={errores[claveLinea(f, 'series')]} />
              ) : (
                <Campo
                  etiqueta="Cantidad" valor={f.cantidad} inputMode="numeric" requerido onInput={(v) => cambiar({ cantidad: v })} error={errores[claveLinea(f, 'cantidad')]}
                  ayuda={origen != null && p !== undefined ? `En ${nombreAlmacen(origen)} hay ${String(p.existencias[origen])}.` : undefined}
                />
              )}
            </div>
            {filas.length > 1 && <Boton chico variante="secundario" onClick={() => setFilas(filas.filter((x) => x.id !== f.id))} etiqueta={`Quitar línea ${String(i + 1)}`}>Quitar línea</Boton>}
          </fieldset>
        );
      })}
      {filas.length < MAX_LINEAS && <Boton chico variante="secundario" onClick={() => setFilas([...filas, filaVacia()])}>Agregar línea</Boton>}
    </div>
  );
}

interface EstadoLineas {
  almacen: string;
  destino: string;
  filas: FilaLinea[];
}

export function Ingreso(): JSX.Element {
  const { api } = useApp();
  const prod = useProductos();
  const [inicial] = useState<EstadoLineas>(() => ({ almacen: 'tienda', destino: 'tienda', filas: [filaVacia()] }));
  const clave = 'inventarios.movimiento.ingreso';
  const b = useBorrador<EstadoLineas>(clave, inicial);
  const e = b.valor;
  const sucio = b.hayBorrador && (e.almacen !== 'tienda' || e.filas.some(lineaSucia));
  const s = useEnvio(clave, sucio);
  if (prod.cargando) return <Cargando />;
  if (prod.error) return <ErrorCarga error={prod.error} reintentar={prod.recargar} />;
  const rev = revisarLineas(e.filas, prod.lista);
  const errores = s.intento ? rev.errores : {};
  const almacen = e.almacen as UbicacionId;
  const revisar = (ev: Event): void => {
    ev.preventDefault();
    s.setIntento(true);
    if (rev.lineas === null) s.pedirFoco();
    else s.setResumen(resumenIngreso(rev.lineas, almacen, prod.lista));
  };
  const confirmar = (): void => {
    if (rev.lineas === null) return;
    const lineas = rev.lineas;
    void s.accion.ejecutar(async () => {
      await api.llamar('ingresar', { operacionId: s.ids.idPara(JSON.stringify([almacen, lineas])), ubicacionId: almacen, lineas });
      s.avisos.ok('Ingreso registrado.');
      s.ids.liberar();
      s.marcarGuardado();
      b.descartar();
      s.setIntento(false);
      s.setResumen(null);
      prod.recargar();
    });
  };
  return (
    <Seccion titulo="Ingreso de mercadería">
      <form ref={s.formulario} class="formulario" onSubmit={revisar} noValidate>
        <Selector etiqueta="Almacén de destino" valor={e.almacen} onCambio={(v) => b.poner({ ...e, almacen: v })} opciones={OPCIONES_ALMACEN} />
        <LineasProducto filas={e.filas} setFilas={(filas) => b.poner({ ...e, filas })} productos={prod.lista} errores={errores} />
        <Boton tipo="submit" ocupado={s.accion.ocupado && s.resumen === null}>Registrar ingreso</Boton>
      </form>
      {s.resumen !== null && <Confirmacion resumen={s.resumen} accion={s.accion} alConfirmar={confirmar} alVolver={() => { s.setResumen(null); s.accion.limpiar(); }} />}
    </Seccion>
  );
}

export function Traspaso(): JSX.Element {
  const { api } = useApp();
  const prod = useProductos();
  const movs = useCarga(() => api.llamar('listarMovimientos', { tipo: 'traspaso', limite: 20 }), []);
  const [inicial] = useState<EstadoLineas>(() => ({ almacen: 'deposito-1', destino: 'tienda', filas: [filaVacia()] }));
  const clave = 'inventarios.movimiento.traspaso';
  const b = useBorrador<EstadoLineas>(clave, inicial);
  const e = b.valor;
  const sucio = b.hayBorrador && (e.almacen !== 'deposito-1' || e.destino !== 'tienda' || e.filas.some(lineaSucia));
  const s = useEnvio(clave, sucio);
  if (prod.cargando) return <Cargando />;
  if (prod.error) return <ErrorCarga error={prod.error} reintentar={prod.recargar} />;
  const origen = e.almacen as UbicacionId;
  const destino = e.destino as UbicacionId;
  const rev = revisarLineas(e.filas, prod.lista, origen);
  const errores = s.intento ? rev.errores : {};
  const iguales = origen === destino;
  const revisar = (ev: Event): void => {
    ev.preventDefault();
    s.setIntento(true);
    if (rev.lineas === null || iguales) s.pedirFoco();
    else s.setResumen(resumenTraspaso(rev.lineas, origen, destino, prod.lista));
  };
  const confirmar = (): void => {
    if (rev.lineas === null) return;
    const lineas = rev.lineas;
    void s.accion.ejecutar(async () => {
      await api.llamar('traspasar', { operacionId: s.ids.idPara(JSON.stringify([origen, destino, lineas])), origenId: origen, destinoId: destino, lineas });
      s.avisos.ok('Traspaso registrado: el stock ya está en el almacén de destino.');
      s.ids.liberar();
      s.marcarGuardado();
      b.descartar();
      s.setIntento(false);
      s.setResumen(null);
      prod.recargar();
      movs.recargar();
    });
  };
  return (
    <div>
      <Seccion titulo="Traspaso entre almacenes">
        <form ref={s.formulario} class="formulario" onSubmit={revisar} noValidate>
          <div class="cuadricula">
            <Selector etiqueta="Origen" valor={e.almacen} onCambio={(v) => b.poner({ ...e, almacen: v })} opciones={OPCIONES_ALMACEN} />
            <Selector etiqueta="Destino" valor={e.destino} onCambio={(v) => b.poner({ ...e, destino: v })} opciones={OPCIONES_ALMACEN} error={s.intento && iguales ? 'El origen y el destino deben ser distintos.' : undefined} />
          </div>
          <LineasProducto filas={e.filas} setFilas={(filas) => b.poner({ ...e, filas })} productos={prod.lista} errores={errores} origen={origen} />
          <Boton tipo="submit" ocupado={s.accion.ocupado && s.resumen === null}>Traspasar</Boton>
        </form>
        {s.resumen !== null && <Confirmacion resumen={s.resumen} accion={s.accion} alConfirmar={confirmar} alVolver={() => { s.setResumen(null); s.accion.limpiar(); }} />}
      </Seccion>
      <Seccion titulo="Últimos traspasos">
        {movs.datos && movs.datos.length === 0 && <Vacio titulo="Todavía no hay traspasos" />}
        {movs.datos && movs.datos.length > 0 && <TablaMovimientos movs={movs.datos} productos={prod.lista} />}
      </Seccion>
    </div>
  );
}

interface EstadoAjuste {
  productoId: string;
  almacen: string;
  diferencia: string;
  motivo: string;
}

export function Ajuste(): JSX.Element {
  const { api } = useApp();
  const prod = useProductos();
  const [inicial] = useState<EstadoAjuste>({ productoId: '', almacen: 'tienda', diferencia: '', motivo: '' });
  const clave = 'inventarios.movimiento.ajuste';
  const b = useBorrador<EstadoAjuste>(clave, inicial);
  const e = b.valor;
  const sucio = b.hayBorrador && (e.productoId !== '' || e.almacen !== 'tienda' || e.diferencia.trim() !== '' || e.motivo.trim() !== '');
  const s = useEnvio(clave, sucio);
  const [lectura, setLectura] = useState<LecturaExistencia>({ estado: 'cargando' });
  const lecturaVigente = useRef(0);
  if (prod.cargando) return <Cargando />;
  if (prod.error) return <ErrorCarga error={prod.error} reintentar={prod.recargar} />;
  const sinSerie = prod.lista.filter((p) => !p.conSerie);
  const p = sinSerie.find((x) => x.id === e.productoId);
  const almacen = e.almacen as UbicacionId;
  const delta = leerDiferencia(e.diferencia);
  const previa = haySeQuedan(p, almacen, delta);
  const errores = s.intento ? revisarAjuste(p, almacen, e.diferencia, e.motivo) : {};
  const revisar = (ev: Event): void => {
    ev.preventDefault();
    s.setIntento(true);
    if (Object.keys(revisarAjuste(p, almacen, e.diferencia, e.motivo)).length > 0 || p === undefined || delta === null) s.pedirFoco();
    else {
      s.setResumen(resumenAjuste(p, almacen, delta, e.motivo, { estado: 'cargando' }));
      // Al abrir la confirmación se vuelven a leer las existencias: lo mostrado no depende de lo leído al montar.
      const turno = (lecturaVigente.current += 1);
      setLectura({ estado: 'cargando' });
      const productoId = p.id;
      api.llamar('listarProductos', {}).then(
        (ps) => {
          if (turno !== lecturaVigente.current) return;
          const fresco = ps.find((x) => x.id === productoId)?.existencias[almacen];
          setLectura(fresco === undefined ? { estado: 'fallo' } : { estado: 'ok', hay: fresco });
        },
        () => {
          if (turno === lecturaVigente.current) setLectura({ estado: 'fallo' });
        },
      );
    }
  };
  const volver = (): void => {
    lecturaVigente.current += 1;
    s.setResumen(null);
    s.accion.limpiar();
  };
  const confirmar = (): void => {
    if (p === undefined || delta === null) return;
    const lineas = [{ productoId: p.id, ubicacionId: almacen, delta }];
    void s.accion.ejecutar(async () => {
      await api.llamar('ajustar', { operacionId: s.ids.idPara(JSON.stringify([e.motivo.trim(), lineas])), motivo: e.motivo.trim(), lineas });
      s.avisos.ok('Ajuste registrado.');
      s.ids.liberar();
      s.marcarGuardado();
      b.descartar();
      s.setIntento(false);
      s.setResumen(null);
      prod.recargar();
    });
  };
  return (
    <Seccion titulo="Ajuste de existencias (administrador)">
      <p class="texto-suave">Un ajuste siempre lleva motivo. Los productos con serie no se ajustan: use ingreso o merma.</p>
      <form ref={s.formulario} class="formulario" onSubmit={revisar} noValidate>
        <div class="cuadricula">
          <SelectorProducto productos={sinSerie} valor={e.productoId} onCambio={(v) => b.poner({ ...e, productoId: v })} error={errores.producto} />
          <Selector etiqueta="Almacén" valor={e.almacen} onCambio={(v) => b.poner({ ...e, almacen: v })} opciones={OPCIONES_ALMACEN} />
          <Campo
            etiqueta="Diferencia (positivo suma, negativo resta)" valor={e.diferencia} inputMode="numeric" requerido error={errores.diferencia}
            ayuda={previa === null ? 'Por ejemplo 5 suma cinco y -2 resta dos.' : `${previa.texto}.`} onInput={(v) => b.poner({ ...e, diferencia: v })}
          />
          <Campo etiqueta="Motivo" valor={e.motivo} requerido tope={500} error={errores.motivo} onInput={(v) => b.poner({ ...e, motivo: v })} />
        </div>
        <Boton tipo="submit" ocupado={s.accion.ocupado && s.resumen === null}>Aplicar ajuste</Boton>
      </form>
      {s.resumen !== null && p !== undefined && delta !== null && (
        <Confirmacion resumen={resumenAjuste(p, almacen, delta, e.motivo, lectura)} accion={s.accion} alConfirmar={confirmar} alVolver={volver} leyendo={lectura.estado === 'cargando'} />
      )}
    </Seccion>
  );
}
