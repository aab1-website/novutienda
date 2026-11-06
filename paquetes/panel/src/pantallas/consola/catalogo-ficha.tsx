import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { nuevoId } from '../../api/cliente.js';
import { mensajeDeError } from '../../api/errores.js';
import { LIMITES_PANEL, type EstadoFicha, type FichaWeb, type Medio, type MedioFicha, type ProductoPanel, type TipoMedio } from '../../api/tipos.js';
import { Alerta, Area, Boton, BotonConfirmado, Campo, Cargando, ErrorCarga, Selector, Seccion, Vacio } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { esperarSubida } from './esperar.js';
import { formatoBytes } from '../../util/base64.js';

const ESTADOS: { valor: EstadoFicha; texto: string }[] = [{ valor: 'borrador', texto: 'Borrador' }, { valor: 'publicado', texto: 'Publicado' }, { valor: 'oculto', texto: 'Oculto' }];
const slugDe = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

interface Subiendo {
  id: string;
  nombre: string;
  texto: string;
  error: boolean;
}

function EditorFicha({ producto, alCerrar }: { producto: ProductoPanel; alCerrar: () => void }): JSX.Element {
  const { api, almacen } = useApp();
  const datos = useCarga(async () => ({ fichas: await api.llamar('listarFichas', {}), medios: await api.llamar('listarMedios', { productoId: producto.id }) }), [producto.id]);
  const accion = useAccion();
  const [f, setF] = useState<FichaWeb | null>(null);
  const [subidas, setSubidas] = useState<Subiendo[]>([]);
  const [ok, setOk] = useState(false);
  const [errorMedios, setErrorMedios] = useState<string | null>(null);

  if (datos.cargando) return <Cargando />;
  if (datos.error || !datos.datos) return <ErrorCarga error={datos.error ?? 'Sin datos'} reintentar={datos.recargar} />;
  const { medios } = datos.datos;
  const guardada = datos.datos.fichas.find((x) => x.productoId === producto.id)?.ficha;
  const ficha: FichaWeb = f ?? guardada ?? { slug: slugDe(producto.nombre), descripcion: '', garantia: producto.garantiaMeses ? `${producto.garantiaMeses} meses` : '', medios: [], seo: { titulo: producto.nombre, descripcion: '' }, estado: 'borrador' };
  const tipoDe = (id: string): TipoMedio | undefined => medios.find((m) => m.id === id)?.tipo;
  const fotos = ficha.medios.filter((m) => tipoDe(m.medioId) === 'foto').length;
  const videos = ficha.medios.filter((m) => tipoDe(m.medioId) === 'video').length;
  const cambiar = (c: Partial<FichaWeb>): void => { setF({ ...ficha, ...c }); setOk(false); };
  const mover = (i: number, d: number): void => {
    const n = [...ficha.medios];
    const a = n[i];
    const b = n[i + d];
    if (a === undefined || b === undefined) return;
    n[i] = b;
    n[i + d] = a;
    cambiar({ medios: n });
  };
  const sinAdjuntar: Medio[] = medios.filter((m) => !ficha.medios.some((x) => x.medioId === m.id));

  const subir = async (archivo: File, tipo: TipoMedio): Promise<void> => {
    const subidaId = nuevoId();
    const estado = (texto: string, error = false): void => setSubidas((s) => (s.some((x) => x.id === subidaId) ? s.map((x) => (x.id === subidaId ? { ...x, texto, error } : x)) : [...s, { id: subidaId, nombre: archivo.name, texto, error }]));
    try {
      estado('Reservando…');
      const r = await api.llamar('reservarSubida', { subidaId, productoId: producto.id, tipo, bytes: archivo.size });
      estado('Subiendo 0 %');
      await almacen.subir(r.rutaOriginal, archivo, (p) => estado(`Subiendo ${p} %`));
      // El disparador de Storage procesa el original; el panel consulta el estado (con retroceso) y solo fuerza el
      // procesamiento como respaldo. Puede tardar más de un minuto (un video): se muestra el tiempo transcurrido.
      const inicio = Date.now();
      estado('Procesando en el servidor… 0 s');
      const reloj = setInterval(() => estado(`Procesando en el servidor… ${Math.round((Date.now() - inicio) / 1000)} s. Un video puede tardar hasta 2 minutos.`), 1000);
      let m;
      try {
        m = await esperarSubida(api, subidaId);
      } finally {
        clearInterval(reloj);
      }
      estado('Listo');
      setF((actual) => {
        const base = actual ?? ficha;
        return { ...base, medios: [...base.medios, { medioId: m.id, alt: archivo.name.replace(/\.[^.]+$/, '') }] };
      });
      setOk(false);
      datos.recargar();
    } catch (e) {
      estado(mensajeDeError(e), true);
    }
  };
  const elegirArchivo = (tipo: TipoMedio) => (e: Event): void => {
    const input = e.currentTarget as HTMLInputElement;
    const archivos = Array.from(input.files ?? []);
    input.value = '';
    for (const a of archivos) void subir(a, tipo);
  };
  const guardar = (e: Event): void => {
    e.preventDefault();
    void accion.ejecutar(async () => {
      await api.llamar('guardarFicha', { productoId: producto.id, ficha });
      setOk(true);
      setF(null);
      datos.recargar();
    });
  };
  const borrar = (medioId: string): void => {
    setErrorMedios(null);
    void accion.ejecutar(async () => {
      try {
        await api.llamar('borrarMedio', { medioId });
        setF({ ...ficha, medios: ficha.medios.filter((x) => x.medioId !== medioId) });
        datos.recargar();
      } catch (e) {
        setErrorMedios(mensajeDeError(e));
      }
    });
  };

  return (
    <Seccion titulo={`Ficha web: ${producto.nombre}`} acciones={<Boton chico variante="secundario" onClick={alCerrar}>Cerrar ficha</Boton>}>
      <form class="formulario" onSubmit={guardar} noValidate>
        <div class="cuadricula">
          <Campo etiqueta="Dirección (slug)" valor={ficha.slug} onInput={(v) => cambiar({ slug: v })} requerido ayuda="Minúsculas, números y guiones." />
          <Selector etiqueta="Estado" valor={ficha.estado} onCambio={(v) => cambiar({ estado: v as EstadoFicha })} opciones={ESTADOS} />
          <Campo etiqueta="Garantía (texto)" valor={ficha.garantia} onInput={(v) => cambiar({ garantia: v })} />
          <Campo etiqueta="Título para buscadores" valor={ficha.seo.titulo} onInput={(v) => cambiar({ seo: { ...ficha.seo, titulo: v } })} />
          <Campo etiqueta="Descripción para buscadores" valor={ficha.seo.descripcion} onInput={(v) => cambiar({ seo: { ...ficha.seo, descripcion: v } })} />
        </div>
        <Area etiqueta="Descripción del producto" valor={ficha.descripcion} onInput={(v) => cambiar({ descripcion: v })} filas={5} />

        <fieldset>
          <legend>Fotos y video ({fotos} de {LIMITES_PANEL.fotosPorProducto} fotos · {videos} de {LIMITES_PANEL.videosPorProducto} video)</legend>
          <p class="texto-suave">La primera foto es la portada. Fotos de hasta 15 MB y un video de hasta 60 segundos y 200 MB.</p>
          {ficha.medios.length === 0 && <Vacio titulo="Esta ficha no tiene fotos ni video" />}
          <ol class="lista-simple">
            {ficha.medios.map((m: MedioFicha, i) => {
              const info = medios.find((x) => x.id === m.medioId);
              return (
                <li key={m.medioId} class="fila fila-alinear medio">
                  <span>{info?.tipo === 'video' ? 'Video' : i === 0 ? 'Portada' : `Foto ${i + 1}`}{info ? ` (${formatoBytes(info.bytesOriginal)})` : ' (sin subir)'}</span>
                  <Campo etiqueta={`Texto alternativo del medio ${i + 1}`} valor={m.alt} onInput={(v) => cambiar({ medios: ficha.medios.map((x, j) => (j === i ? { ...x, alt: v } : x)) })} />
                  <Boton chico variante="secundario" onClick={() => mover(i, -1)} deshabilitado={i === 0} etiqueta={`Subir el medio ${i + 1}`}>Subir</Boton>
                  <Boton chico variante="secundario" onClick={() => mover(i, 1)} deshabilitado={i === ficha.medios.length - 1} etiqueta={`Bajar el medio ${i + 1}`}>Bajar</Boton>
                  <Boton chico variante="secundario" onClick={() => cambiar({ medios: ficha.medios.filter((_, j) => j !== i) })} etiqueta={`Quitar de la ficha el medio ${i + 1}`}>Quitar de la ficha</Boton>
                  <BotonConfirmado chico peligro texto="Borrar archivo" pregunta="¿Borrar el archivo para siempre?" textoConfirmar="Sí, borrar" onConfirmar={() => borrar(m.medioId)} />
                </li>
              );
            })}
          </ol>
          {errorMedios && <Alerta>{errorMedios}</Alerta>}
          {sinAdjuntar.length > 0 && (
            <div>
              <p>Archivos subidos que no están en la ficha:</p>
              {sinAdjuntar.map((m) => <Boton key={m.id} chico variante="secundario" onClick={() => cambiar({ medios: [...ficha.medios, { medioId: m.id, alt: '' }] })}>Agregar {m.tipo === 'video' ? 'video' : 'foto'} {m.id.slice(0, 6)}</Boton>)}
            </div>
          )}
          <div class="fila">
            <div class="campo">
              <label for="subir-foto">Subir fotos</label>
              <input id="subir-foto" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple disabled={fotos >= LIMITES_PANEL.fotosPorProducto} onChange={elegirArchivo('foto')} />
            </div>
            <div class="campo">
              <label for="subir-video">Subir video</label>
              <input id="subir-video" type="file" accept="video/mp4,video/quicktime,video/webm" disabled={videos >= LIMITES_PANEL.videosPorProducto} onChange={elegirArchivo('video')} />
            </div>
          </div>
          <ul class="lista-simple" aria-live="polite">
            {subidas.map((s) => <li key={s.id} class={s.error ? 'texto-error' : ''}>{s.nombre}: {s.texto}</li>)}
          </ul>
        </fieldset>
        {accion.error && <Alerta>{accion.error}</Alerta>}
        {ok && <Alerta tipo="ok">Ficha guardada. Falta publicar el sitio (lo hace el administrador).</Alerta>}
        <Boton tipo="submit" ocupado={accion.ocupado} deshabilitado={ficha.medios.some((m) => m.alt.trim() === '')}>Guardar ficha</Boton>
        {ficha.medios.some((m) => m.alt.trim() === '') && <p class="texto-suave">Todo medio necesita texto alternativo.</p>}
      </form>
    </Seccion>
  );
}

