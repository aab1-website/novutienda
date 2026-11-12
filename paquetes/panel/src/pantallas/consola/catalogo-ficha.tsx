import type { ComponentChildren, JSX, RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ErrorApi, mensajeDeError } from '../../api/errores.js';
import { LIMITES_PANEL, type EstadoFicha, type FichaWeb, type Medio, type ProductoPanel } from '../../api/tipos.js';
import { Alerta, Area, Boton, BotonConfirmado, Campo, ConCarga, Selector, Seccion, Vacio } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { Dialogo } from '../../ui/dialogo.js';
import { useAvisos } from '../../ui/avisos.js';
import { enfocarPrimerError } from '../../ui/formulario.js';
import { useBorrador, useCambiosSinGuardar, useGuardia } from '../../ui/guardia.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { Tabla } from '../../ui/tabla.js';
import { formatoBytes } from '../../util/base64.js';
import './ficha.css';
import { claveAlt, revisarFicha, TOPES_FICHA } from './ficha-revision.js';
import { useSubidas, type Subida } from './subidas-ficha.js';

const ESTADOS: { valor: EstadoFicha; texto: string }[] = [{ valor: 'borrador', texto: 'Borrador' }, { valor: 'publicado', texto: 'Publicado' }, { valor: 'oculto', texto: 'Oculto' }];
const slugDe = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const ACEPTA_FOTO = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';
const ACEPTA_VIDEO = 'video/mp4,video/x-m4v,video/quicktime,video/webm,.m4v';

/** Solo los campos editables viajan al servidor (esquema estricto): no los de almacenamiento (version, por…). */
const editable = (f: FichaWeb): FichaWeb => ({ slug: f.slug, descripcion: f.descripcion, garantia: f.garantia, medios: f.medios.map((m) => ({ medioId: m.medioId, alt: m.alt })), seo: { titulo: f.seo.titulo, descripcion: f.seo.descripcion }, estado: f.estado });
const igual = (a: FichaWeb, b: FichaWeb): boolean => JSON.stringify(editable(a)) === JSON.stringify(editable(b));
const porDefecto = (p: ProductoPanel): FichaWeb => ({ slug: slugDe(p.nombre), descripcion: '', garantia: p.garantiaMeses ? `${p.garantiaMeses} meses` : '', medios: [], seo: { titulo: p.nombre.slice(0, TOPES_FICHA.seoTitulo), descripcion: '' }, estado: 'borrador' });
const plural = (n: number, uno: string, varios: string): string => `${String(n)} ${n === 1 ? uno : varios}`;
const medidas = (m: Medio): string => `${String(m.ancho)} × ${String(m.alto)}${m.duracionSeg !== undefined ? `, ${String(Math.round(m.duracionSeg))} s` : ''} · ${formatoBytes(m.bytesOriginal)}`;

type ModoPanel = 'medios' | 'datos';

/** Al abrir (y al llegar los datos), el foco va a la zona de carga o al primer texto, según el botón que se pulsó. */
function FocoInicial({ modo, cuerpo, children }: { modo: ModoPanel; cuerpo: RefObject<HTMLDivElement>; children: ComponentChildren }): JSX.Element {
  useEffect(() => {
    const raiz = cuerpo.current;
    if (raiz === null) return;
    const activo = document.activeElement;
    const dialogo = raiz.closest('.dialogo');
    // Solo si el foco sigue en el cascarón del diálogo (el diálogo mismo, su «Cerrar» o el cuerpo de la página).
    const enCascaron = activo === null || activo === document.body || activo === dialogo || (activo instanceof HTMLElement && activo.hasAttribute('data-cerrar'));
    if (!enCascaron) return;
    raiz.querySelector<HTMLElement>(modo === 'datos' ? '.ficha-textos input' : '.ficha-zona button')?.focus();
  }, []);
  return <div ref={cuerpo} class="ficha-cuerpo">{children}</div>;
}

function textoDeFase(s: Subida): string {
  switch (s.fase) {
    case 'revisando': return 'Revisando el archivo…';
    case 'reservando': return 'Reservando lugar…';
    case 'subiendo': return `Subiendo ${String(s.progreso)} %`;
    case 'procesando': return `Procesando en el servidor… ${String(s.segundos)} s${s.tipo === 'video' ? '. Un video puede tardar hasta 2 minutos.' : ''}`;
    case 'listo': return 'Listo';
    case 'error': return s.motivo ?? 'No se pudo subir.';
  }
}

