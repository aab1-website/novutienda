import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { nuevoId } from '../../api/cliente.js';
import type { ConteoVista, ProductoPanel, UbicacionId } from '../../api/tipos.js';
import { useAvisos } from '../../ui/avisos.js';
import { Alerta, Boton, Campo, ConCarga, Selector, Seccion, Vacio, fechaHora } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { Dialogo } from '../../ui/dialogo.js';
import { useBorrador, useCambiosSinGuardar } from '../../ui/guardia.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { Tabla } from '../../ui/tabla.js';
import { normalizar } from '../../util/buscar.js';
import { avance, contarPendientes, lineasDeCierre, normalizarTexto, revisarTexto, textoGuardado } from './conteo-logica.js';
import { separar } from './movimientos-resumen.js';
import { nombreAlmacen, OPCIONES_ALMACEN } from './nombres.js';
import { useProductos } from './usar-productos.js';
import './inventario.css';

type Linea = ConteoVista['lineas'][number];

/** Un campo del conteo: se guarda al salir de él si cambió, y dice en qué estado quedó. */
function FilaConteo({ conteoId, p, escrito, hecha, alEscribir, alGuardar }: {
  conteoId: string;
  p: ProductoPanel;
  escrito: string;
  hecha: Linea | undefined;
  alEscribir: (texto: string) => void;
  alGuardar: () => void;
}): JSX.Element {
  const { api } = useApp();
  const accion = useAccion();
  const [errorCampo, setErrorCampo] = useState<string | null>(null);
  // Un identificador por valor: reintentar el mismo valor no duplica; un valor distinto es otra operación.
  const ids = useRef(new Map<string, string>());
  const guardado = normalizarTexto(p, textoGuardado(p, hecha));
  const cambio = escrito.trim() !== '' && normalizarTexto(p, escrito) !== guardado;

  const guardar = (): void => {
    if (!cambio) {
      setErrorCampo(null);
      return;
    }
    const malo = revisarTexto(p, escrito);
    setErrorCampo(malo);
    if (malo !== null) return;
    const clave = normalizarTexto(p, escrito);
    const operacionId = ids.current.get(clave) ?? nuevoId();
    ids.current.set(clave, operacionId);
    void accion.ejecutar(async () => {
      await api.llamar('registrarLineaConteo', p.conSerie
        ? { operacionId, conteoId, productoId: p.id, series: separar(escrito) }
        : { operacionId, conteoId, productoId: p.id, contado: Number(escrito.trim()) });
      alGuardar();
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

function ConteoAbierto({ abierto, productos, alCambiar }: { abierto: ConteoVista; productos: readonly ProductoPanel[]; alCambiar: () => void }): JSX.Element {
  const { api } = useApp();
  const avisos = useAvisos();
  const cierre = useAccion();
  const [q, setQ] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const operacionCierre = useRef<string | null>(null);
  const clave = `inventarios.conteo.${abierto.conteoId}`;
  const b = useBorrador<Record<string, string>>(clave, {});
  const lista = productos.filter((p) => p.stockTotal !== undefined);
  const pendientes = contarPendientes(lista, b.valor, abierto.lineas);
  const { marcarGuardado } = useCambiosSinGuardar(pendientes > 0, [clave]);
  const av = avance(lista, abierto.lineas);
  const visibles = q.trim() === '' ? lista : lista.filter((p) => normalizar([p.nombre, p.sku, p.categoria, p.marca ?? ''].join(' ')).includes(normalizar(q)));

  const cerrar = (): void => {
    operacionCierre.current ??= nuevoId();
    const operacionId = operacionCierre.current;
    void cierre.ejecutar(async () => {
      const r = await api.llamar('cerrarConteo', { operacionId, conteoId: abierto.conteoId });
      const lista2 = Array.isArray(r.resultado['avisos']) ? (r.resultado['avisos'] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
      marcarGuardado();
      b.descartar();
      setConfirmando(false);
      operacionCierre.current = null;
      avisos.ok(`Conteo cerrado y firmado. Los faltantes quedaron como mermas por resolver; los sobrantes se ingresaron.${lista2.length > 0 ? ` Atención: ${lista2.join(' ')}` : ''}`);
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
                <tr key={p.id}>
                  <th scope="row">{p.nombre}<div class="texto-suave">{p.sku}</div></th>
                  <td>
                    <FilaConteo
                      conteoId={abierto.conteoId}
                      p={p}
                      escrito={b.valor[p.id] ?? textoGuardado(p, abierto.lineas.find((l) => l.productoId === p.id))}
                      hecha={abierto.lineas.find((l) => l.productoId === p.id)}
                      alEscribir={(t) => b.poner((prev) => ({ ...prev, [p.id]: t }))}
                      alGuardar={alCambiar}
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
          motivo={pendientes > 0 ? `Hay ${String(pendientes)} ${pendientes === 1 ? 'cantidad' : 'cantidades'} sin guardar: salga de cada campo para guardarlas.` : undefined}
        >
          Cerrar y firmar el conteo
        </Boton>
      </div>
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
              <Boton onClick={cerrar} ocupado={cierre.ocupado}>Sí, cerrar y firmar</Boton>
            </>
          }
        >
          <ul class="lista-simple inv-resumen" data-prueba="resumen-cierre">
            {lineasDeCierre(av, abierto.faltan).map((l) => <li key={l}>{l}</li>)}
          </ul>
          {cierre.error !== null && <Alerta>{cierre.error}</Alerta>}
        </Dialogo>
      )}
    </div>
  );
}

export function Conteo(): JSX.Element {
  const { api } = useApp();
  const conteos = useCarga(() => api.llamar('listarConteos', {}), []);
  const prod = useProductos();
  const accion = useAccion();
  const [ubicacion, setUbicacion] = useState<UbicacionId>('tienda');
  const nombre = (id: string): string => prod.lista.find((p) => p.id === id)?.nombre ?? id;
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
    prod.recargar();
  };

  return (
    <ConCarga carga={conteos}>
      {(datos) => {
        const abierto = datos.find((c) => c.estado === 'abierto');
        const cerrados = datos.filter((c) => c.estado === 'cerrado');
        return (
          <div>
            <Seccion titulo="Conteo ciego">
              <p class="texto-suave">Quien cuenta no ve las existencias del sistema. Al cerrar, el servidor compara y registra las diferencias.</p>
              {abierto === undefined ? (
                <div class="fila fila-alinear">
                  <Selector etiqueta="Almacén a contar" valor={ubicacion} onCambio={(v) => setUbicacion(v as UbicacionId)} opciones={OPCIONES_ALMACEN} />
                  <Boton onClick={abrir} ocupado={accion.ocupado}>Abrir conteo</Boton>
                </div>
              ) : prod.cargando ? (
                <p class="texto-suave">Cargando productos…</p>
              ) : (
                <ConteoAbierto key={abierto.conteoId} abierto={abierto} productos={prod.lista} alCambiar={recargar} />
              )}
              {accion.error && <Alerta>{accion.error}</Alerta>}
            </Seccion>
            <Seccion titulo="Conteos anteriores">
              {cerrados.length === 0 && <Vacio titulo="Todavía no hay conteos cerrados" />}
              {cerrados.map((c) => (
                <div key={c.conteoId} class="tarjeta-interna">
                  <strong>{nombreAlmacen(c.ubicacionId)}</strong> · {fechaHora(c.fecha)}
                  {c.resultado && (
                    <Tabla
                      titulo="Resultado del conteo"
                      filas={c.resultado}
                      clave={(r) => r.productoId}
                      porPagina={100}
                      columnas={[
                        { id: 'producto', titulo: 'Producto', valor: (r) => nombre(r.productoId), encabezadoFila: true },
                        { id: 'sistema', titulo: 'Sistema', valor: (r) => r.teorico },
                        { id: 'contado', titulo: 'Contado', valor: (r) => r.contado },
                        { id: 'diferencia', titulo: 'Diferencia', valor: (r) => r.diferencia, celda: (r) => <span class={r.diferencia < 0 ? 'texto-error' : ''}>{r.diferencia}</span> },
                      ]}
                    />
                  )}
                </div>
              ))}
            </Seccion>
          </div>
        );
      }}
    </ConCarga>
  );
}
