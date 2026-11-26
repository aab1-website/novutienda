import { sugerirCategoria } from '@novutienda/nucleo';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { nuevoId } from '../../api/cliente.js';
import { ErrorApi } from '../../api/errores.js';
import type { CotizacionVista, CotizacionesVigentes, ProductoPanel, VistaComercial } from '../../api/tipos.js';
import { useAvisos } from '../../ui/avisos.js';
import { Alerta, Boton, Campo, Casilla, Dato } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { Dialogo } from '../../ui/dialogo.js';
import { enfocarPrimerError } from '../../ui/formulario.js';
import { useBorrador, useCambiosSinGuardar, useGuardia } from '../../ui/guardia.js';
import { useAccion } from '../../ui/hooks.js';
import { formatearMonto, textoACentavos } from '../../util/dinero.js';
import { precioDeVentaMercado, reglasDeclaradasActuales } from '../../util/precio.js';
import { identificadorParaAlta } from './identificador.js';
import { mercadosDePrecio, nombreMoneda, type MercadoPrecio } from './nombres.js';
import {
  aEntrada, avisoDeSku, avisosDeDesproporcion, cambiosDeEdicion, clavePrecio, errorDeServidor, errorDeSku, esProductoYaExiste, formInicial, leerBorrador, listaEnTexto, mismoForm, revisarProducto, TOPES_PRODUCTO,
  type ErroresProducto, type FormProducto,
} from './producto-revision.js';
import './inventario.css';

/**
 * Precio de venta de hoy en un mercado declarado. D21: sin la regla de redondeo del comercio no se calcula ni se muestra
 * ningún precio (no hay respaldo fijo).
 */
function Precio({ base, m, cot, mercados }: { base: number; m: MercadoPrecio; cot: CotizacionesVigentes; mercados: VistaComercial['mercados'] }): JSX.Element {
  const declarado = mercados.find((x) => x.id === m.id);
  if (declarado === undefined) return <span>—</span>;
  const cotizacion = (cot as Readonly<Record<string, CotizacionVista | null | undefined>>)[m.id] ?? null;
  const p = precioDeVentaMercado(base, declarado, cotizacion, reglasDeclaradasActuales());
  return <span>{p.tipo === 'precio' ? formatearMonto(p.centavos, p.moneda) : p.tipo === 'sin_precio' ? 'A consultar' : p.tipo === 'sin_cotizacion' ? 'Sin cotización' : 'Sin regla de redondeo'}</span>;
}

/** Margen sobre el precio base; solo si el costo y el precio están en la misma moneda (si no, no se mezclan). */
function margen(precio: number | null, costo: number | null, monedaPrecio: string, monedaCosto: string | undefined): string {
  if (precio === null || costo === null || precio <= 0 || monedaCosto === undefined || monedaCosto !== monedaPrecio) return '—';
  return `${(((precio - costo) / precio) * 100).toFixed(1).replace('.', ',')} %`;
}

export interface PropsProductoPanel {
  /** `null` = producto nuevo. */
  readonly producto: ProductoPanel | null;
  readonly cot: CotizacionesVigentes;
  /** Mercados y monedas declarados por el comercio (nombre, moneda de venta y base, moneda de costo si es administrador). */
  readonly comercial: VistaComercial;
  /** Claves y SKU que ya existen: las claves solo sirven para no repetir la automática; la persona no las ve. */
  readonly existentes: readonly { readonly id: string; readonly sku: string; readonly categoria?: string }[];
  /** Cierra el panel; `guardado` dice si se guardó algo (la lista se vuelve a leer). */
  readonly alCerrar: (guardado: boolean) => void;
  readonly alCerrarEnfocar: () => HTMLElement | null;
}