function FilaSubida({ s, reintentar, otroArchivo }: { s: Subida; reintentar: () => void; otroArchivo: () => void }): JSX.Element {
  const anuncio = s.fase === 'subiendo' ? 'Subiendo' : s.fase === 'procesando' ? 'Procesando en el servidor' : textoDeFase(s);
  return (
    <li class={`ficha-subida${s.fase === 'error' ? ' ficha-subida-error' : ''}`}>
      <span class="ficha-subida-nombre">{s.nombre}</span>
      <span class="ficha-subida-estado" aria-hidden={s.fase === 'subiendo' || s.fase === 'procesando' ? 'true' : undefined}>{textoDeFase(s)}</span>
      {s.fase === 'subiendo' && <progress max={100} value={s.progreso} aria-label={`Avance de la subida de ${s.nombre}`} />}
      {s.fase === 'error' && s.reintentable && <Boton chico variante="secundario" onClick={reintentar} etiqueta={`Reintentar la subida de ${s.nombre}`}>Reintentar</Boton>}
      {s.fase === 'error' && !s.reintentable && <Boton chico variante="secundario" onClick={otroArchivo} etiqueta={`Elegir otro archivo en lugar de ${s.nombre}`}>Elegir otro archivo</Boton>}
      <span class="solo-lectores" role="status">{`${s.nombre}: ${anuncio}`}</span>
    </li>
  );
}

interface PropsPanel {
  producto: ProductoPanel;
  modo: ModoPanel;
  alCerrar: () => void;
  alCerrarEnfocar: () => HTMLElement | null;
}

