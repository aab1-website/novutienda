import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { nuevoId } from '../../api/cliente.js';
import { ErrorApi, mensajeDeError } from '../../api/errores.js';
import type { ConteoVista, ProductoDeConteo, UbicacionId } from '../../api/tipos.js';
import { useAvisos } from '../../ui/avisos.js';
import { Alerta, Boton, Campo, ConCarga, Selector, Seccion, Vacio, fechaHora } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { Dialogo } from '../../ui/dialogo.js';
import { useBorrador, useCambiosSinGuardar } from '../../ui/guardia.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { Tabla } from '../../ui/tabla.js';
import { normalizar } from '../../util/buscar.js';
import { AVISO_NADA_CONTADO, avance, contarPendientes, lineasDeCierre, normalizarTexto, puedeCerrar, revisarTexto, sinContar, textoGuardado, type EleccionSinContar } from './conteo-logica.js';
import { MOTIVO_MAX } from './mermas-logica.js';
import { separar } from './movimientos-resumen.js';
import { nombreAlmacen, OPCIONES_ALMACEN } from './nombres.js';
import { useProductos } from './usar-productos.js';
import './inventario.css';

type Linea = ConteoVista['lineas'][number];

/** Un campo del conteo: se guarda al salir de él si cambió, y dice en qué estado quedó. */
function FilaConteo({ conteoId, p, escrito, hecha, alEscribir, alGuardar, alOcupar }: {
  conteoId: string;
  p: ProductoDeConteo;
  escrito: string;
  hecha: Linea | undefined;
  alEscribir: (texto: string) => void;
  alGuardar: () => void;
  /** Avisa a la pantalla cuántos guardados de este campo hay en curso (+1 al empezar, -1 al terminar). */
  alOcupar: (delta: number) => void;
}): JSX.Element {
  const { api } = useApp();
  const accion = useAccion();
  const [errorCampo, setErrorCampo] = useState<string | null>(null);
  // El `operacionId` solo se reusa al REINTENTAR un guardado fallido del mismo valor; al guardar bien se descarta
  // (si no, volver a escribir un valor ya usado se tomaría por repetido y el servidor no lo escribiría).
  const fallido = useRef<{ clave: string; operacionId: string } | null>(null);
  // Guardados de este campo, encadenados: el segundo nunca llega antes que el primero ni se pierde.
  const cola = useRef<Promise<void>>(Promise.resolve());
  const ultima = useRef<string | null>(null);
  const enVuelo = useRef(0);
  const guardado = normalizarTexto(p, textoGuardado(p, hecha));
  const cambio = escrito.trim() !== '' && normalizarTexto(p, escrito) !== guardado;

  const guardar = (): void => {
    if (escrito.trim() === '') {
      setErrorCampo(null);
      return;
    }
    const clave = normalizarTexto(p, escrito);
    // Con un guardado en curso, volver al valor que ya tiene el servidor también se envía: el pendiente lo pisaría.
    if (!cambio && enVuelo.current === 0) {
      setErrorCampo(null);
      return;
    }
    const malo = revisarTexto(p, escrito);
    setErrorCampo(malo);
    if (malo !== null) return;
    if (clave === ultima.current && fallido.current === null) return;
    const reintento = fallido.current?.clave === clave ? fallido.current : null;
    const operacionId = reintento?.operacionId ?? nuevoId();
    fallido.current = null;
    ultima.current = clave;
    enVuelo.current += 1;
    alOcupar(1);
    const datos = p.conSerie ? { operacionId, conteoId, productoId: p.productoId, series: separar(escrito) } : { operacionId, conteoId, productoId: p.productoId, contado: Number(escrito.trim()) };
    cola.current = cola.current.then(async () => {
      let bien = false;
      try {
        await accion.ejecutar(async () => {
          await api.llamar('registrarLineaConteo', datos);
          bien = true;
          alGuardar();
        });
      } finally {
        enVuelo.current -= 1;
        alOcupar(-1);
        if (bien) {
          if (ultima.current === clave && enVuelo.current === 0) ultima.current = null;
        } else if (ultima.current === clave) {
          fallido.current = { clave, operacionId };
          ultima.current = null;
        }
      }
    });
  };

  const error = errorCampo ?? accion.error;
  const estado = accion.ocupado ? 'Guardando…' : cambio && error === null ? 'Sin guardar: salga del campo para guardarlo.' : hecha !== undefined && !cambio ? 'Guardado' : '';
  return (
    <div onFocusOut={guardar}>
      <Campo
        etiqueta={p.conSerie ? `Series de ${p.nombre}` : `Cantidad de ${p.nombre}`}
        valor={escrito}
        onInput={(v) => { alEscribir(v); setErrorCampo(null); accion.limpiar(); }}
        inputMode={p.conSerie ? 'text' : 'numeric'}
        error={error !== null ? (accion.error !== null && errorCampo === null ? `No se pudo guardar ${p.nombre}. ${accion.error}` : error) : undefined}
      />
      <p class="texto-suave" role="status" aria-live="polite">{estado}</p>
      {accion.error !== null && errorCampo === null && <Boton chico variante="secundario" onClick={guardar} etiqueta={`Reintentar guardar ${p.nombre}`}>Reintentar</Boton>}
    </div>
  );
}

