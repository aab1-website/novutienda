import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { nuevoId } from '../../api/cliente.js';
import { ErrorApi } from '../../api/errores.js';
import type { FilaSimulada, ResultadoImportacion, Simulacion } from '../../api/tipos.js';
import { useAvisos } from '../../ui/avisos.js';
import { Alerta, Boton, Casilla, Seccion } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { Dialogo } from '../../ui/dialogo.js';
import { useCambiosSinGuardar } from '../../ui/guardia.js';
import { useAccion } from '../../ui/hooks.js';
import { useIdUnico } from '../../ui/ids.js';
import { Tabla } from '../../ui/tabla.js';
import { aBase64, formatoBytes } from '../../util/base64.js';
import { aCsv, descargarTexto } from '../../util/csv.js';
import {
  ACCION_TEXTO, ACEPTA_ARCHIVO, aplicables, COLUMNAS_ARCHIVO, COLUMNAS_STOCK, encabezadosPlantilla, lineasConfirmacion, MAX_BYTES_ARCHIVO, MAX_FILAS, ordenarFilas, resumenSimulacion,
  avisoOmitidas, lineasConError, TEXTO_ARCHIVO_CAMBIO, textoDetencion, textoError, textoResultado, textoTandas, validarArchivo,
} from './importar-logica.js';
import './inventario.css';

interface Fuente {
  readonly nombre: string;
  readonly bytes: number;
  /** Contenido en base64: el servidor distingue CSV de Excel por la firma del archivo. */
  readonly archivo: string;
}

function Detalle({ f }: { f: FilaSimulada }): JSX.Element {
  return (
    <>
      {f.errores.length > 0 && <ul class="lista-simple">{f.errores.map((e) => <li key={textoError(e)} class="texto-error">{textoError(e)}</li>)}</ul>}
      {f.advertencias.length > 0 && <ul class="lista-simple">{f.advertencias.map((a) => <li key={a} class="texto-suave">Aviso: {a}</li>)}</ul>}
      {f.accion === 'actualizar' && f.cambios.length > 0 && <span class="texto-suave">Cambia: {f.cambios.join(', ')}</span>}
      {f.errores.length === 0 && f.advertencias.length === 0 && (f.accion !== 'actualizar' || f.cambios.length === 0) ? '—' : null}
    </>
  );
}

function TablaSimulacion({ sim }: { sim: Simulacion }): JSX.Element {
  return (
    <Tabla
      titulo="Simulación de la importación"
      filas={ordenarFilas(sim.filas)}
      clave={(f) => String(f.linea)}
      porPagina={25}
      buscar={{ etiqueta: 'Buscar por producto', en: (f) => [f.id] }}
      filtros={[{ id: 'accion', etiqueta: 'Acción', opciones: (Object.keys(ACCION_TEXTO) as FilaSimulada['accion'][]).map((a) => ({ valor: a, texto: ACCION_TEXTO[a] })), aplica: (f, v) => f.accion === v }]}
      vacio={{ titulo: 'El archivo no trae filas de datos.' }}
      columnas={[
        { id: 'linea', titulo: 'Línea', valor: (f) => f.linea },
        { id: 'id', titulo: 'Producto', valor: (f) => f.id, encabezadoFila: true },
        { id: 'accion', titulo: 'Acción', valor: (f) => ACCION_TEXTO[f.accion], celda: (f) => <span class={f.accion === 'error' ? 'texto-error' : undefined}>{ACCION_TEXTO[f.accion]}</span> },
        { id: 'detalle', titulo: 'Detalle', valor: (f) => f.errores.map((e) => e.motivo).join(' '), celda: (f) => <Detalle f={f} /> },
      ]}
    />
  );
}

