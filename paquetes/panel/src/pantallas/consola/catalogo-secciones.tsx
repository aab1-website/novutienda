import type { JSX } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { LIMITES_PANEL, type Bloque, type Seccion as SeccionWeb } from '../../api/tipos.js';
import { Alerta, Area, Boton, BotonConfirmado, Campo, Casilla, Cargando, ErrorCarga, Seccion, Vacio } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { enfocarPrimerError } from '../../ui/formulario.js';
import { useBorrador, useCambiosSinGuardar, useGuardia } from '../../ui/guardia.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { Miniatura } from './miniatura-vista.js';
import { SelectorBuscable } from '../../ui/selector-buscable.js';

const idDe = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/**
 * Identificador local y estable de cada bloque y de cada foto de un carrusel: sirve de `key` y de pieza del estado de
 * los campos, así que quitar un bloque nunca deja el texto de uno en el lugar de otro. No se envía al servidor.
 */
let serieLocal = 0;
const nuevoUid = (): string => `l${String((serieLocal += 1))}`;

interface FotoLocal { readonly uid: string; readonly medioId: string; readonly alt: string }
type BloqueLocal =
  | { readonly uid: string; readonly tipo: 'texto'; readonly titulo: string; readonly parrafos: readonly string[] }
  | { readonly uid: string; readonly tipo: 'imagen'; readonly medioId: string; readonly alt: string }
  | { readonly uid: string; readonly tipo: 'carrusel'; readonly items: readonly FotoLocal[] }
  | { readonly uid: string; readonly tipo: 'enlaces'; readonly items: readonly { readonly texto: string; readonly url: string }[] };
interface SeccionLocal { readonly id: string; readonly titulo: string; readonly visible: boolean; readonly bloques: readonly BloqueLocal[] }

function aLocal(s: SeccionWeb): SeccionLocal {
  const bloque = (b: Bloque): BloqueLocal => (b.tipo === 'carrusel' ? { uid: nuevoUid(), tipo: 'carrusel', items: b.items.map((x) => ({ uid: nuevoUid(), ...x })) } : { uid: nuevoUid(), ...b });
  return { id: s.id, titulo: s.titulo, visible: s.visible, bloques: s.bloques.map(bloque) };
}

/** Lo que se guarda: sin los identificadores locales. */
function aWeb(s: SeccionLocal): SeccionWeb {
  const bloque = (b: BloqueLocal): Bloque => {
    switch (b.tipo) {
      case 'texto': return { tipo: 'texto', titulo: b.titulo, parrafos: b.parrafos };
      case 'imagen': return { tipo: 'imagen', medioId: b.medioId, alt: b.alt };
      case 'carrusel': return { tipo: 'carrusel', items: b.items.map((x) => ({ medioId: x.medioId, alt: x.alt })) };
      case 'enlaces': return { tipo: 'enlaces', items: b.items };
    }
  };
  return { id: s.id, titulo: s.titulo, visible: s.visible, bloques: s.bloques.map(bloque) };
}

const huella = (s: SeccionLocal): string => JSON.stringify(aWeb(s));
const NOMBRE_BLOQUE = { texto: 'Texto', imagen: 'Imagen', carrusel: 'Carrusel', enlaces: 'Enlaces' } as const;

/** Primera razón por la que la sección aún no se puede guardar (con el siguiente paso), o `undefined`. */
function motivoSinGuardar(s: SeccionLocal): string | undefined {
  if (s.titulo.trim() === '') return 'Escriba el nombre de la sección.';
  if (s.bloques.length === 0) return 'Agregue al menos un bloque a la sección.';
  for (const [i, b] of s.bloques.entries()) {
    if (b.tipo === 'imagen' && b.medioId === '') return `Elija la foto del bloque ${String(i + 1)}.`;
    if (b.tipo === 'carrusel' && b.items.some((x) => x.medioId === '')) return `Elija la foto que falta en el carrusel del bloque ${String(i + 1)}.`;
  }
  return undefined;
}