/** Alta y edición de un producto en el panel lateral. «Guardar» nunca se apaga: revisa y marca el error junto al campo. */
export function ProductoPanelLateral({ producto, cot, comercial, existentes, alCerrar, alCerrarEnfocar }: PropsProductoPanel): JSX.Element {
  const { api, usuario } = useApp();
  const avisos = useAvisos();
  const { confirmarSalida } = useGuardia();
  const accion = useAccion();
  const esAdm = usuario.rol === 'adm';
  const soloLectura = !esAdm;
  const nuevo = producto === null;
  const clave = `inventarios.producto.${producto?.id ?? 'nuevo'}`;
  const mercados = mercadosDePrecio(comercial.mercados);
  const monedaCosto = comercial.monedaCosto;
  const sinPrecio = (producto?.sinPrecio ?? []).filter((id) => mercados.some((m) => m.id === id));
  const inicial = formInicial(producto, mercados);
  const borrador = useBorrador<FormProducto | null>(clave, null);
  const guardado = leerBorrador(borrador.valor);
  const f = guardado ?? inicial;
  const sucio = guardado !== null && !mismoForm(guardado, inicial);
  const { marcarGuardado } = useCambiosSinGuardar(sucio, [clave]);
  const [intento, setIntento] = useState(false);
  /** La persona ya salió del campo SKU: el aviso de SKU repetido aparece sin esperar a «Guardar». */
  const [skuTocado, setSkuTocado] = useState(false);
  const [delServidor, setDelServidor] = useState<ErroresProducto>({});
  const [confirmando, setConfirmando] = useState(false);
  const [pideFoco, setPideFoco] = useState(0);
  const cuerpo = useRef<HTMLDivElement>(null);
  /** El panel sigue en pantalla: si la llamada termina con el panel ya desmontado, el resultado se avisa por el aviso fijo. */
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);
  /** Un identificador de operación por intento de guardado; el mismo en un reintento con los mismos datos. */
  const operaciones = useRef(new Map<string, { firma: string; id: string }>());

  const idDeOperacion = (nombre: string, firma: string): string => {
    const previa = operaciones.current.get(nombre);
    if (previa !== undefined && previa.firma === firma) return previa.id;
    const id = nuevoId();
    operaciones.current.set(nombre, { firma, id });
    return id;
  };

  const ctx = {
    nuevo, existentes: nuevo ? existentes : [], mercados, monedaCosto,
    sinPrecio: mercados.filter((m) => sinPrecio.includes(m.id)).map((m) => m.clave),
  };
  const errorSkuAlSalir = nuevo && skuTocado ? errorDeSku(f.sku, existentes) : null;
  const errores: ErroresProducto = { ...(errorSkuAlSalir !== null ? { sku: errorSkuAlSalir } : {}), ...(intento ? revisarProducto(f, ctx) : {}), ...delServidor };
  const avisoSku = nuevo && (skuTocado || intento) ? avisoDeSku(f.sku, existentes) : null;
  const avisosPrecio = avisosDeDesproporcion(f, mercados);
  const categoriasExistentes = [...new Set(existentes.map((x) => sugerirCategoria(x.categoria ?? '')).filter((c) => c !== ''))].sort();
  const sugerencia = sugerirCategoria(f.categoria);
  const muestraSugerencia = sugerencia !== '' && sugerencia !== f.categoria && !soloLectura;
  const edicion = producto === null ? null : cambiosDeEdicion(f, producto, esAdm, mercados);

  useEffect(() => {
    if (pideFoco > 0 && cuerpo.current !== null) enfocarPrimerError(cuerpo.current);
  }, [pideFoco]);

  const poner = (c: Partial<FormProducto>): void => {
    setDelServidor({});
    borrador.poner({ ...f, ...c });
  };

  const cerrar = (): void => {
    // Con el guardado en vuelo el panel no se cierra: la persona vería desaparecer el panel sin saber si se guardó.
    if (accion.ocupado) return;
    borrador.descartar();
    alCerrar(false);
  };

  const enviar = (): void => {
    void accion.ejecutar(async () => {
      try {
        if (producto === null) {
          // La clave interna es automática y la persona no la ve. Si otro producto (que este panel no tenía cargado) ya la usa, el
          // servidor lo dice y se prueba la siguiente, hasta 5 veces. Un reintento por red con los mismos datos conserva el `operacionId`.
          const ocupados = new Set(existentes.map((x) => x.id));
          let creado = false;
          for (let n = 0; n < 5 && !creado; n += 1) {
            const clave = identificadorParaAlta(f.nombre.trim(), f.sku.trim(), ocupados);
            const entrada = aEntrada(f, mercados, clave);
            if (entrada === null) return;
            try {
              await api.llamar('crearProducto', { operacionId: idDeOperacion(`crear:${clave}`, JSON.stringify(entrada)), producto: entrada });
              creado = true;
            } catch (e) {
              if (!esProductoYaExiste(e)) throw e;
              ocupados.add(clave);
            }
          }
          if (!creado) throw new ErrorApi('failed-precondition', 'No se pudo crear el producto. Intente de nuevo.', { codigo: 'estado-invalido' });
        } else if (edicion !== null) {
          // Una sola llamada con todo lo cambiado (datos y precio): atómica y con un solo evento.
          await api.llamar('actualizarProducto', { operacionId: idDeOperacion('actualizar', JSON.stringify(edicion.cambios)), productoId: producto.id, cambios: edicion.cambios });
        }
      } catch (e) {
        const deCampo = errorDeServidor(e, mercados);
        if (deCampo === null) {
          // Sin panel donde mostrar el error (la persona cambió de pantalla), se avisa por el aviso fijo.
          if (!montado.current && !(e instanceof ErrorApi && e.codigoHttps === 'unauthenticated')) avisos.error(`No se guardó ${f.nombre.trim()}: ${e instanceof Error ? e.message : 'error inesperado'}`);
          throw e;
        }
        if (!montado.current) {
          avisos.error(`No se guardó ${f.nombre.trim()}: ${deCampo.texto}`);
          return;
        }
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
      if (!montado.current) return;
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
    if (edicion !== null && Object.keys(edicion.cambios).length === 0) {
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

  const precios = mercados.map((m) => ({ m, centavos: textoACentavos(f.precios[m.clave] ?? '') }));
  const costo = f.costo.trim() === '' ? null : textoACentavos(f.costo);
  const unico = mercados.length === 1;
  const bases = [...new Set(mercados.map((m) => m.monedaBase))];
  const leyendaPrecios = bases.length === 1 ? `Precio base en ${nombreMoneda(bases[0] as string)}${unico ? '' : ' por mercado'}` : 'Precio base por mercado';
  const ayudaPrecios = (unico ? 'Obligatorio. ' : 'Obligatorio en cada mercado. ') + (comercial.mercados.some((x) => x.tieneTipoCambio)
    ? 'El precio en moneda local se calcula con la cotización del día.' : 'El precio de venta se calcula con la regla de redondeo del comercio.');

  return (
    <Dialogo
      titulo={nuevo ? 'Nuevo producto' : `Datos del producto: ${producto.nombre}`}
      variante="lateral"
      foco="campo"
      sucio={sucio && !accion.ocupado}
      onCerrar={cerrar}
      alCerrarEnfocar={alCerrarEnfocar}
      pie={
        <>
          <Boton variante="secundario" deshabilitado={accion.ocupado} onClick={() => confirmarSalida(cerrar)}>{soloLectura ? 'Cerrar' : 'Cancelar'}</Boton>
          {esAdm && <Boton onClick={guardar} ocupado={accion.ocupado && !confirmando}>{nuevo ? 'Crear producto' : 'Guardar cambios'}</Boton>}
        </>
      }
    >
      <div ref={cuerpo} class="inv-cuerpo">
        {soloLectura && <Alerta tipo="info">Solo el administrador edita productos y precios. Usted puede consultar los datos.</Alerta>}
        <form class="formulario inv-formulario" onSubmit={(e) => { e.preventDefault(); guardar(); }} noValidate>
          <Campo etiqueta="Nombre" valor={f.nombre} tope={TOPES_PRODUCTO.nombre} requerido deshabilitado={soloLectura} error={errores['nombre']} onInput={(v) => poner({ nombre: v })} />
          <div class="campo">
            <label for="inv-categoria">
              Categoría<span class="obligatorio"> (obligatorio)</span>
            </label>
            <input
              id="inv-categoria" name="categoria" type="text" value={f.categoria} required list="inv-categorias" maxLength={TOPES_PRODUCTO.categoria} disabled={soloLectura}
              autocomplete="off" aria-invalid={errores['categoria'] !== undefined ? 'true' : undefined}
              aria-describedby={`inv-categoria-ayuda${errores['categoria'] !== undefined ? ' inv-categoria-error' : ''}`}
              onInput={(ev) => poner({ categoria: (ev.currentTarget as HTMLInputElement).value })}
            />
            <datalist id="inv-categorias" data-prueba="categorias-existentes">
              {categoriasExistentes.map((c) => <option key={c} value={c} />)}
            </datalist>
            <p id="inv-categoria-ayuda" class="ayuda">En minúsculas, sin tildes ni espacios (use guiones), por ejemplo «linea-blanca».</p>
            {errores['categoria'] !== undefined && <p id="inv-categoria-error" class="campo-error">Error: {errores['categoria']}</p>}
            {muestraSugerencia && (
              <button type="button" class="boton boton-secundario" data-prueba="usar-categoria" onClick={() => poner({ categoria: sugerencia })}>{`Usar «${sugerencia}»`}</button>
            )}
          </div>
          <Campo
            etiqueta="Marca" valor={f.marca} tope={TOPES_PRODUCTO.marca} deshabilitado={soloLectura} error={errores['marca']}
            ayuda={nuevo ? 'Opcional.' : 'Opcional. Si la deja vacía, se quita la marca del producto.'} onInput={(v) => poner({ marca: v })}
          />
          <div onFocusOut={() => setSkuTocado(true)}>
            <Campo
              etiqueta="SKU" valor={f.sku} tope={TOPES_PRODUCTO.sku} requerido={nuevo} deshabilitado={!nuevo || soloLectura} error={errores['sku']}
              ayuda={nuevo ? 'El código con que identifica el producto en su negocio. No se puede cambiar después.' : 'El SKU no se edita.'} onInput={(v) => poner({ sku: v })}
            />
            {avisoSku !== null && errores['sku'] === undefined && <p class="ayuda" role="status" data-prueba="aviso-sku-parecido">{avisoSku}</p>}
          </div>
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
            <div class="casilla">
              <input
                id="inv-con-serie" type="checkbox" checked={f.conSerie} disabled={soloLectura} aria-invalid={errores['conSerie'] !== undefined ? 'true' : undefined}
                aria-describedby={!nuevo ? 'inv-con-serie-ayuda' : undefined}
                onChange={(ev) => poner({ conSerie: (ev.currentTarget as HTMLInputElement).checked })}
              />
              <label for="inv-con-serie">Se controla por número de serie</label>
            </div>
          </div>
          {!nuevo && (
            <p id="inv-con-serie-ayuda" class={errores['conSerie'] !== undefined ? 'campo-error' : 'ayuda'} data-prueba="ayuda-serie">
              {errores['conSerie'] ?? 'No se puede cambiar si el producto ya tuvo movimientos.'}
            </p>
          )}
          {!f.activo && !nuevo && producto.activo && <p class="ayuda" data-prueba="aviso-desactivar">Al desactivarlo, deja de venderse en caja y sale del sitio en la siguiente publicación. El stock no se pierde.</p>}
          <fieldset class="inv-bloque">
            <legend>{leyendaPrecios}</legend>
            <p class="ayuda">{ayudaPrecios}</p>
            {avisosPrecio.map((a) => <p key={a} class="ayuda" role="status" data-prueba="aviso-desproporcion"><strong>Aviso:</strong> {a} Puede guardar igual.</p>)}
            <div class="cuadricula">
              {precios.map(({ m, centavos }) => (
                <div key={m.clave}>
                  <Campo etiqueta={unico ? `Precio base (${m.monedaBase})` : `${m.nombre} (${m.monedaBase})`} valor={f.precios[m.clave] ?? ''} inputMode="decimal" requerido={nuevo || !sinPrecio.includes(m.id)} deshabilitado={soloLectura} error={errores[clavePrecio(m.clave)]} onInput={(v) => poner({ precios: { ...f.precios, [m.clave]: v } })} />
                  {sinPrecio.includes(m.id) && <p class="ayuda" data-prueba={`sin-precio-${m.clave}`}><strong>Sin precio</strong>{unico ? '' : ` en ${m.nombre}`}: no se vende ni se publica hasta ponerle uno.</p>}
                  <p class="texto-suave" data-prueba={`precio-${m.clave}`}>Hoy: {centavos !== null ? <Precio base={centavos} m={m} cot={cot} mercados={comercial.mercados} /> : '—'}</p>
                </div>
              ))}
            </div>
          </fieldset>
          {esAdm && (
            <fieldset class="inv-bloque">
              <legend>Costo y margen (solo administrador)</legend>
              <Campo etiqueta={monedaCosto === undefined ? 'Costo' : `Costo (${monedaCosto})`} valor={f.costo} inputMode="decimal" error={errores['costo']} ayuda="Opcional. Si lo deja vacío, se quita el costo del producto." onInput={(v) => poner({ costo: v })} />
              <dl class="datos">
                {precios.map(({ m, centavos }) => <Dato key={m.clave} etiqueta={unico ? 'Margen' : `Margen ${m.nombre}`}>{margen(centavos, costo, m.monedaBase, monedaCosto)}</Dato>)}
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