/** Importar productos (carga inicial y actualización masiva) y exportarlos. Los productos entran solo por aquí. */
export function ImportarExportar(): JSX.Element {
  const { api, usuario } = useApp();
  const avisos = useAvisos();
  const idArchivo = useIdUnico();
  const exportacion = useAccion();
  const simulacion = useAccion();
  const importacion = useAccion();
  const [inicial, setInicial] = useState(false);
  const [fuente, setFuente] = useState<Fuente | null>(null);
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null);
  const [sim, setSim] = useState<Simulacion | null>(null);
  const [confirmando, setConfirmando] = useState<{ omitir: boolean } | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);
  const operacion = useRef<{ clave: string; id: string } | null>(null);
  const vigente = useRef(0);
  /** Líneas con error que la persona vio en la simulación y aceptó omitir al confirmar. */
  const aceptadas = useRef<number[]>([]);
  const [archivoCambio, setArchivoCambio] = useState(false);
  const { marcarGuardado } = useCambiosSinGuardar(fuente !== null, ['inventarios.importar']);
  const esAdm = usuario.rol === 'adm';

  const exportar = (): void => {
    void exportacion.ejecutar(async () => {
      const { csv } = await api.llamar('exportarProductosCsv', {});
      descargarTexto('productos.csv', csv);
    }, { exito: 'Archivo exportado.', error: 'ambos' });
  };
  const plantilla = (): void => {
    descargarTexto(inicial ? 'plantilla-carga-inicial.csv' : 'plantilla-productos.csv', aCsv(encabezadosPlantilla(inicial), []));
  };

  const simular = (f: Fuente, cargaInicial: boolean): void => {
    const turno = (vigente.current += 1);
    setSim(null);
    setArchivoCambio(false);
    operacion.current = null;
    void simulacion.ejecutar(async () => {
      const s = await api.llamar('simularImportacionProductos', { archivo: f.archivo, cargaInicial });
      if (turno === vigente.current) setSim(s);
    });
  };

  const elegir = (e: Event): void => {
    const input = e.currentTarget as HTMLInputElement;
    const archivo = input.files?.[0];
    if (archivo === undefined) return;
    const malo = validarArchivo(archivo);
    input.value = '';
    setResultado(null);
    if (malo !== null) {
      setErrorArchivo(malo);
      return;
    }
    setErrorArchivo(null);
    void archivo.arrayBuffer().then(
      (buf) => {
        const f: Fuente = { nombre: archivo.name, bytes: archivo.size, archivo: aBase64(new Uint8Array(buf)) };
        setFuente(f);
        simular(f, inicial);
      },
      () => setErrorArchivo('No se pudo leer el archivo. Vuelva a elegirlo.'),
    );
  };

  const alternarInicial = (v: boolean): void => {
    setInicial(v);
    if (fuente !== null) simular(fuente, v);
  };

  const descartar = (): void => {
    vigente.current += 1;
    setFuente(null);
    setSim(null);
    setResultado(null);
    setErrorArchivo(null);
    operacion.current = null;
    aceptadas.current = [];
    setArchivoCambio(false);
    importacion.limpiar();
    simulacion.limpiar();
    marcarGuardado();
  };

  /** Importa (o continúa) con el mismo `operacionId` mientras el archivo y las opciones no cambien: no duplica lo ya aplicado. */
  const importar = (omitir: boolean): void => {
    if (fuente === null || sim === null) return;
    const clave = JSON.stringify([fuente.archivo.length, fuente.nombre, inicial, omitir]);
    if (operacion.current?.clave !== clave) operacion.current = { clave, id: nuevoId() };
    const operacionId = operacion.current.id;
    if (omitir) aceptadas.current = lineasConError(sim);
    void importacion.ejecutar(async () => {
      try {
        // PENDIENTE (Central): el contrato del panel aún no admite `lineasOmitidas: number[]` (las líneas en error de la
        // simulación aceptada, para que el servidor verifique que omite exactamente esas). Cuando exista en
        // `api/contrato.ts`, enviar aquí `...(omitir ? { lineasOmitidas: aceptadas.current } : {})`.
        const r = await api.llamar('importarProductosCsv', { operacionId, archivo: fuente.archivo, cargaInicial: inicial, omitirErrores: omitir });
        setResultado(r);
        setConfirmando(null);
        if (r.completa) {
          avisos.ok(`Importación terminada: ${textoResultado(r)}.`);
          setFuente(null);
          setSim(null);
          operacion.current = null;
          marcarGuardado();
        }
      } catch (e) {
        // El servidor ya tiene una importación con ese identificador pero con otro archivo: no se puede continuar.
        if (!(e instanceof ErrorApi) || e.detalle.codigo !== 'operacion-conflicto') throw e;
        operacion.current = null;
        setConfirmando(null);
        setResultado(null);
        setArchivoCambio(true);
      }
    });
  };

  const r = sim?.resumen;
  const nAplicar = r === undefined ? 0 : aplicables(r);
  const hayErrores = (r?.errores ?? 0) > 0;
  const omitidas = resultado === null ? null : avisoOmitidas(resultado, aceptadas.current);

  return (
    <div>
      <Seccion titulo="Importar productos">
        <p>
          Sirve para la <strong>carga inicial</strong> de productos y para <strong>actualizar muchos a la vez</strong>. Los productos entran al sistema solo por Inventario; una vez cargados, cada uno puede publicarse o no
          en el catálogo del sitio, y no puede haber en el catálogo un producto que no esté aquí.
        </p>
        <p class="texto-suave">Primero se muestra una simulación fila por fila; no se guarda nada hasta que usted confirma. Acepta archivos CSV o Excel (.xlsx) de hasta {formatoBytes(MAX_BYTES_ARCHIVO)} y {String(MAX_FILAS)} filas.</p>
        <details>
          <summary>Qué columnas lleva el archivo</summary>
          <ul class="lista-simple">
            {COLUMNAS_ARCHIVO.map((c) => <li key={c.nombre}><strong>{c.nombre}</strong>: {c.texto}</li>)}
          </ul>
          <p class="texto-suave">Si el producto ya existe, solo se cambian las columnas que el archivo trae. Una fila nueva sin SKU es un error. Los precios van en dólares, con decimales.</p>
        </details>
        <div class="fila">
          <Boton variante="secundario" onClick={plantilla}>Descargar plantilla</Boton>
          <Boton variante="secundario" onClick={exportar} ocupado={exportacion.ocupado}>Exportar productos</Boton>
        </div>
        <p class="texto-suave">«Exportar productos» baja los productos actuales en este mismo formato: sirve para editarlos en una planilla y volver a cargarlos.</p>
        {exportacion.error && <Alerta>{exportacion.error}</Alerta>}

        {!esAdm ? (
          <p class="texto-suave">La importación la hace un administrador.</p>
        ) : (
          <div class="formulario">
            <Casilla etiqueta="Es la carga inicial: el archivo trae existencias" marcado={inicial} onCambio={alternarInicial} deshabilitado={importacion.ocupado || simulacion.ocupado} />
            <p class="ayuda">
              Márquela solo la primera vez, para cargar las existencias de productos nuevos con {COLUMNAS_STOCK.map((c) => c.nombre).join(', ')}. En una actualización normal déjela sin marcar: el archivo no modifica el stock y un archivo con esas columnas se rechaza.
            </p>
            <div class="campo">
              <label for={idArchivo}>Archivo de productos (CSV o Excel)</label>
              <input
                id={idArchivo}
                type="file"
                accept={ACEPTA_ARCHIVO}
                disabled={importacion.ocupado}
                aria-invalid={errorArchivo !== null ? 'true' : undefined}
                aria-describedby={errorArchivo !== null ? `${idArchivo}-error` : undefined}
                onChange={elegir}
              />
              {errorArchivo !== null && <p id={`${idArchivo}-error`} class="campo-error">Error: {errorArchivo}</p>}
            </div>
            {simulacion.ocupado && <p role="status">Simulando la importación…</p>}
            {simulacion.error && (
              <Alerta>
                <span>{simulacion.error}</span>
                <span class="texto-suave">
                  {' '}Si el archivo trae columnas de existencias ({COLUMNAS_STOCK.map((c) => c.nombre).join(', ')}), marque «Es la carga inicial». Revise también que la primera fila sea el encabezado y que exista la columna id.
                </span>
              </Alerta>
            )}
            {fuente !== null && (
              <p class="texto-suave">
                Archivo: <strong>{fuente.nombre}</strong> ({formatoBytes(fuente.bytes)}).{' '}
                <Boton chico variante="secundario" onClick={descartar} etiqueta="Quitar archivo elegido">Quitar archivo</Boton>
              </p>
            )}
          </div>
        )}
      </Seccion>

      {esAdm && sim !== null && r !== undefined && (
        <Seccion titulo="Simulación: así quedaría el inventario">
          <p role="status" data-prueba="resumen-simulacion"><strong>{resumenSimulacion(r)}.</strong></p>
          {sim.columnasIgnoradas.length > 0 && <Alerta tipo="info">Estas columnas no se usan y se ignoran: {sim.columnasIgnoradas.join('; ')}.</Alerta>}
          <TablaSimulacion sim={sim} />
          <div class="fila">
            <Boton
              onClick={() => setConfirmando({ omitir: false })}
              motivo={hayErrores ? `El archivo tiene ${String(r.errores)} ${r.errores === 1 ? 'fila' : 'filas'} con error. Corríjalo y vuelva a elegirlo, o importe solo las válidas.` : nAplicar === 0 ? 'No hay filas para crear ni actualizar.' : undefined}
            >
              {`Importar ${String(nAplicar)} ${nAplicar === 1 ? 'fila' : 'filas'}`}
            </Boton>
            {hayErrores && (
              <Boton variante="secundario" onClick={() => setConfirmando({ omitir: true })} motivo={nAplicar === 0 ? 'Ninguna fila es válida: no hay nada que importar.' : undefined}>
                {`Importar las filas válidas y omitir las ${String(r.errores)} con error`}
              </Boton>
            )}
          </div>
        </Seccion>
      )}

      {archivoCambio && (
        <Seccion titulo="Resultado de la importación">
          <Alerta>{TEXTO_ARCHIVO_CAMBIO}</Alerta>
          <Boton onClick={descartar}>Empezar de nuevo</Boton>
        </Seccion>
      )}

      {resultado !== null && (
        <Seccion titulo="Resultado de la importación">
          {resultado.completa ? (
            <>
              <Alerta tipo="ok">Importación terminada: {textoResultado(resultado)}. {textoTandas(resultado)}.</Alerta>
              {omitidas !== null && <Alerta tipo="info">{omitidas.texto}</Alerta>}
              {omitidas?.difiere != null && <Alerta>{omitidas.difiere}</Alerta>}
            </>
          ) : (
            <>
              <Alerta>
                La importación quedó incompleta: {textoTandas(resultado)}. Ya se aplicó: {textoResultado(resultado)}. {textoDetencion(resultado.detencion)}
              </Alerta>
              <p class="texto-suave">Lo aplicado se queda. «Continuar» sigue con las tandas que faltan sin repetir las anteriores.</p>
              {omitidas !== null && <Alerta tipo="info">{omitidas.texto}</Alerta>}
              {omitidas?.difiere != null && <Alerta>{omitidas.difiere}</Alerta>}
              <Boton onClick={() => importar(resultado.omitidas > 0)} ocupado={importacion.ocupado}>Continuar la importación</Boton>
              {importacion.error && <Alerta>{importacion.error}</Alerta>}
            </>
          )}
        </Seccion>
      )}

      {confirmando !== null && sim !== null && (
        <Dialogo
          variante="centro"
          titulo={confirmando.omitir ? '¿Importar solo las filas válidas?' : '¿Importar este archivo?'}
          descripcion="Revise antes de confirmar."
          foco="seguro"
          onCerrar={() => { if (!importacion.ocupado) { setConfirmando(null); importacion.limpiar(); } }}
          pie={
            <>
              <button type="button" class="boton boton-secundario" data-seguro disabled={importacion.ocupado} onClick={() => { setConfirmando(null); importacion.limpiar(); }}>Volver</button>
              <Boton onClick={() => importar(confirmando.omitir)} ocupado={importacion.ocupado}>{confirmando.omitir ? 'Sí, importar y omitir las filas con error' : 'Sí, importar'}</Boton>
            </>
          }
        >
          <ul class="lista-simple inv-resumen" data-prueba="resumen-importacion">
            {lineasConfirmacion(sim, confirmando.omitir, inicial).map((l) => <li key={l}>{l}</li>)}
          </ul>
          {importacion.ocupado && <p role="status" aria-live="polite">Importando por tandas. No cierre esta ventana hasta que termine.</p>}
          {importacion.error !== null && <Alerta>{importacion.error}</Alerta>}
        </Dialogo>
      )}
    </div>
  );
}
