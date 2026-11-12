import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { nuevoId } from '../../api/cliente.js';
import type { CotizacionesVigentes, ProductoPanel } from '../../api/tipos.js';
import { useAvisos } from '../../ui/avisos.js';
import { Alerta, Boton, Campo, Casilla, Dato } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { Dialogo } from '../../ui/dialogo.js';
import { enfocarPrimerError } from '../../ui/formulario.js';
import { useBorrador, useCambiosSinGuardar, useGuardia } from '../../ui/guardia.js';
import { useAccion } from '../../ui/hooks.js';
import { formatearMonto, textoACentavos } from '../../util/dinero.js';
import { precioDeVenta } from '../../util/precio.js';
import { MERCADOS_PRECIO } from './nombres.js';
import {
  aEntrada, cambiosDeEdicion, clavePrecio, errorDeServidor, formInicial, identificadorSugerido, listaEnTexto, mismoForm, revisarProducto, TOPES_PRODUCTO,
  type ErroresProducto, type FormProducto,
} from './producto-revision.js';
import './inventario.css';

function Precio({ usd, m, cot }: { usd: number; m: (typeof MERCADOS_PRECIO)[number]; cot: CotizacionesVigentes }): JSX.Element {
  const p = precioDeVenta(usd, m.mercado, m.moneda, cot[m.mercado]);
  return <span>{p.tipo === 'precio' ? formatearMonto(p.centavos, p.moneda) : p.tipo === 'sin_precio' ? 'A consultar' : 'Sin cotización'}</span>;
}

function margen(precio: number | null, costo: number | null): string {
  if (precio === null || costo === null || precio <= 0) return '—';
  return `${(((precio - costo) / precio) * 100).toFixed(1).replace('.', ',')} %`;
}

export interface PropsProductoPanel {
  /** `null` = producto nuevo. */
  readonly producto: ProductoPanel | null;
  readonly cot: CotizacionesVigentes;
  /** Identificadores y SKU que ya existen, para avisar antes de enviar. */
  readonly existentes: readonly { readonly id: string; readonly sku: string }[];
  /** Cierra el panel; `guardado` dice si se guardó algo (la lista se vuelve a leer). */
  readonly alCerrar: (guardado: boolean) => void;
  readonly alCerrarEnfocar: () => HTMLElement | null;
}

