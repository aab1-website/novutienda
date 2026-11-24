import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { ErrorApi } from '../../api/errores.js';
import { Alerta, Boton, Campo, Casilla, ConCarga, Selector, Seccion } from '../../ui/comun.js';
import { Dialogo } from '../../ui/dialogo.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { Tabla } from '../../ui/tabla.js';
import {
  aplicarCategoria, claveDesdeNombre, ICONOS_CATEGORIA, leerCategorias, mensajeDeCategorias, moverCategoria, revisarCategoria, TOPES_CATEGORIAS, unirCategorias,
  type CategoriaVista, type NegocioCrudo,
} from './categorias-logica.js';

/** Lectura de `sitio/negocio`, guardado con control de versión (solo adm) y las categorías que escriben los productos. */
export interface ServicioCategorias {
  leer(): Promise<{ readonly negocio: NegocioCrudo | null; readonly version: number; readonly invalido?: readonly string[] }>;
  guardar(negocio: NegocioCrudo, versionEsperada: number): Promise<{ readonly version: number }>;
  /** La categoría de cada producto (una por producto). */
  categoriasDeProductos(): Promise<readonly string[]>;
}

interface Cargado { readonly negocio: NegocioCrudo | null; readonly version: number; readonly invalido: boolean; readonly claves: readonly string[] }

const nombreIcono = (id: string): string => ICONOS_CATEGORIA.find((i) => i.id === id)?.nombre ?? id;
const textoEstado = (c: CategoriaVista): string => (c.oculta ? 'Oculta' : c.definida ? 'Visible' : 'Sin nombre propio');

/** Edición de una categoría existente (`categoria`) o creación (`null`), siempre en un panel lateral. */
function Edicion({ categoria, negocio, claves, guardando, error, onGuardar, onCerrar }: {
  categoria: CategoriaVista | null; negocio: NegocioCrudo; claves: readonly string[]; guardando: boolean; error: string | null;
  onGuardar: (negocio: NegocioCrudo) => void; onCerrar: () => void;
}): JSX.Element {
  const [nombre, setNombre] = useState(categoria?.nombre ?? '');
  const [icono, setIcono] = useState(categoria?.icono ?? 'cuadricula');
  const [oculta, setOculta] = useState(categoria?.oculta ?? false);
  const [intento, setIntento] = useState(false);
  const errores = intento ? revisarCategoria({ nombre, icono }, categoria === null ? { negocio, claves } : null, categoria?.definida === false ? negocio : undefined) : {};
  const clave = categoria?.clave ?? claveDesdeNombre(nombre);
  const sucio = categoria === null ? nombre.trim() !== '' : nombre !== categoria.nombre || icono !== categoria.icono || oculta !== categoria.oculta || !categoria.definida;

  const guardar = (): void => {
    setIntento(true);
    if (Object.keys(revisarCategoria({ nombre, icono }, categoria === null ? { negocio, claves } : null, categoria?.definida === false ? negocio : undefined)).length > 0) return;
    onGuardar(aplicarCategoria(negocio, clave, { nombre, icono, oculta }));
  };

  return (
    <Dialogo
      titulo={categoria === null ? 'Nueva categoría' : `Categoría: ${categoria.nombre}`}
      variante="lateral"
      sucio={sucio}
      onCerrar={onCerrar}
      pie={(
        <>
          <Boton variante="secundario" onClick={onCerrar}>Cancelar</Boton>
          <Boton onClick={guardar} ocupado={guardando}>Guardar</Boton>
        </>
      )}
    >
      <form class="ficha-formulario" onSubmit={(ev) => { ev.preventDefault(); guardar(); }} noValidate>
        <Campo etiqueta="Nombre de la categoría" valor={nombre} tope={TOPES_CATEGORIAS.nombre.max} requerido error={errores.nombre} ayuda={'El nombre es lo que ven sus clientes, por ejemplo "Línea blanca". La dirección de la página no cambia.'} onInput={setNombre} />
        <Selector etiqueta="Ícono" valor={icono} opciones={ICONOS_CATEGORIA.map((i) => ({ valor: i.id, texto: i.nombre }))} onCambio={setIcono} />
        {categoria === null ? (
          <p class="texto-suave">
            Aparece en el sitio cuando un producto la use; en el producto escriba "{clave === '' ? 'linea-blanca' : clave}".
          </p>
        ) : (
          <>
            <p class="texto-suave">Se escribe en el producto como "{categoria.clave}". Esa palabra no se puede cambiar.</p>
            <Casilla etiqueta="Ocultar esta categoría" marcado={oculta} onCambio={setOculta} />
            <p class="texto-suave">Oculta, sus productos no salen en el sitio ni en el catálogo de WhatsApp después de publicar. Siguen en inventario y en caja.</p>
          </>
        )}
        {errores.categorias !== undefined && <Alerta>{errores.categorias}</Alerta>}
        {error !== null && <Alerta>{error}</Alerta>}
      </form>
    </Dialogo>
  );
}