/** Cancelar un conteo abierto (solo adm): no mueve stock ni crea mermas. El motivo es obligatorio, como al rechazar una merma. */
function CancelarConteo({ conteoId, alCerrar, alCancelar }: { conteoId: string; alCerrar: () => void; alCancelar: () => void }): JSX.Element {
  const { api } = useApp();
  const accion = useAccion();
  const [motivo, setMotivo] = useState('');
  const [intento, setIntento] = useState(false);
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);
  const operacion = useRef<{ firma: string; id: string } | null>(null);
  const falta = motivo.trim() === '';
  const confirmar = (): void => {
    setIntento(true);
    if (falta) return;
    const firma = motivo.trim();
    if (operacion.current?.firma !== firma) operacion.current = { firma, id: nuevoId() };
    const operacionId = operacion.current.id;
    setErrorMotivo(null);
    void accion.ejecutar(async () => {
      try {
        await api.llamar('cancelarConteo', { operacionId, conteoId, motivo: firma });
      } catch (e) {
        if (!(e instanceof ErrorApi) || e.detalle.codigo !== 'entrada-invalida') throw e;
        setErrorMotivo(mensajeDeError(e));
        return;
      }
      alCancelar();
    });
  };
  return (
    <Dialogo
      variante="centro"
      titulo="¿Cancelar el conteo?"
      descripcion="Revise antes de confirmar."
      foco="campo"
      sucio={!falta}
      onCerrar={alCerrar}
      pie={
        <>
          <button type="button" class="boton boton-secundario" data-seguro onClick={alCerrar}>Volver al conteo</button>
          <Boton variante="peligro" onClick={confirmar} ocupado={accion.ocupado}>Sí, cancelar conteo</Boton>
        </>
      }
    >
      <ul class="lista-simple inv-resumen">
        <li>Lo ya contado queda guardado en el conteo cancelado, sin efecto: no se mueve stock ni se crean mermas.</li>
        <li>El almacén queda libre y se podrá abrir un conteo nuevo. La cancelación queda registrada con su usuario y el motivo.</li>
      </ul>
      <Campo etiqueta="Motivo de la cancelación" requerido tope={MOTIVO_MAX} valor={motivo} onInput={(v) => { setMotivo(v); setErrorMotivo(null); }} error={intento && falta ? 'Escriba el motivo de la cancelación.' : (errorMotivo ?? undefined)} />
      {accion.error !== null && errorMotivo === null && <Alerta>{accion.error}</Alerta>}
    </Dialogo>
  );
}