function PanelFicha({ producto, modo, alCerrar, alCerrarEnfocar }: PropsPanel): JSX.Element {
  const { api } = useApp();
  const avisos = useAvisos();
  const { confirmarSalida } = useGuardia();
  const carga = useCarga(async () => ({ fichas: await api.llamar('listarFichas', {}), medios: await api.llamar('listarMedios', { productoId: producto.id }) }), [producto.id]);
  const accion = useAccion();
  const clave = `consola.ficha.${producto.id}`;
  const borrador = useBorrador<FichaWeb | null>(clave, null);
  const [intento, setIntento] = useState(false);
  const [errorSlug, setErrorSlug] = useState<string | null>(null);
  const [pideFoco, setPideFoco] = useState(0);
  const [listos, setListos] = useState<readonly Medio[]>([]);
  const [borrados, setBorrados] = useState<ReadonlySet<string>>(new Set());
  const [errorMedios, setErrorMedios] = useState<string | null>(null);
  const [errorAuto, setErrorAuto] = useState<string | null>(null);
  const [sobre, setSobre] = useState(false);
  const cuerpo = useRef<HTMLDivElement>(null);
  const entradaFotos = useRef<HTMLInputElement>(null);
  const entradaVideo = useRef<HTMLInputElement>(null);
  const cola = useRef<Promise<unknown>>(Promise.resolve());
  const fichaRef = useRef<FichaWeb | null>(null);
  /** Lo último que el servidor confirmó de la ficha (carga inicial o respuesta de cada guardado): base de los guardados automáticos. */
  const confirmadaRef = useRef<FichaWeb | null>(null);
  const [confirmada, setConfirmada] = useState<FichaWeb | null>(null);
  const vivo = useRef(true);
  const mediosRef = useRef<readonly Medio[]>([]);

  const guardada = carga.datos?.fichas.find((x) => x.productoId === producto.id)?.ficha;
  const delServidorFicha = carga.datos === undefined ? null : editable(guardada ?? porDefecto(producto));
  if (confirmadaRef.current === null && delServidorFicha !== null) confirmadaRef.current = delServidorFicha;
  const base = confirmada ?? delServidorFicha;
  const ficha = borrador.valor ?? base;
  fichaRef.current = ficha;
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);
  const confirmar = (f: FichaWeb): void => {
    confirmadaRef.current = f;
    setConfirmada(f);
  };
  const delServidor = carga.datos?.medios ?? [];
  const idsServidor = new Set(delServidor.map((m) => m.id));
  const medios = [...delServidor, ...listos.filter((m) => !idsServidor.has(m.id))].filter((m) => !borrados.has(m.id));
  mediosRef.current = medios;

  /** Las escrituras de la ficha van una tras otra: dos guardados automáticos seguidos nunca se pisan. */
  const encolar = <R,>(fn: () => Promise<R>): Promise<R> => {
    const p = cola.current.then(fn, fn);
    cola.current = p.catch(() => undefined);
    return p;
  };
  const sugerida = (tipo: 'foto' | 'video', posicion: number): string => {
    const nombre = producto.nombre.slice(0, 120);
    return tipo === 'video' ? `${nombre}, video` : `${nombre}, foto ${String(posicion)}`;
  };
  const tipoDe = (id: string): 'foto' | 'video' | undefined => mediosRef.current.find((m) => m.id === id)?.tipo;
  const poner = (f: FichaWeb): void => {
    fichaRef.current = f;
    borrador.poner(f);
  };

  // Guardado automático (D2): al terminar cada subida se agrega SOLO el medio nuevo sobre lo último que el servidor confirmó.
  // Las ediciones locales (descripciones, orden, «Quitar») siguen en el borrador hasta «Guardar».
  const guardarMedio = async (m: Medio, alt: string): Promise<void> => {
    const confirmadaAhora = confirmadaRef.current;
    if (!vivo.current || confirmadaAhora === null || confirmadaAhora.medios.some((x) => x.medioId === m.id)) return;
    try {
      const enviada: FichaWeb = { ...confirmadaAhora, medios: [...confirmadaAhora.medios, { medioId: m.id, alt }] };
      await api.llamar('guardarFicha', { productoId: producto.id, ficha: enviada });
      confirmar(enviada);
      setErrorAuto(null);
      if (vivo.current) carga.recargar();
    } catch (e) {
      if (vivo.current) setErrorAuto(mensajeDeError(e));
    }
  };

  const subidas = useSubidas({
    productoId: producto.id,
    medios,
    alListo: (m) => {
      if (!vivo.current) return;
      setListos((l) => [...l, m]);
      mediosRef.current = [...mediosRef.current, m];
      const actual = fichaRef.current;
      const confirmadaAhora = confirmadaRef.current;
      if (actual === null || confirmadaAhora === null || actual.medios.some((x) => x.medioId === m.id)) return;
      // La descripción sugerida sale de lo confirmado, así lo que se ve y lo que se guarda coinciden.
      const fotos = confirmadaAhora.medios.filter((x) => tipoDe(x.medioId) === 'foto').length;
      const alt = sugerida(m.tipo, fotos + 1);
      poner({ ...actual, medios: [...actual.medios, { medioId: m.id, alt }] });
      void encolar(() => guardarMedio(m, alt));
    },
  });

  const textosSucios = borrador.valor !== null && base !== null && !igual(borrador.valor, base);
  const sucio = textosSucios || subidas.enCurso > 0 || errorAuto !== null;
  const { marcarGuardado } = useCambiosSinGuardar(sucio, [clave]);
  const errores: Readonly<Record<string, string>> = { ...(intento && ficha !== null ? revisarFicha(ficha) : {}), ...(errorSlug === null ? {} : { slug: errorSlug }) };

  useEffect(() => {
    if (pideFoco > 0 && cuerpo.current !== null) enfocarPrimerError(cuerpo.current);
  }, [pideFoco]);

  const cerrar = (): void => {
    borrador.descartar();
    alCerrar();
  };
  const cambiar = (c: Partial<FichaWeb>): void => {
    if (ficha === null) return;
    poner({ ...ficha, ...c });
  };

  const guardar = (): void => {
    if (ficha === null) return;
    setIntento(true);
    setErrorSlug(null);
    if (Object.keys(revisarFicha(ficha)).length > 0) {
      setPideFoco((n) => n + 1);
      return;
    }
    void accion.ejecutar(async () => {
      const guardado = await encolar(async () => {
        const f = fichaRef.current ?? ficha;
        try {
          const enviada = editable(f);
          await api.llamar('guardarFicha', { productoId: producto.id, ficha: enviada });
          confirmar(enviada);
          return true;
        } catch (e) {
          if (e instanceof ErrorApi && e.detalle.codigo === 'conflicto') {
            setErrorSlug('Esa dirección ya la usa la página de otro producto. Elija otra.');
            setPideFoco((n) => n + 1);
            return false;
          }
          throw e;
        }
      });
      if (!guardado) return;
      avisos.ok('Página guardada. Falta publicar el sitio (lo hace el administrador).');
      borrador.descartar();
      setIntento(false);
      setErrorAuto(null);
      if (subidas.enCurso > 0) {
        carga.recargar();
        avisos.info(`${plural(subidas.enCurso, 'archivo sigue', 'archivos siguen')} subiéndose: la ventana queda abierta hasta que terminen.`);
        return;
      }
      marcarGuardado();
      alCerrar();
    });
  };

  const borrar = (medioId: string): void => {
    setErrorMedios(null);
    void accion.ejecutar(async () => {
      try {
        await encolar(() => api.llamar('borrarMedio', { medioId }));
        setBorrados((b) => new Set([...b, medioId]));
        const conf = confirmadaRef.current;
        if (conf !== null && conf.medios.some((x) => x.medioId === medioId)) confirmar({ ...conf, medios: conf.medios.filter((x) => x.medioId !== medioId) });
        const actual = fichaRef.current;
        if (actual !== null && actual.medios.some((x) => x.medioId === medioId)) poner({ ...actual, medios: actual.medios.filter((x) => x.medioId !== medioId) });
        carga.recargar();
      } catch (e) {
        setErrorMedios(mensajeDeError(e));
      }
    });
  };

  const mover = (i: number, d: number): void => {
    if (ficha === null) return;
    const n = [...ficha.medios];
    const a = n[i];
    const b = n[i + d];
    if (a === undefined || b === undefined) return;
    n[i] = b;
    n[i + d] = a;
    cambiar({ medios: n });
  };

  const alElegir = (tipo: 'foto' | 'video') => (e: Event): void => {
    const entrada = e.currentTarget as HTMLInputElement;
    const elegidos = Array.from(entrada.files ?? []);
    entrada.value = '';
    subidas.agregar(elegidos, tipo);
  };
  const alSoltar = (e: DragEvent): void => {
    e.preventDefault();
    setSobre(false);
    subidas.agregar(Array.from(e.dataTransfer?.files ?? []));
  };

  const cupoFotos = subidas.cupo('foto');
  const cupoVideo = subidas.cupo('video');
  const fotosSubidas = medios.filter((m) => m.tipo === 'foto').length;
  const videosSubidos = medios.filter((m) => m.tipo === 'video').length;

  const contenido = (f: FichaWeb): JSX.Element => {
    const sinAdjuntar = medios.filter((m) => !f.medios.some((x) => x.medioId === m.id));
    return (
      <form class="formulario ficha-formulario" onSubmit={(e) => { e.preventDefault(); guardar(); }} noValidate>
        <section class="ficha-bloque" aria-labelledby="ficha-medios-titulo">
          <h3 id="ficha-medios-titulo">Fotos y video</h3>
          <p class="texto-suave">Hasta {LIMITES_PANEL.fotosPorProducto} fotos de 15 MB y {LIMITES_PANEL.videosPorProducto} video de hasta {LIMITES_PANEL.duracionVideoSeg} segundos y 200 MB. La primera foto es la portada. Hay {fotosSubidas} de {LIMITES_PANEL.fotosPorProducto} fotos y {videosSubidos} de {LIMITES_PANEL.videosPorProducto} video.</p>
          <div class={`ficha-zona${sobre ? ' ficha-zona-sobre' : ''}`} onDragOver={(e) => { e.preventDefault(); setSobre(true); }} onDragLeave={() => setSobre(false)} onDrop={alSoltar}>
            <div class="ficha-zona-botones">
              <Boton onClick={() => entradaFotos.current?.click()} motivo={cupoFotos === 0 ? `Ya hay ${String(LIMITES_PANEL.fotosPorProducto)} fotos` : undefined}>Elegir fotos</Boton>
              <Boton onClick={() => entradaVideo.current?.click()} motivo={cupoVideo === 0 ? 'Ya hay un video' : undefined}>Elegir video</Boton>
            </div>
            <p class="texto-suave ficha-zona-texto">O arrastre aquí las fotos o el video.</p>
            <input ref={entradaFotos} type="file" hidden aria-label="Archivos de fotos" accept={ACEPTA_FOTO} multiple onChange={alElegir('foto')} />
            <input ref={entradaVideo} type="file" hidden aria-label="Archivo de video" accept={ACEPTA_VIDEO} onChange={alElegir('video')} />
          </div>
          {subidas.avisoCupo !== null && <Alerta tipo="info">{subidas.avisoCupo}</Alerta>}
          {subidas.subidas.length > 0 && (
            <ul class="lista-simple ficha-subidas">
              {subidas.subidas.map((s) => (
                <FilaSubida key={s.id} s={s} reintentar={() => subidas.reintentar(s.id)} otroArchivo={() => { subidas.descartar(s.id); (s.tipo === 'video' ? entradaVideo : entradaFotos).current?.click(); }} />
              ))}
            </ul>
          )}
          {errorAuto !== null && <Alerta>{`No se pudo guardar la lista de fotos: ${errorAuto} Se guardará con «Guardar».`}</Alerta>}
          {errores['medios'] && <Alerta>{errores['medios']}</Alerta>}
          {f.medios.length === 0 && <Vacio titulo="Esta página no tiene fotos ni video" />}
          <ol class="lista-simple ficha-medios">
            {f.medios.map((m, i) => {
              const info = medios.find((x) => x.id === m.medioId);
              const esVideo = info?.tipo === 'video';
              const nombre = esVideo ? 'Video' : `Foto ${String(i + 1)}${i === 0 ? ' (portada)' : ''}`;
              return (
                <li key={m.medioId} class="ficha-medio">
                  <p class="ficha-medio-titulo"><strong>{nombre}</strong>{info ? ` · ${medidas(info)}` : ' · sin subir'}</p>
                  <Campo etiqueta={esVideo ? 'Descripción del video' : `Descripción de la foto ${String(i + 1)}`} valor={m.alt} tope={TOPES_FICHA.alt} ayuda="Cuenta qué se ve. La leen los lectores de pantalla." error={errores[claveAlt(i)]} onInput={(v) => cambiar({ medios: f.medios.map((x, j) => (j === i ? { ...x, alt: v } : x)) })} />
                  <div class="fila">
                    <Boton chico variante="secundario" onClick={() => mover(i, -1)} deshabilitado={i === 0} etiqueta={`Mover arriba el medio ${String(i + 1)}`}>Mover arriba</Boton>
                    <Boton chico variante="secundario" onClick={() => mover(i, 1)} deshabilitado={i === f.medios.length - 1} etiqueta={`Mover abajo el medio ${String(i + 1)}`}>Mover abajo</Boton>
                    <Boton chico variante="secundario" onClick={() => cambiar({ medios: f.medios.filter((_, j) => j !== i) })} etiqueta={`Quitar de la ficha el medio ${String(i + 1)}`}>Quitar de la ficha</Boton>
                    <BotonConfirmado chico peligro texto="Borrar archivo" pregunta="¿Borrar el archivo para siempre?" textoConfirmar="Sí, borrar" onConfirmar={() => borrar(m.medioId)} />
                  </div>
                </li>
              );
            })}
          </ol>
          {errorMedios !== null && <Alerta>{errorMedios}</Alerta>}
          {sinAdjuntar.length > 0 && (
            <div class="ficha-sin-adjuntar">
              <p>Archivos subidos que no están en la página:</p>
              <ul class="lista-simple">
                {sinAdjuntar.map((m) => {
                  const fotos = f.medios.filter((x) => tipoDe(x.medioId) === 'foto').length;
                  return (
                    <li key={m.id} class="fila">
                      <span>{m.tipo === 'video' ? 'Video' : 'Foto'} · {medidas(m)}</span>
                      <Boton chico variante="secundario" onClick={() => cambiar({ medios: [...f.medios, { medioId: m.id, alt: sugerida(m.tipo, fotos + 1) }] })} etiqueta={`Agregar a la página ${m.tipo === 'video' ? 'el video' : 'la foto'} de ${medidas(m)}`}>Agregar a la página</Boton>
                      <BotonConfirmado chico peligro texto="Borrar archivo" pregunta="¿Borrar el archivo para siempre?" textoConfirmar="Sí, borrar" onConfirmar={() => borrar(m.id)} />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        <section class="ficha-bloque ficha-textos" aria-labelledby="ficha-textos-titulo">
          <h3 id="ficha-textos-titulo">Textos de la página</h3>
          <Campo etiqueta="Dirección de la página" valor={f.slug} tope={TOPES_FICHA.slugMax} requerido error={errores['slug']} ayuda="Minúsculas, números y guiones. Ejemplo: televisor-55." onInput={(v) => { setErrorSlug(null); cambiar({ slug: v }); }} />
          <Selector etiqueta="Estado" valor={f.estado} onCambio={(v) => cambiar({ estado: v as EstadoFicha })} opciones={ESTADOS} />
          <Campo etiqueta="Garantía (texto)" valor={f.garantia} tope={TOPES_FICHA.garantia} error={errores['garantia']} onInput={(v) => cambiar({ garantia: v })} />
          <Area etiqueta="Descripción del producto" valor={f.descripcion} filas={5} tope={TOPES_FICHA.descripcion} error={errores['descripcion']} onInput={(v) => cambiar({ descripcion: v })} />
          <Campo etiqueta="Título para buscadores" valor={f.seo.titulo} tope={TOPES_FICHA.seoTitulo} error={errores['seo.titulo']} onInput={(v) => cambiar({ seo: { ...f.seo, titulo: v } })} />
          <Campo etiqueta="Descripción para buscadores" valor={f.seo.descripcion} tope={TOPES_FICHA.seoDescripcion} error={errores['seo.descripcion']} onInput={(v) => cambiar({ seo: { ...f.seo, descripcion: v } })} />
        </section>
        {accion.error !== null && <Alerta>{accion.error}</Alerta>}
      </form>
    );
  };

  return (
    <Dialogo
      titulo={`Página en el sitio: ${producto.nombre}`}
      variante="lateral"
      foco="cerrar"
      sucio={sucio}
      onCerrar={cerrar}
      alCerrarEnfocar={alCerrarEnfocar}
      pie={
        <>
          <Boton variante="secundario" onClick={() => confirmarSalida(cerrar)}>Cancelar</Boton>
          <Boton onClick={guardar} ocupado={accion.ocupado}>Guardar</Boton>
        </>
      }
    >
      <ConCarga carga={carga}>{() => (ficha === null ? null : <FocoInicial modo={modo} cuerpo={cuerpo}>{contenido(ficha)}</FocoInicial>)}</ConCarga>
    </Dialogo>
  );
}

interface Abierta {
  readonly productoId: string;
  readonly modo: ModoPanel;
  readonly etiqueta: string;
}

export function PantallaFichas(): JSX.Element {
  const { api } = useApp();
  const carga = useCarga(async () => ({ productos: await api.llamar('listarProductos', {}), fichas: await api.llamar('listarFichas', {}) }), []);
  const [abierta, setAbierta] = useState<Abierta | null>(null);
  const lista = useRef<HTMLDivElement>(null);
  const producto = carga.datos?.productos.find((x) => x.id === abierta?.productoId);
  const volverAlBoton = (): HTMLElement | null => {
    // Se compara el atributo en vez de armar un selector con el nombre del producto (no hay que escapar nada).
    const etiqueta = abierta?.etiqueta;
    return Array.from(lista.current?.querySelectorAll<HTMLElement>('button[aria-label]') ?? []).find((b) => b.getAttribute('aria-label') === etiqueta) ?? null;
  };
  return (
    <div ref={lista}>
      <Seccion titulo="Páginas de producto en el sitio">
        <ConCarga carga={carga}>
          {(d) => {
            const fichaDe = (id: string): FichaWeb | undefined => d.fichas.find((y) => y.productoId === id)?.ficha;
            return (
              <Tabla
                titulo="Productos y su página en el sitio"
                filas={d.productos}
                clave={(x) => x.id}
                buscar={{ etiqueta: 'Buscar producto', en: (x) => [x.nombre, x.sku] }}
                vacio={{ titulo: 'No hay productos' }}
                columnas={[
                  { id: 'producto', titulo: 'Producto', valor: (x) => x.nombre, encabezadoFila: true, ordenable: true },
                  { id: 'pagina', titulo: 'Página', valor: (x) => { const f = fichaDe(x.id); return f === undefined ? 'Sin página' : (ESTADOS.find((e) => e.valor === f.estado)?.texto ?? ''); }, ordenable: true },
                  { id: 'medios', titulo: 'Fotos y video', valor: (x) => fichaDe(x.id)?.medios.length ?? 0, celda: (x) => `${String(fichaDe(x.id)?.medios.length ?? 0)} en la ficha`, ordenable: true },
                ]}
                acciones={(x) => (
                  <div class="fila">
                    <Boton chico variante="secundario" etiqueta={`Fotos y video de ${x.nombre}`} onClick={() => setAbierta({ productoId: x.id, modo: 'medios', etiqueta: `Fotos y video de ${x.nombre}` })}>Fotos y video</Boton>
                    <Boton chico variante="secundario" etiqueta={`Editar página de ${x.nombre}`} onClick={() => setAbierta({ productoId: x.id, modo: 'datos', etiqueta: `Editar página de ${x.nombre}` })}>Editar página</Boton>
                  </div>
                )}
              />
            );
          }}
        </ConCarga>
      </Seccion>
      {abierta !== null && producto !== undefined && (
        <PanelFicha key={`${abierta.productoId}-${abierta.modo}`} producto={producto} modo={abierta.modo} alCerrar={() => { setAbierta(null); carga.recargar(); }} alCerrarEnfocar={volverAlBoton} />
      )}
    </div>
  );
}