function Contenido({ servicio, d, recargar }: { servicio: ServicioCategorias; d: Cargado; recargar: () => void }): JSX.Element {
  const accion = useAccion();
  const [abierta, setAbierta] = useState<{ categoria: CategoriaVista | null } | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [errorCategoria, setErrorCategoria] = useState<string | null>(null);
  const [local, setLocal] = useState<{ negocio: NegocioCrudo; version: number } | null>(null);
  const negocio = local?.negocio ?? d.negocio;
  const version = local?.version ?? d.version;

  if (negocio === null) {
    return (
      <Alerta tipo="info">
        {d.invalido
          ? 'Los datos generales del sitio guardados tienen un error y no se pueden editar desde aquí. Pida ayuda a quien administra el sitio.'
          : 'Primero complete Textos del sitio: todavía no hay datos generales del sitio guardados.'}
      </Alerta>
    );
  }

  const vista = unirCategorias(negocio, d.claves);
  const guardar = (nuevo: NegocioCrudo, alExito?: () => void): void => {
    setErrorCategoria(null);
    setGuardado(false);
    void accion.ejecutar(async () => {
      try {
        const r = await servicio.guardar(nuevo, version);
        setLocal({ negocio: nuevo, version: r.version });
        setGuardado(true);
        alExito?.();
      } catch (e) {
        // Rutas `categorias.<clave>.<campo>`: se dice qué categoría y qué arreglar, no el texto genérico.
        const m = e instanceof ErrorApi ? mensajeDeCategorias(e.detalle.detalles ?? [], nuevo) : null;
        if (m === null) throw e;
        setErrorCategoria(m);
      }
    });
  };

  return (
    <>
      <p class="texto-suave">Las categorías agrupan los productos en el sitio. Los cambios se ven en la página después de pulsar Publicar.</p>
      <div class="fila">
        <Boton onClick={() => setAbierta({ categoria: null })} deshabilitado={Object.keys(leerCategorias(negocio)).length >= TOPES_CATEGORIAS.max}>Nueva categoría</Boton>
      </div>
      {(errorCategoria ?? accion.error) !== null && abierta === null && (
        <Alerta>
          <span>{errorCategoria ?? accion.error}</span>
          <Boton chico variante="secundario" onClick={recargar}>Volver a cargar</Boton>
        </Alerta>
      )}
      {guardado && accion.error === null && <Alerta tipo="ok">Guardado. Falta publicar el sitio para que los cambios se vean.</Alerta>}
      <Tabla
        titulo="Categorías del sitio"
        vistaCelular="tarjetas"
        porPagina={100}
        filas={vista}
        clave={(c) => c.clave}
        vacio={{ titulo: 'Todavía no hay categorías' }}
        columnas={[
          { id: 'nombre', titulo: 'Nombre', valor: (c) => c.nombre, encabezadoFila: true },
          { id: 'icono', titulo: 'Ícono', valor: (c) => nombreIcono(c.icono) },
          { id: 'productos', titulo: 'Productos', valor: (c) => c.productos, celda: (c) => String(c.productos), numerica: true },
          { id: 'estado', titulo: 'Estado', valor: (c) => textoEstado(c) },
        ]}
        acciones={(c) => {
          const i = vista.filter((x) => x.definida).findIndex((x) => x.clave === c.clave);
          const total = vista.filter((x) => x.definida).length;
          return (
            <div class="fila">
              <Boton chico variante="secundario" etiqueta={`Editar ${c.nombre}`} onClick={() => { setGuardado(false); setAbierta({ categoria: c }); }}>Editar</Boton>
              {c.definida && (
                <>
                  <Boton chico variante="secundario" etiqueta={`Subir ${c.nombre}`} deshabilitado={i <= 0 || accion.ocupado} onClick={() => guardar(moverCategoria(negocio, vista, c.clave, -1))}>Subir</Boton>
                  <Boton chico variante="secundario" etiqueta={`Bajar ${c.nombre}`} deshabilitado={i < 0 || i >= total - 1 || accion.ocupado} onClick={() => guardar(moverCategoria(negocio, vista, c.clave, 1))}>Bajar</Boton>
                </>
              )}
            </div>
          );
        }}
      />
      {abierta !== null && (
        <Edicion
          categoria={abierta.categoria} negocio={negocio} claves={vista.map((v) => v.clave)} guardando={accion.ocupado} error={errorCategoria ?? accion.error}
          onGuardar={(n) => guardar(n, () => setAbierta(null))}
          onCerrar={() => setAbierta(null)}
        />
      )}
    </>
  );
}

/** Pestaña «Categorías» de «Catálogo y sitio» (solo administrador). */
export function PantallaCategorias({ servicio }: { servicio: ServicioCategorias }): JSX.Element {
  const carga = useCarga<Cargado>(async () => {
    const [r, claves] = await Promise.all([servicio.leer(), servicio.categoriasDeProductos()]);
    return { negocio: r.negocio, version: r.version, invalido: (r.invalido?.length ?? 0) > 0, claves };
  }, []);
  return (
    <Seccion titulo="Categorías">
      <ConCarga carga={carga}>{(d) => <Contenido key={d.version} servicio={servicio} d={d} recargar={carga.recargar} />}</ConCarga>
    </Seccion>
  );
}