export function PantallaFichas(): JSX.Element {
  const { api } = useApp();
  const datos = useCarga(async () => ({ productos: await api.llamar('listarProductos', {}), fichas: await api.llamar('listarFichas', {}) }), []);
  const [elegido, setElegido] = useState<string | null>(null);
  if (datos.cargando) return <Cargando />;
  if (datos.error || !datos.datos) return <ErrorCarga error={datos.error ?? 'Sin datos'} reintentar={datos.recargar} />;
  const p = datos.datos.productos.find((x) => x.id === elegido);
  return (
    <div>
      <Seccion titulo="Fichas de producto">
        {datos.datos.productos.length === 0 && <Vacio titulo="No hay productos" />}
        <table class="tabla">
          <caption class="solo-lectores">Productos y estado de su ficha</caption>
          <thead><tr><th scope="col">Producto</th><th scope="col">Ficha</th><th scope="col"><span class="solo-lectores">Acciones</span></th></tr></thead>
          <tbody>
            {datos.datos.productos.map((x) => {
              const fc = datos.datos?.fichas.find((y) => y.productoId === x.id)?.ficha;
              return (
                <tr key={x.id}>
                  <th scope="row">{x.nombre}</th>
                  <td>{fc === undefined ? 'Sin ficha' : ESTADOS.find((e) => e.valor === fc.estado)?.texto}</td>
                  <td><Boton chico variante="secundario" onClick={() => setElegido(x.id)} etiqueta={`Editar la ficha de ${x.nombre}`}>Editar ficha</Boton></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Seccion>
      {p && <EditorFicha key={p.id} producto={p} alCerrar={() => { setElegido(null); datos.recargar(); }} />}
    </div>
  );
}