function SelectorFoto({ valor, alElegir, etiqueta }: { valor: string; alElegir: (id: string) => void; etiqueta: string }): JSX.Element {
  const { api } = useApp();
  const productos = useCarga(() => api.llamar('listarProductos', {}), []);
  // Sin producto elegido de antemano: se busca y se elige.
  const [productoId, setProductoId] = useState<string | null>(null);
  const grupo = useId();
  const medios = useCarga(() => (productoId === null ? Promise.resolve([]) : api.llamar('listarMedios', { productoId })), [productoId]);
  const fotos = (medios.datos ?? []).filter((m) => m.tipo === 'foto');
  const actualSuelta = valor !== '' && !fotos.some((m) => m.id === valor);
  const nombreProducto = (productos.datos ?? []).find((p) => p.id === productoId)?.nombre;
  return (
    <div class="cuadricula">
      <SelectorBuscable etiqueta={`${etiqueta}: producto`} valor={productoId} onCambio={setProductoId} opciones={(productos.datos ?? []).map((p) => ({ valor: p.id, texto: p.nombre }))} />
      <fieldset class="selector-miniaturas" aria-label={`${etiqueta}: foto`}>
        {valor === '' && fotos.length === 0 && <p class="texto-suave">{productoId === null ? 'Primero elija el producto' : 'Este producto no tiene fotos'}</p>}
        <label>
          <input type="radio" name={grupo} value="" checked={valor === ''} aria-label="Sin foto" onChange={() => alElegir('')} />
          <span class="miniatura miniatura-respaldo">Sin foto</span>
        </label>
        {actualSuelta && (
          <label key={valor}>
            <input type="radio" name={grupo} value={valor} checked aria-label={`Foto ${valor.slice(0, 6)} (actual)`} onChange={() => alElegir(valor)} />
            <Miniatura alt="Foto actual" respaldo={`Foto ${valor.slice(0, 6)}`} />
          </label>
        )}
        {fotos.map((m, i) => (
          <label key={m.id}>
            <input type="radio" name={grupo} value={m.id} checked={m.id === valor} aria-label={`Foto ${String(i + 1)}${nombreProducto !== undefined ? ` de ${nombreProducto}` : ''}`} onChange={() => alElegir(m.id)} />
            <Miniatura medio={m} alt={`Foto ${String(i + 1)}${nombreProducto !== undefined ? ` de ${nombreProducto}` : ''}`} respaldo={`Foto ${m.id.slice(0, 6)}`} orden={i + 1} />
          </label>
        ))}
      </fieldset>
    </div>
  );
}

/** Área de texto con su propio valor: no se recorta mientras se escribe (los espacios finales son parte de la escritura). */
function AreaLibre({ etiqueta, inicial, filas, alCambiar }: { etiqueta: string; inicial: string; filas: number; alCambiar: (v: string) => void }): JSX.Element {
  const [v, setV] = useState(inicial);
  return <Area etiqueta={etiqueta} valor={v} filas={filas} onInput={(x) => { setV(x); alCambiar(x); }} />;
}