function ConteoAbierto({ abierto, productos, alCambiar }: { abierto: ConteoVista; productos: readonly ProductoDeConteo[]; alCambiar: () => void }): JSX.Element {
  const { api, usuario } = useApp();
  const avisos = useAvisos();
  const cierre = useAccion();
  const [q, setQ] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [eleccion, setEleccion] = useState<EleccionSinContar>('igual');
  const [cancelando, setCancelando] = useState(false);
  const [enCurso, setEnCurso] = useState(0);
  const enCursoRef = useRef(0);
  const ocupar = (delta: number): void => {
    enCursoRef.current += delta;
    setEnCurso(enCursoRef.current);
  };
  const operacionCierre = useRef<{ eleccion: EleccionSinContar; id: string } | null>(null);
  const clave = `inventarios.conteo.${abierto.conteoId}`;
  const b = useBorrador<Record<string, string>>(clave, {});
  const lista = productos;
  const pendientes = contarPendientes(lista, b.valor, abierto.lineas);
  const { marcarGuardado } = useCambiosSinGuardar(pendientes > 0 || enCurso > 0, [clave]);
  const av = avance(lista, abierto.lineas);
  const visibles = q.trim() === '' ? lista : lista.filter((p) => normalizar([p.nombre, p.sku, p.categoria, p.marca ?? ''].join(' ')).includes(normalizar(q)));

  const cerrar = (): void => {
    // Nunca se cierra con valores que la persona ve y el servidor todavía no tiene.
    if (enCursoRef.current > 0 || pendientes > 0) return;
    if (!puedeCerrar(av, eleccion)) return;
    // Otra elección es otra operación: el mismo identificador solo se reusa al reintentar lo mismo.
    if (operacionCierre.current?.eleccion !== eleccion) operacionCierre.current = { eleccion, id: nuevoId() };
    const operacionId = operacionCierre.current.id;
    void cierre.ejecutar(async () => {
      const r = await api.llamar('cerrarConteo', { operacionId, conteoId: abierto.conteoId, sinContar: eleccion });
      const lista2 = Array.isArray(r.resultado['avisos']) ? (r.resultado['avisos'] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
      marcarGuardado();
      b.descartar();
      setConfirmando(false);
      operacionCierre.current = null;
      avisos.ok(`Conteo cerrado y firmado. Los faltantes contados quedaron como mermas por resolver; los sobrantes se ingresaron.${lista2.length > 0 ? ` Atención: ${lista2.join(' ')}` : ''}`);
      alCambiar();
    });
  };

  return (
    <div>
      <p>Conteo abierto en <strong>{nombreAlmacen(abierto.ubicacionId)}</strong>. Escriba lo que cuenta de cada producto y salga del campo: se guarda solo (para productos con serie, escriba las series).</p>
      <p role="status" aria-live="polite" data-prueba="avance-conteo"><strong>Avance: {av.texto}</strong> productos contados.</p>
      <div class="inv-filtro">
        <Campo etiqueta="Buscar producto a contar" valor={q} onInput={setQ} />
      </div>
      {visibles.length === 0 ? (
        <Vacio titulo="Ningún producto coincide con esa búsqueda" />
      ) : (
        <div class="tabla-contenedor" role="region" aria-label="Productos a contar" tabIndex={0}>
          <table class="tabla">
            <caption class="solo-lectores">Productos a contar</caption>
            <thead><tr><th scope="col">Producto</th><th scope="col">Contado</th></tr></thead>
            <tbody>
              {visibles.map((p) => (
                <tr key={p.productoId}>
                  <th scope="row">{p.nombre}<div class="texto-suave">{p.sku}</div></th>
                  <td>
                    <FilaConteo
                      conteoId={abierto.conteoId}
                      p={p}
                      escrito={b.valor[p.productoId] ?? textoGuardado(p, abierto.lineas.find((l) => l.productoId === p.productoId))}
                      hecha={abierto.lineas.find((l) => l.productoId === p.productoId)}
                      alEscribir={(t) => b.poner((prev) => ({ ...prev, [p.productoId]: t }))}
                      alGuardar={alCambiar}
                      alOcupar={ocupar}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div class="fila">
        <Boton
          variante="secundario"
          onClick={() => setConfirmando(true)}
          motivo={enCurso > 0 ? 'Se están guardando cantidades: espere un momento.' : pendientes > 0 ? `Hay ${String(pendientes)} ${pendientes === 1 ? 'cantidad' : 'cantidades'} sin guardar: salga de cada campo para guardarlas.` : undefined}
        >
          Cerrar y firmar el conteo
        </Boton>
        {usuario.rol === 'adm' && (
          <Boton variante="peligro" onClick={() => setCancelando(true)} motivo={enCurso > 0 ? 'Se están guardando cantidades: espere un momento.' : undefined}>
            Cancelar conteo
          </Boton>
        )}
      </div>
      {cancelando && usuario.rol === 'adm' && (
        <CancelarConteo
          conteoId={abierto.conteoId}
          alCerrar={() => setCancelando(false)}
          alCancelar={() => {
            marcarGuardado();
            b.descartar();
            setCancelando(false);
            avisos.ok('Conteo cancelado. No se movió stock ni se crearon mermas; el almacén quedó libre.');
            alCambiar();
          }}
        />
      )}
      {confirmando && (
        <Dialogo
          variante="centro"
          titulo="¿Cerrar y firmar el conteo?"
          descripcion="Revise antes de confirmar."
          foco="seguro"
          onCerrar={() => { setConfirmando(false); cierre.limpiar(); }}
          pie={
            <>
              <button type="button" class="boton boton-secundario" data-seguro onClick={() => { setConfirmando(false); cierre.limpiar(); }}>Volver al conteo</button>
              <Boton onClick={cerrar} ocupado={cierre.ocupado} motivo={puedeCerrar(av, eleccion) ? undefined : AVISO_NADA_CONTADO}>Sí, cerrar y firmar</Boton>
            </>
          }
        >
          <ul class="lista-simple inv-resumen" data-prueba="resumen-cierre">
            {lineasDeCierre(av, eleccion).map((l) => <li key={l}>{l}</li>)}
          </ul>
          {sinContar(av) > 0 && (
            <fieldset class="plantillas">
              <legend>Qué hacer con los {String(sinContar(av))} {sinContar(av) === 1 ? 'producto' : 'productos'} sin contar</legend>
              <label>
                <input type="radio" name="sin-contar" value="igual" checked={eleccion === 'igual'} onChange={() => { setEleccion('igual'); cierre.limpiar(); }} />
                {' '}Dejarlos como están
              </label>
              <label>
                <input type="radio" name="sin-contar" value="cero" checked={eleccion === 'cero'} onChange={() => { setEleccion('cero'); cierre.limpiar(); }} />
                {' '}Tomarlos como 0 (generan merma)
              </label>
            </fieldset>
          )}
          {!puedeCerrar(av, eleccion) && <Alerta>{AVISO_NADA_CONTADO}</Alerta>}
          {cierre.error !== null && <Alerta>{cierre.error}</Alerta>}
        </Dialogo>
      )}
    </div>
  );
}

/** Resultado de un conteo cerrado (solo sup/adm). Los nombres se piden aquí, y solo cuando no hay un conteo abierto. */
function ResultadoConteo({ resultado }: { resultado: NonNullable<ConteoVista['resultado']> }): JSX.Element {
  const prod = useProductos();
  const nombre = (id: string): string => prod.lista.find((p) => p.id === id)?.nombre ?? id;
  return (
    <Tabla
      titulo="Resultado del conteo"
      filas={resultado}
      clave={(r) => r.productoId}
      porPagina={100}
      columnas={[
        { id: 'producto', titulo: 'Producto', valor: (r) => nombre(r.productoId), encabezadoFila: true },
        { id: 'sistema', titulo: 'Sistema', valor: (r) => r.teorico },
        { id: 'contado', titulo: 'Contado', valor: (r) => r.contado },
        { id: 'diferencia', titulo: 'Diferencia', valor: (r) => r.diferencia, celda: (r) => <span class={r.diferencia < 0 ? 'texto-error' : ''}>{r.diferencia}</span> },
      ]}
    />
  );
}

export function Conteo(): JSX.Element {
  const { api } = useApp();
  const conteos = useCarga(() => api.llamar('listarConteos', {}), []);
  const accion = useAccion();
  const [ubicacion, setUbicacion] = useState<UbicacionId>('tienda');
  const operacionApertura = useRef<{ ubicacion: string; conteoId: string; operacionId: string } | null>(null);

  const abrir = (): void => {
    if (operacionApertura.current?.ubicacion !== ubicacion) operacionApertura.current = { ubicacion, conteoId: `conteo-${nuevoId().slice(0, 8)}`, operacionId: nuevoId() };
    const { conteoId, operacionId } = operacionApertura.current;
    void accion.ejecutar(async () => {
      await api.llamar('abrirConteo', { operacionId, conteoId, ubicacionId: ubicacion });
      operacionApertura.current = null;
      conteos.recargar();
    });
  };
  const recargar = (): void => {
    conteos.recargar();
  };

  return (
    <ConCarga carga={conteos}>
      {(datos) => {
        const abierto = datos.find((c) => c.estado === 'abierto');
        const anteriores = datos.filter((c) => c.estado !== 'abierto');
        return (
          <div>
            <Seccion titulo="Conteo ciego">
              <p class="texto-suave">Quien cuenta no ve las existencias del sistema. Al cerrar, el servidor compara y registra las diferencias.</p>
              {abierto === undefined ? (
                <div class="fila fila-alinear">
                  <Selector etiqueta="Almacén a contar" valor={ubicacion} onCambio={(v) => setUbicacion(v as UbicacionId)} opciones={OPCIONES_ALMACEN} />
                  <Boton onClick={abrir} ocupado={accion.ocupado}>Abrir conteo</Boton>
                </div>
              ) : (
                <ConteoAbierto key={abierto.conteoId} abierto={abierto} productos={abierto.productos ?? []} alCambiar={recargar} />
              )}
              {accion.error && <Alerta>{accion.error}</Alerta>}
            </Seccion>
            <Seccion titulo="Conteos anteriores">
              {anteriores.length === 0 && <Vacio titulo="Todavía no hay conteos cerrados ni cancelados" />}
              {anteriores.map((c) => (
                <div key={c.conteoId} class="tarjeta-interna">
                  <strong>{nombreAlmacen(c.ubicacionId)}</strong> · {fechaHora(c.fecha)}
                  {c.estado === 'cancelado' && (
                    <p data-prueba="conteo-cancelado">
                      <strong>Cancelado</strong>
                      {c.motivoCancelacion !== undefined && <>. Motivo: {c.motivoCancelacion}</>}
                      {`. Productos contados: ${String(c.lineas.length)}.`}
                    </p>
                  )}
                  {c.resultado !== undefined && (abierto === undefined ? <ResultadoConteo resultado={c.resultado} /> : <p class="texto-suave">El resultado se muestra cuando no haya un conteo abierto: así quien cuenta no ve las existencias del sistema.</p>)}
                </div>
              ))}
            </Seccion>
          </div>
        );
      }}
    </ConCarga>
  );
}
