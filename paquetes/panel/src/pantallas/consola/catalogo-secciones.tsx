import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { LIMITES_PANEL, type Bloque, type Seccion as SeccionWeb } from '../../api/tipos.js';
import { Alerta, Area, Boton, BotonConfirmado, Campo, Casilla, Cargando, ErrorCarga, Selector, Seccion, Vacio } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { useAccion, useCarga } from '../../ui/hooks.js';

const idDe = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function SelectorFoto({ valor, alElegir, etiqueta }: { valor: string; alElegir: (id: string) => void; etiqueta: string }): JSX.Element {
  const { api } = useApp();
  const productos = useCarga(() => api.llamar('listarProductos', {}), []);
  const [productoId, setProductoId] = useState('');
  const pid = productoId || productos.datos?.[0]?.id || '';
  const medios = useCarga(() => (pid === '' ? Promise.resolve([]) : api.llamar('listarMedios', { productoId: pid })), [pid]);
  return (
    <div class="cuadricula">
      <Selector etiqueta={`${etiqueta}: producto`} valor={pid} onCambio={setProductoId} opciones={(productos.datos ?? []).map((p) => ({ valor: p.id, texto: p.nombre }))} />
      <Selector etiqueta={`${etiqueta}: foto`} valor={valor} onCambio={alElegir} opciones={[{ valor: '', texto: 'Elija una foto' }, ...(medios.datos ?? []).filter((m) => m.tipo === 'foto').map((m) => ({ valor: m.id, texto: `Foto ${m.id.slice(0, 6)}` }))]} />
    </div>
  );
}

/** Área de texto con su propio valor: no se recorta mientras se escribe (los espacios finales son parte de la escritura). */
function AreaLibre({ etiqueta, inicial, filas, alCambiar }: { etiqueta: string; inicial: string; filas: number; alCambiar: (v: string) => void }): JSX.Element {
  const [v, setV] = useState(inicial);
  return <Area etiqueta={etiqueta} valor={v} filas={filas} onInput={(x) => { setV(x); alCambiar(x); }} />;
}

function EditorBloque({ b, set, quitar }: { b: Bloque; set: (b: Bloque) => void; quitar: () => void }): JSX.Element {
  let cuerpo: JSX.Element;
  if (b.tipo === 'texto') {
    cuerpo = (
      <>
        <Campo etiqueta="Título del bloque" valor={b.titulo} onInput={(v) => set({ ...b, titulo: v })} />
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
          <div key={i} class="fila fila-alinear">
            <SelectorFoto etiqueta={`Foto ${i + 1}`} valor={it.medioId} alElegir={(id) => set({ ...b, items: b.items.map((x, j) => (j === i ? { ...x, medioId: id } : x)) })} />
            <Campo etiqueta={`Texto alternativo de la foto ${i + 1}`} valor={it.alt} onInput={(v) => set({ ...b, items: b.items.map((x, j) => (j === i ? { ...x, alt: v } : x)) })} />
            <Boton chico variante="secundario" onClick={() => set({ ...b, items: b.items.filter((_, j) => j !== i) })}>Quitar foto</Boton>
          </div>
        ))}
        {b.items.length < 8 && <Boton chico variante="secundario" onClick={() => set({ ...b, items: [...b.items, { medioId: '', alt: '' }] })}>Agregar foto al carrusel</Boton>}
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
  const nombre = { texto: 'Texto', imagen: 'Imagen', carrusel: 'Carrusel', enlaces: 'Enlaces' }[b.tipo];
  return (
    <fieldset class="fila-pago">
      <legend>Bloque de {nombre.toLowerCase()}</legend>
      {cuerpo}
      <Boton chico variante="peligro" onClick={quitar}>Quitar bloque</Boton>
    </fieldset>
  );
}

function EditorSeccion({ inicial, alTerminar }: { inicial: SeccionWeb; alTerminar: (guardada: boolean) => void }): JSX.Element {
  const { api } = useApp();
  const accion = useAccion();
  const [s, setS] = useState<SeccionWeb>(inicial);
  const nueva = inicial.titulo === '';
  const guardar = (e: Event): void => {
    e.preventDefault();
    void accion.ejecutar(async () => {
      await api.llamar('guardarSeccion', { seccion: { ...s, id: nueva ? idDe(s.titulo) : s.id } });
      alTerminar(true);
    });
  };
  const nuevoBloque = (tipo: Bloque['tipo']): Bloque =>
    tipo === 'texto' ? { tipo, titulo: '', parrafos: [] } : tipo === 'imagen' ? { tipo, medioId: '', alt: '' } : tipo === 'carrusel' ? { tipo, items: [] } : { tipo, items: [] };
  return (
    <Seccion titulo={nueva ? 'Nueva sección' : `Sección: ${inicial.titulo}`} acciones={<Boton chico variante="secundario" onClick={() => alTerminar(false)}>Cancelar</Boton>}>
      <form class="formulario" onSubmit={guardar} noValidate>
        <Campo etiqueta="Título (texto del menú)" valor={s.titulo} onInput={(v) => setS({ ...s, titulo: v })} requerido />
        <Casilla etiqueta="Visible en el menú" marcado={s.visible} onCambio={(v) => setS({ ...s, visible: v })} />
        {s.bloques.map((b, i) => (
          <EditorBloque key={i} b={b} set={(nb) => setS({ ...s, bloques: s.bloques.map((x, j) => (j === i ? nb : x)) })} quitar={() => setS({ ...s, bloques: s.bloques.filter((_, j) => j !== i) })} />
        ))}
        {s.bloques.length < 10 && (
          <div class="fila" role="group" aria-label="Agregar bloque">
            {(['texto', 'imagen', 'carrusel', 'enlaces'] as const).map((t) => (
              <Boton key={t} chico variante="secundario" onClick={() => setS({ ...s, bloques: [...s.bloques, nuevoBloque(t)] })}>
                + {{ texto: 'Texto', imagen: 'Imagen', carrusel: 'Carrusel', enlaces: 'Enlaces' }[t]}
              </Boton>
            ))}
          </div>
        )}
        {accion.error && <Alerta>{accion.error}</Alerta>}
        <Boton tipo="submit" ocupado={accion.ocupado} deshabilitado={s.titulo.trim() === '' || s.bloques.length === 0}>Guardar sección</Boton>
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
    <Seccion titulo={`Secciones del menú (${secciones.length} de ${LIMITES_PANEL.seccionesMax})`} acciones={<Boton chico onClick={() => setEditando({ id: '', titulo: '', visible: true, bloques: [] })} deshabilitado={secciones.length >= LIMITES_PANEL.seccionesMax}>Nueva sección</Boton>}>
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