function EditorBloque({ b, n, set, quitar }: { b: BloqueLocal; n: number; set: (b: BloqueLocal) => void; quitar: () => void }): JSX.Element {
  let cuerpo: JSX.Element;
  if (b.tipo === 'texto') {
    cuerpo = (
      <>
        <Campo etiqueta="Subtítulo del texto (opcional)" valor={b.titulo} onInput={(v) => set({ ...b, titulo: v })} />
        <AreaLibre etiqueta="Párrafos (separe con una línea en blanco)" inicial={b.parrafos.join('\n\n')} filas={4} alCambiar={(v) => set({ ...b, parrafos: v.split(/\n\s*\n/).map((x) => x.trim()).filter((x) => x !== '') })} />
      </>
    );
  } else if (b.tipo === 'imagen') {
    cuerpo = (
      <>
        <SelectorFoto etiqueta="Imagen" valor={b.medioId} alElegir={(id) => set({ ...b, medioId: id })} />
        <Campo etiqueta="Texto alternativo" valor={b.alt} onInput={(v) => set({ ...b, alt: v })} />
      </>
    );
  } else if (b.tipo === 'carrusel') {
    cuerpo = (
      <>
        {b.items.map((it, i) => (
          <div key={it.uid} class="fila fila-alinear">
            <SelectorFoto etiqueta={`Foto ${i + 1}`} valor={it.medioId} alElegir={(id) => set({ ...b, items: b.items.map((x) => (x.uid === it.uid ? { ...x, medioId: id } : x)) })} />
            <Campo etiqueta={`Texto alternativo de la foto ${i + 1}`} valor={it.alt} onInput={(v) => set({ ...b, items: b.items.map((x) => (x.uid === it.uid ? { ...x, alt: v } : x)) })} />
            <Boton chico variante="secundario" onClick={() => set({ ...b, items: b.items.filter((x) => x.uid !== it.uid) })}>Quitar foto</Boton>
          </div>
        ))}
        {b.items.length < 8 && <Boton chico variante="secundario" onClick={() => set({ ...b, items: [...b.items, { uid: nuevoUid(), medioId: '', alt: '' }] })}>Agregar foto al carrusel</Boton>}
      </>
    );
  } else {
    cuerpo = (
      <AreaLibre
        etiqueta="Enlaces (uno por línea: texto | dirección). Solo https o rutas del sitio."
        inicial={b.items.map((i) => `${i.texto} | ${i.url}`).join('\n')}
        alCambiar={(v) => set({ ...b, items: v.split('\n').map((l) => l.split('|')).filter((p) => p.length >= 2).map((p) => ({ texto: (p[0] ?? '').trim(), url: p.slice(1).join('|').trim() })) })}
        filas={3}
      />
    );
  }
  return (
    <fieldset class="fila-pago">
      <legend>Bloque de {NOMBRE_BLOQUE[b.tipo].toLowerCase()}</legend>
      {cuerpo}
      <BotonConfirmado chico peligro texto="Quitar bloque" pregunta={`¿Quitar el bloque ${String(n)} (${NOMBRE_BLOQUE[b.tipo].toLowerCase()})?`} resumen="Se pierde lo escrito en este bloque. Los demás no cambian." textoConfirmar="Sí, quitar" onConfirmar={quitar} />
    </fieldset>
  );
}

function EditorSeccion({ inicial, alTerminar }: { inicial: SeccionWeb; alTerminar: (guardada: boolean) => void }): JSX.Element {
  const { api } = useApp();
  const accion = useAccion();
  const { confirmarSalida } = useGuardia();
  const nueva = inicial.titulo === '';
  const clave = `consola.seccion.${nueva ? 'nueva' : inicial.id}`;
  const [base] = useState(() => aLocal(inicial));
  const borrador = useBorrador<SeccionLocal | null>(clave, null);
  const s = borrador.valor ?? base;
  const sucio = borrador.valor !== null && huella(borrador.valor) !== huella(base);
  const { marcarGuardado } = useCambiosSinGuardar(sucio, [clave]);
  const setS = (n: SeccionLocal): void => borrador.poner(n);
  const motivo = motivoSinGuardar(s);
  const formulario = useRef<HTMLFormElement>(null);
  const [intento, setIntento] = useState(0);
  const sinNombre = intento > 0 && s.titulo.trim() === '';
  // El aviso de «Guardar sección» lleva el foco al campo que falta.
  useEffect(() => {
    if (intento > 0 && formulario.current !== null && !enfocarPrimerError(formulario.current)) formulario.current.querySelector<HTMLElement>('fieldset input, fieldset textarea, fieldset button')?.focus();
  }, [intento]);
  const guardar = (e: Event): void => {
    e.preventDefault();
    if (motivo !== undefined) return;
    void accion.ejecutar(async () => {
      const web = aWeb(s);
      await api.llamar('guardarSeccion', { seccion: { ...web, id: nueva ? idDe(s.titulo) : s.id } });
      marcarGuardado();
      borrador.descartar();
      alTerminar(true);
    }, { error: 'ambos', exito: 'Sección guardada. Falta publicar el sitio.' });
  };
  const nuevoBloque = (tipo: Bloque['tipo']): BloqueLocal => {
    const uid = nuevoUid();
    return tipo === 'texto' ? { uid, tipo, titulo: '', parrafos: [] } : tipo === 'imagen' ? { uid, tipo, medioId: '', alt: '' } : { uid, tipo, items: [] };
  };
  return (
    <Seccion titulo={nueva ? 'Nueva sección' : `Sección: ${inicial.titulo}`} acciones={<Boton chico variante="secundario" onClick={() => confirmarSalida(() => { borrador.descartar(); alTerminar(false); })}>Cancelar</Boton>}>
      <form ref={formulario} class="formulario" onSubmit={guardar} noValidate>
        <Campo etiqueta="Nombre de la sección (aparece en el menú)" valor={s.titulo} onInput={(v) => setS({ ...s, titulo: v })} requerido error={sinNombre ? 'Falta el nombre.' : undefined} />
        <Casilla etiqueta="Visible en el menú" marcado={s.visible} onCambio={(v) => setS({ ...s, visible: v })} />
        {s.bloques.map((b, i) => (
          <EditorBloque key={b.uid} b={b} n={i + 1} set={(nb) => setS({ ...s, bloques: s.bloques.map((x) => (x.uid === b.uid ? nb : x)) })} quitar={() => setS({ ...s, bloques: s.bloques.filter((x) => x.uid !== b.uid) })} />
        ))}
        {s.bloques.length < 10 && (
          <div class="fila" role="group" aria-label="Agregar bloque">
            {(['texto', 'imagen', 'carrusel', 'enlaces'] as const).map((t) => (
              <Boton key={t} chico variante="secundario" onClick={() => setS({ ...s, bloques: [...s.bloques, nuevoBloque(t)] })}>
                + {NOMBRE_BLOQUE[t]}
              </Boton>
            ))}
          </div>
        )}
        {accion.error && <Alerta>{accion.error}</Alerta>}
        <Boton tipo="submit" ocupado={accion.ocupado} motivo={motivo} onIntento={() => setIntento((n) => n + 1)}>Guardar sección</Boton>
      </form>
    </Seccion>
  );
}