/** Alta y edición de un producto en el panel lateral. «Guardar» nunca se apaga: revisa y marca el error junto al campo. */
export function ProductoPanelLateral({ producto, cot, existentes, alCerrar, alCerrarEnfocar }: PropsProductoPanel): JSX.Element {
  const { api, usuario } = useApp();
  const avisos = useAvisos();
  const { confirmarSalida } = useGuardia();
  const accion = useAccion();
  const esAdm = usuario.rol === 'adm';
  const nuevo = producto === null;
  const clave = `inventarios.producto.${producto?.id ?? 'nuevo'}`;
  const inicial = formInicial(producto);
  const borrador = useBorrador<FormProducto | null>(clave, null);
  const f = borrador.valor ?? inicial;
  const sucio = borrador.valor !== null && !mismoForm(borrador.valor, inicial);
  const { marcarGuardado } = useCambiosSinGuardar(sucio, [clave]);
  const [intento, setIntento] = useState(false);
  const [delServidor, setDelServidor] = useState<ErroresProducto>({});
  const [confirmando, setConfirmando] = useState(false);
  const [pideFoco, setPideFoco] = useState(0);
  const cuerpo = useRef<HTMLDivElement>(null);
  /** Un identificador de operación por intento de guardado; el mismo en un reintento con los mismos datos. */
  const operaciones = useRef(new Map<string, { firma: string; id: string }>());

  const idDeOperacion = (nombre: string, firma: string): string => {
    const previa = operaciones.current.get(nombre);
    if (previa !== undefined && previa.firma === firma) return previa.id;
    const id = nuevoId();
    operaciones.current.set(nombre, { firma, id });
    return id;
  };

  const ctx = { nuevo, existentes: nuevo ? existentes : [] };
  const errores: ErroresProducto = { ...(intento ? revisarProducto(f, ctx) : {}), ...delServidor };
  const edicion = producto === null ? null : cambiosDeEdicion(f, producto, esAdm);

  useEffect(() => {
    if (pideFoco > 0 && cuerpo.current !== null) enfocarPrimerError(cuerpo.current);
  }, [pideFoco]);

  const poner = (c: Partial<FormProducto>): void => {
    setDelServidor({});
    borrador.poner({ ...f, ...c });
  };
  const ponerNombre = (v: string): void => {
    const ids = new Set(existentes.map((x) => x.id));
    poner({ nombre: v, ...(nuevo && !f.idEditado ? { id: identificadorSugerido(v, ids) } : {}) });
  };

  const cerrar = (): void => {
    borrador.descartar();
    alCerrar(false);
  };

  const enviar = (): void => {
    void accion.ejecutar(async () => {
      try {
        if (producto === null) {
          const producto2 = aEntrada(f);
          if (producto2 === null) return;
          await api.llamar('crearProducto', { operacionId: idDeOperacion('crear', JSON.stringify(producto2)), producto: producto2 });
        } else if (edicion !== null) {
          if (Object.keys(edicion.cambios).length > 0) {
            await api.llamar('actualizarProducto', { operacionId: idDeOperacion('actualizar', JSON.stringify(edicion.cambios)), productoId: producto.id, cambios: edicion.cambios });
          }
          if (edicion.precio !== null) {
            await api.llamar('cambiarPrecioUSD', { operacionId: idDeOperacion('precio', JSON.stringify(edicion.precio)), productoId: producto.id, precioUSD: edicion.precio });
          }
        }
      } catch (e) {
        const deCampo = errorDeServidor(e);
        if (deCampo === null) throw e;
        setConfirmando(false);
        setDelServidor({ [deCampo.campo]: deCampo.texto });
        setIntento(true);
        setPideFoco((n) => n + 1);
        return;
      }
      avisos.ok(nuevo ? `Producto creado: ${f.nombre.trim()}.` : `Cambios guardados: ${f.nombre.trim()}.`);
      operaciones.current.clear();
      marcarGuardado();
      borrador.descartar();
      setConfirmando(false);
      alCerrar(true);
    });
  };

  const guardar = (): void => {
    if (!esAdm) return;
    setIntento(true);
    setDelServidor({});
    if (Object.keys(revisarProducto(f, ctx)).length > 0) {
      setPideFoco((n) => n + 1);
      return;
    }
    if (edicion !== null && Object.keys(edicion.cambios).length === 0 && edicion.precio === null) {
      avisos.info('No hay cambios que guardar.');
      cerrar();
      return;
    }
    if (edicion !== null && (edicion.vaciados.length > 0 || edicion.desactiva)) {
      setConfirmando(true);
      return;
    }
    enviar();
  };

  const soloLectura = !esAdm;
  const precios = MERCADOS_PRECIO.map((m) => ({ m, centavos: textoACentavos(f.precios[m.clave] ?? '') }));
  const costo = f.costo.trim() === '' ? null : textoACentavos(f.costo);

  return (
    <Dialogo
      titulo={nuevo ? 'Nuevo producto' : `Datos del producto: ${producto.nombre}`}
      variante="lateral"
      foco="campo"
      sucio={sucio}
      onCerrar={cerrar}
      alCerrarEnfocar={alCerrarEnfocar}
      pie={
        <>
          <Boton variante="secundario" onClick={() => confirmarSalida(cerrar)}>{soloLectura ? 'Cerrar' : 'Cancelar'}</Boton>
          {esAdm && <Boton onClick={guardar} ocupado={accion.ocupado && !confirmando}>{nuevo ? 'Crear producto' : 'Guardar cambios'}</Boton>}
        </>
      }
    >
      <div ref={cuerpo} class="inv-cuerpo">
        {soloLectura && <Alerta tipo="info">Solo el administrador edita productos y precios. Usted puede consultar los datos.</Alerta>}
        <form class="formulario inv-formulario" onSubmit={(e) => { e.preventDefault(); guardar(); }} noValidate>
          <Campo etiqueta="Nombre" valor={f.nombre} tope={TOPES_PRODUCTO.nombre} requerido deshabilitado={soloLectura} error={errores['nombre']} onInput={ponerNombre} />
          {nuevo && (
            <Campo
              etiqueta="Identificador" valor={f.id} tope={TOPES_PRODUCTO.id} requerido error={errores['id']}
              ayuda="Código interno, se genera desde el nombre. Minúsculas, números y guiones. No se puede cambiar después."
              onInput={(v) => poner({ id: v, idEditado: true })}
            />
          )}
          <Campo etiqueta="Categoría" valor={f.categoria} tope={TOPES_PRODUCTO.categoria} requerido deshabilitado={soloLectura} error={errores['categoria']} onInput={(v) => poner({ categoria: v })} />
          <Campo
            etiqueta="Marca" valor={f.marca} tope={TOPES_PRODUCTO.marca} deshabilitado={soloLectura} error={errores['marca']}
            ayuda={nuevo ? 'Opcional.' : 'Opcional. Si la deja vacía, se quita la marca del producto.'} onInput={(v) => poner({ marca: v })}
          />
          <Campo
            etiqueta="SKU" valor={f.sku} tope={TOPES_PRODUCTO.sku} requerido={nuevo} deshabilitado={!nuevo || soloLectura} error={errores['sku']}
            ayuda={nuevo ? 'El código con que identifica el producto en su negocio. No se puede cambiar después.' : 'El SKU no se edita.'} onInput={(v) => poner({ sku: v })}
          />
          <Campo
            etiqueta="Garantía (meses)" valor={f.garantia} inputMode="numeric" deshabilitado={soloLectura} error={errores['garantia']}
            ayuda="Opcional, de 1 a 120. Vacía = sin garantía registrada." onInput={(v) => poner({ garantia: v })}
          />
          <Campo
            etiqueta="Mínimo de existencias" valor={f.minimo} inputMode="numeric" deshabilitado={soloLectura} error={errores['minimo']}
            ayuda="Opcional. Con menos que esto, el producto aparece «bajo el mínimo»." onInput={(v) => poner({ minimo: v })}
          />
          <div class="fila">
            <Casilla etiqueta="Activo" marcado={f.activo} deshabilitado={soloLectura} onCambio={(v) => poner({ activo: v })} />
            <Casilla etiqueta="Se controla por número de serie" marcado={f.conSerie} deshabilitado={soloLectura || (!nuevo && (producto.stockTotal ?? 0) > 0)} onCambio={(v) => poner({ conSerie: v })} />
          </div>
          {!f.activo && !nuevo && producto.activo && <p class="ayuda" data-prueba="aviso-desactivar">Al desactivarlo, deja de venderse en caja y sale del sitio en la siguiente publicación. El stock no se pierde.</p>}
          <fieldset class="inv-bloque">
            <legend>Precio base en dólares por mercado</legend>
            <p class="ayuda">Obligatorio en cada mercado. El precio en moneda local se calcula con la cotización del día.</p>
            <div class="cuadricula">
              {precios.map(({ m, centavos }) => (
                <div key={m.clave}>
                  <Campo etiqueta={`${m.nombre} (USD)`} valor={f.precios[m.clave] ?? ''} inputMode="decimal" requerido deshabilitado={soloLectura} error={errores[clavePrecio(m.clave)]} onInput={(v) => poner({ precios: { ...f.precios, [m.clave]: v } })} />
                  <p class="texto-suave" data-prueba={`precio-${m.clave}`}>Hoy: {centavos !== null ? <Precio usd={centavos} m={m} cot={cot} /> : '—'}</p>
                </div>
              ))}
            </div>
          </fieldset>
          {esAdm && (
            <fieldset class="inv-bloque">
              <legend>Costo y margen (solo administrador)</legend>
              <Campo etiqueta="Costo (USD)" valor={f.costo} inputMode="decimal" error={errores['costo']} ayuda="Opcional. Si lo deja vacío, se quita el costo del producto." onInput={(v) => poner({ costo: v })} />
              <dl class="datos">
                {precios.map(({ m, centavos }) => <Dato key={m.clave} etiqueta={`Margen ${m.nombre}`}>{margen(centavos, costo)}</Dato>)}
              </dl>
            </fieldset>
          )}
          {accion.error !== null && !confirmando && <Alerta>{accion.error}</Alerta>}
        </form>
      </div>
      {confirmando && edicion !== null && producto !== null && (
        <Dialogo
          variante="centro"
          titulo="¿Guardar estos cambios?"
          foco="seguro"
          onCerrar={() => { setConfirmando(false); accion.limpiar(); }}
          pie={
            <>
              <button type="button" class="boton boton-secundario" data-seguro onClick={() => { setConfirmando(false); accion.limpiar(); }}>Volver a editar</button>
              <Boton variante={edicion.desactiva ? 'peligro' : 'cta'} onClick={enviar} ocupado={accion.ocupado}>Sí, guardar</Boton>
            </>
          }
        >
          <div class="inv-resumen">
            {edicion.vaciados.length > 0 && (
              <p data-prueba="aviso-vaciar">Se quitará del producto {listaEnTexto(edicion.vaciados)}. El dato se borra y, para volver a tenerlo, habrá que escribirlo de nuevo.</p>
            )}
            {edicion.desactiva && (
              <p data-prueba="aviso-desactivar-confirmar">
                Al desactivar «{producto.nombre}», deja de venderse en caja y sale del sitio en la siguiente publicación. El stock no se pierde
                {producto.stockTotal !== undefined ? ` (hay ${String(producto.stockTotal)} en total)` : ''} y puede volver a activarlo cuando quiera.
              </p>
            )}
            {accion.error !== null && <Alerta>{accion.error}</Alerta>}
          </div>
        </Dialogo>
      )}
    </Dialogo>
  );
}