export function PantallaSecciones(): JSX.Element {
  const { api } = useApp();
  const lista = useCarga(() => api.llamar('listarSecciones', {}), []);
  const accion = useAccion();
  const [editando, setEditando] = useState<SeccionWeb | null>(null);
  if (lista.cargando) return <Cargando />;
  if (lista.error || !lista.datos) return <ErrorCarga error={lista.error ?? 'Sin datos'} reintentar={lista.recargar} />;
  if (editando !== null) return <EditorSeccion inicial={editando} alTerminar={(g) => { setEditando(null); if (g) lista.recargar(); }} />;
  const secciones = lista.datos;
  const mover = (i: number, d: number): void => {
    const ids = secciones.map((x) => x.id);
    const a = ids[i];
    const b = ids[i + d];
    if (a === undefined || b === undefined) return;
    ids[i] = b;
    ids[i + d] = a;
    void accion.ejecutar(async () => {
      await api.llamar('ordenarSecciones', { orden: ids });
      lista.recargar();
    });
  };
  return (
    <Seccion titulo={`Secciones del menú (${secciones.length} de ${LIMITES_PANEL.seccionesMax})`} acciones={<Boton chico onClick={() => setEditando({ id: '', titulo: '', visible: true, bloques: [] })} motivo={secciones.length >= LIMITES_PANEL.seccionesMax ? `Ya hay ${String(LIMITES_PANEL.seccionesMax)} secciones: elimine una para crear otra.` : undefined}>Nueva sección</Boton>}>
      <p class="texto-suave">Cada sección se arma con bloques tipados (texto, imagen, carrusel y enlaces); nunca con HTML libre.</p>
      {secciones.length === 0 && <Vacio titulo="Todavía no hay secciones" />}
      {accion.error && <Alerta>{accion.error}</Alerta>}
      <ol class="lista-simple">
        {secciones.map((s, i) => (
          <li key={s.id} class="fila fila-alinear fila-entre">
            <strong>{s.titulo}{s.visible ? '' : ' (oculta)'}</strong>
            <span class="fila">
              <Boton chico variante="secundario" onClick={() => mover(i, -1)} deshabilitado={i === 0} etiqueta={`Subir ${s.titulo}`}>Subir</Boton>
              <Boton chico variante="secundario" onClick={() => mover(i, 1)} deshabilitado={i === secciones.length - 1} etiqueta={`Bajar ${s.titulo}`}>Bajar</Boton>
              <Boton chico variante="secundario" onClick={() => setEditando(s)} etiqueta={`Editar ${s.titulo}`}>Editar</Boton>
              <BotonConfirmado chico peligro texto="Eliminar" pregunta={`¿Eliminar la sección «${s.titulo}»?`} textoConfirmar="Sí, eliminar" onConfirmar={() => void accion.ejecutar(async () => { await api.llamar('eliminarSeccion', { seccionId: s.id }); lista.recargar(); })} />
            </span>
          </li>
        ))}
      </ol>
    </Seccion>
  );
}
