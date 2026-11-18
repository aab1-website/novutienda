import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { esWhatsappValido, pareceNumeroDeRelleno } from './whatsapp.js';
import { Miniatura } from './miniatura-vista.js';
import { ID_PORTADA, LIMITES_PANEL, PLANTILLAS_SITIO, type Carrusel, type Medio, type ConfigSitio, type PlantillaSitio } from '../../api/tipos.js';
import { ErrorApi, mensajeDeError } from '../../api/errores.js';
import { Alerta, Boton, BotonConfirmado, Campo, Cargando, Dato, ErrorCarga, Pestanas, Seccion, Vacio, fechaHora } from '../../ui/comun.js';
import { useAvisos } from '../../ui/avisos.js';
import { useBorrador, useCambiosSinGuardar } from '../../ui/guardia.js';
import { SelectorBuscable } from '../../ui/selector-buscable.js';
import { useConfiguracionComercial } from '../../ui/comercial.js';
import { useApp } from '../../ui/contexto.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { formatoBytes } from '../../util/base64.js';
import { PALETAS } from './plantillas-vista.js';
import { PantallaFichas } from './catalogo-ficha.js';
import { PantallaSecciones } from './catalogo-secciones.js';
import { BloqueLogo } from './logo-vista.js';
import { useSubidaPortada } from './subidas-portada.js';

const TODAS = [
  { id: 'tablero', titulo: 'Tablero' }, { id: 'fichas', titulo: 'Fichas, fotos y video' }, { id: 'secciones', titulo: 'Secciones' },
  { id: 'apariencia', titulo: 'Apariencia' },
];

function Uso({ etiqueta, usados, tope, formato }: { etiqueta: string; usados: number; tope: number; formato?: (n: number) => string }): JSX.Element {
  const f = formato ?? String;
  return (
    <div class="uso">
      <p>{etiqueta}: <strong>{f(usados)} de {f(tope)}</strong></p>
      <progress max={tope} value={usados} aria-label={etiqueta} />
    </div>
  );
}

function textoAvisoSitio(a: { readonly motivo: 'sin_productos' | 'sin_fotos'; readonly en: string }): string {
  const f = fechaHora(a.en);
  const desde = f === '' ? '' : ` (desde el ${f})`;
  return a.motivo === 'sin_productos'
    ? `El sitio quedó sin productos publicados${desde}. Active o publique al menos un producto en Inventario y luego publique el sitio.`
    : `El sitio quedó sin fotos${desde}. Agregue al menos una foto a un producto visible en el sitio y luego publique el sitio.`;
}

function Tablero(): JSX.Element {
  const { api, usuario, puedeVer } = useApp();
  const comercial = useConfiguracionComercial();
  const t = useCarga(() => api.llamar('obtenerTablero', {}), []);
  const accion = useAccion();
  const [msg, setMsg] = useState<string | null>(null);
  if (comercial.estado === 'cargando' || t.cargando) return <Cargando />;
  if (comercial.estado === 'error') return <ErrorCarga error={comercial.mensaje} />;
  if (t.error || !t.datos) return <ErrorCarga error={t.error ?? 'Sin datos'} reintentar={t.recargar} />;
  const d = t.datos;
  const nombreMercado = (id: string): string => comercial.comercial.mercados.find((m) => m.id === id)?.nombre ?? id;
  return (
    <div>
      <Seccion titulo="Sitio">
        <dl class="datos">
          <Dato etiqueta="Cambios sin publicar"><span data-prueba="cambios">{d.cambiosSinPublicar}</span></Dato>
          <Dato etiqueta="Último cambio">{fechaHora(d.ultimoCambioEn)}</Dato>
          <Dato etiqueta="Última publicación del sitio">{d.publicadoEn === null ? 'Todavía no se publicó' : `${fechaHora(d.publicadoEn)} (versión ${d.versionPublicada})`}</Dato>
        </dl>
        {d.avisoSitio !== null && (
          <Alerta tipo="info">
            <p data-prueba="aviso-sitio">{textoAvisoSitio(d.avisoSitio)}</p>
            {d.avisoSitio.motivo === 'sin_productos' ? (
              puedeVer('inventario') ? <a href="#/inventario">Ir a Inventario</a> : <p>{usuario.rol === 'adm' ? 'El módulo de Inventario no está activo.' : 'Pida al administrador que active o publique un producto.'}</p>
            ) : (
              <>
                <a href="#/catalogo/fichas">Agregar fotos a un producto</a>
                {usuario.rol === 'adm' && <> · <a href="#/catalogo/apariencia">Carrusel de la portada</a></>}
              </>
            )}
          </Alerta>
        )}
        {usuario.rol === 'adm' ? (
          <><BotonConfirmado texto="Publicar el sitio" pregunta="¿Publicar los cambios? El sitio se actualiza normalmente en pocos minutos; si no, en un rato (puede tardar hasta unas horas)." textoConfirmar="Sí, publicar" deshabilitado={accion.ocupado || d.cambiosSinPublicar === 0} onConfirmar={() => void accion.ejecutar(async () => { const r = await api.llamar('publicarSitio', {}); setMsg(`Publicado: versión ${r.version}, ${r.productos} productos.${r.advertencias.length ? ` Avisos: ${r.advertencias.join(' ')}` : ''}`); t.recargar(); })} />
            {d.cambiosSinPublicar === 0 && <p class="texto-suave" data-prueba="motivo-publicar">No hay cambios sin publicar.</p>}
          </>
        ) : (
          <p class="texto-suave">Solo el administrador publica.</p>
        )}
        {accion.error && <Alerta>{accion.error}</Alerta>}
        {msg && <Alerta tipo="ok">{msg}</Alerta>}
      </Seccion>
      <Seccion titulo="Cotización vigente">
        <ul class="lista-simple">
          {d.cotizaciones.map((c) => (
            <li key={c.mercado}>
              {nombreMercado(c.mercado)}:{' '}
              {c.estado === 'sin_cotizacion' ? <span class="texto-error">sin cotización utilizable ({c.motivo})</span> : <span>{c.par} = {String(c.valor).replace('.', ',')} · {c.fuente} · {c.fecha} · {c.estado === 'vigente' ? 'vigente' : 'último valor verificado'}</span>}
            </li>
          ))}
        </ul>
      </Seccion>
      <Seccion titulo="Uso del plan">
        <Uso etiqueta="Productos" usados={d.uso.productos.usados} tope={d.uso.productos.tope} />
        <Uso etiqueta="Usuarios" usados={d.uso.usuarios.usados} tope={d.uso.usuarios.tope} />
        <Uso etiqueta="Originales de fotos y videos" usados={d.uso.originalesBytes.usados} tope={d.uso.originalesBytes.tope} formato={formatoBytes} />
      </Seccion>
    </div>
  );
}

function VistaPrevia({ id, tema }: { id: PlantillaSitio; tema: 'claro' | 'oscuro' }): JSX.Element {
  return (
    <div class={`vp vp-${id}-${tema}`} role="img" aria-label={`Vista previa de la plantilla ${PALETAS[id].nombre} en tema ${tema}`}>
      <div class="vp-barra" />
      <div class="vp-cuerpo"><span class="vp-titulo">Aa</span><span class="vp-boton">Comprar</span></div>
    </div>
  );
}

const CLAVE_CONFIG = 'consola.apariencia.config';
const CLAVE_CARRUSELES = 'consola.apariencia.carruseles';
const CONFIG_INICIAL: ConfigSitio = { plantillaActiva: 'cielo', whatsappNovuchat: '', medicion: {} };
type Items = Carrusel['items'];
type Borradores = Partial<Record<PlantillaSitio, Items>>;

/** Forma comparable de la configuración: el orden de las claves de `medicion` no cuenta. */
const huellaConfig = (c: ConfigSitio): string => JSON.stringify([c.plantillaActiva, c.whatsappNovuchat, c.medicion.ga4 ?? '', c.medicion.searchConsole ?? '', c.medicion.metaPixel ?? '', c.medicion.tiktokPixel ?? '']);
const huellaItems = (i: Items): string => JSON.stringify(i);
const lista = (x: readonly string[]): string => x.join(' y ');

interface PasoGuardado {
  readonly nombre: string;
  readonly guardar: () => Promise<unknown>;
  readonly alGuardar: () => void;
}

/** Dice con exactitud qué quedó guardado y qué no, con el motivo de cada falla. */
function textoParcial(hechos: readonly string[], fallos: readonly { nombre: string; motivo: string }[]): string {
  const fallaron = fallos.map((f) => `${f.nombre} (${f.motivo.replace(/[.\s]+$/, '')})`).join('; ');
  const antes = hechos.length === 0 ? 'No quedó guardado nada.' : `Quedó guardado: ${lista(hechos)}.`;
  return `${antes} No quedó guardado: ${fallaron}. Lo que escribió sigue aquí: corrija y pulse «Guardar apariencia» otra vez.`;
}

function Apariencia(): JSX.Element {
  const { api } = useApp();
  const avisos = useAvisos();
  const datos = useCarga(async () => ({ config: await api.llamar('leerConfigSitio', {}), carruseles: await api.llamar('listarCarruseles', {}), productos: await api.llamar('listarProductos', {}) }), []);
  const accion = useAccion();
  // Un borrador de la configuración y uno de carrusel por plantilla: cambiar de plantilla no borra lo editado.
  const cfgB = useBorrador<ConfigSitio | null>(CLAVE_CONFIG, null);
  const carrB = useBorrador<Borradores>(CLAVE_CARRUSELES, {});
  const servidor = datos.datos?.config ?? CONFIG_INICIAL;
  const c: ConfigSitio = cfgB.valor ?? servidor;
  const delServidor = (p: PlantillaSitio): Items => datos.datos?.carruseles.find((x) => x.plantilla === p)?.items ?? [];
  const cfgSucia = cfgB.valor !== null && huellaConfig(cfgB.valor) !== huellaConfig(servidor);
  const editadas = PLANTILLAS_SITIO.filter((p) => {
    const d = carrB.valor[p];
    return d !== undefined && huellaItems(d) !== huellaItems(delServidor(p));
  });
  const sucio = datos.datos !== undefined && (cfgSucia || editadas.length > 0);
  const { marcarGuardado } = useCambiosSinGuardar(sucio, [CLAVE_CONFIG, CLAVE_CARRUSELES]);
  // Lo guardado se borra del borrador cuando llegan los datos nuevos, no antes: así no se ve un instante el valor viejo.
  const porLiberar = useRef<{ cfg: boolean; carruseles: PlantillaSitio[] }>({ cfg: false, carruseles: [] });
  useEffect(() => {
    const p = porLiberar.current;
    if (!p.cfg && p.carruseles.length === 0) return;
    porLiberar.current = { cfg: false, carruseles: [] };
    if (p.cfg) cfgB.descartar();
    if (p.carruseles.length > 0) carrB.poner((prev) => { const resto = { ...prev }; for (const q of p.carruseles) delete resto[q]; return resto; });
  }, [datos.datos]);
  if (datos.cargando && datos.datos === undefined) return <Cargando />;
  if (datos.error || !datos.datos) return <ErrorCarga error={datos.error ?? 'Sin datos'} reintentar={datos.recargar} />;
  const med = c.medicion;
  const setMed = (k: keyof ConfigSitio['medicion'], v: string): void => {
    const { [k]: _quitado, ...resto } = med;
    void _quitado;
    cfgB.poner({ ...c, medicion: v.trim() === '' ? resto : { ...resto, [k]: v.trim() } });
  };
  const items = carrB.valor[c.plantillaActiva] ?? delServidor(c.plantillaActiva);
  const setItems = (i: Items): void => carrB.poner((prev) => ({ ...prev, [c.plantillaActiva]: i }));
  const whatsappValido = esWhatsappValido(c.whatsappNovuchat);
  const sinTexto = editadas.find((p) => (carrB.valor[p] ?? []).some((i) => i.alt.trim() === ''));
  const motivo = cfgSucia && !whatsappValido
    ? 'Escriba el WhatsApp de la tienda: solo dígitos, con código de país (de 8 a 15 dígitos).'
    : sinTexto !== undefined
      ? `Escriba el texto alternativo de cada foto del carrusel de ${PALETAS[sinTexto].nombre}.`
      : !sucio
        ? 'No hay cambios por guardar.'
        : undefined;

  const guardar = (): void => {
    const pasos: PasoGuardado[] = [];
    if (cfgSucia) pasos.push({ nombre: 'la plantilla y los datos del sitio', guardar: () => api.llamar('guardarConfigSitio', { config: c }), alGuardar: () => { porLiberar.current.cfg = true; } });
    for (const p of editadas) {
      const itemsP = carrB.valor[p] ?? [];
      pasos.push({
        nombre: `el carrusel de ${PALETAS[p].nombre}`,
        guardar: () => api.llamar('guardarCarrusel', { carrusel: { plantilla: p, items: itemsP } }),
        alGuardar: () => { porLiberar.current.carruseles.push(p); },
      });
    }
    void accion.ejecutar(async () => {
      const hechos: string[] = [];
      const fallos: { nombre: string; motivo: string }[] = [];
      for (const paso of pasos) {
        try {
          await paso.guardar();
          paso.alGuardar();
          hechos.push(paso.nombre);
        } catch (e) {
          fallos.push({ nombre: paso.nombre, motivo: mensajeDeError(e) });
        }
      }
      datos.recargar();
      if (fallos.length === 0) {
        marcarGuardado();
        avisos.ok('Apariencia guardada. Falta publicar el sitio.');
      } else avisos.error(textoParcial(hechos, fallos));
    });
  };

  return (
    <div>
      <BloqueLogo />
      <Seccion titulo="Plantilla de color">
        <p class="texto-suave">Cinco plantillas, cada una con tema claro y oscuro. Las vistas son aproximadas; el sitio muestra la definitiva. Cada plantilla tiene su propio carrusel: al cambiar de plantilla, lo que editó en las otras se conserva.</p>
        <fieldset class="plantillas">
          <legend>Plantilla activa</legend>
          {PLANTILLAS_SITIO.map((id) => (
            <label key={id} class={`plantilla-opcion ${c.plantillaActiva === id ? 'activa' : ''}`}>
              <input type="radio" name="plantilla" value={id} checked={c.plantillaActiva === id} onChange={() => cfgB.poner({ ...c, plantillaActiva: id })} />
              <span class="plantilla-nombre">{PALETAS[id].nombre}</span>
              <span class="fila"><VistaPrevia id={id} tema="claro" /><VistaPrevia id={id} tema="oscuro" /></span>
            </label>
          ))}
        </fieldset>
        <div class="cuadricula">
          <Campo etiqueta="WhatsApp de la tienda (el número del asistente de NovuChat; solo dígitos, con código de país)" valor={c.whatsappNovuchat} onInput={(v) => cfgB.poner({ ...c, whatsappNovuchat: v })} inputMode="numeric" requerido ayuda={pareceNumeroDeRelleno(c.whatsappNovuchat) ? "Este número parece de prueba (un 0 después del código de país): WhatsApp no lo acepta. Escriba el número real de la tienda." : "Ejemplo: 59171234567 (sin +, espacios ni guiones)."} error={c.whatsappNovuchat !== '' && !whatsappValido ? 'Use solo dígitos, con código de país, de 8 a 15 dígitos.' : undefined} />
          <Campo etiqueta="Google Analytics (G-…)" valor={med.ga4 ?? ''} onInput={(v) => setMed('ga4', v)} ayuda="Opcional. Ejemplo: G-ABC123XYZ." />
          <Campo etiqueta="Search Console" valor={med.searchConsole ?? ''} onInput={(v) => setMed('searchConsole', v)} ayuda="Opcional. Código de verificación del sitio." />
          <Campo etiqueta="Píxel de Meta" valor={med.metaPixel ?? ''} onInput={(v) => setMed('metaPixel', v)} ayuda="Opcional. Solo dígitos, de 8 a 20." />
          <Campo etiqueta="Píxel de TikTok" valor={med.tiktokPixel ?? ''} onInput={(v) => setMed('tiktokPixel', v)} ayuda="Opcional. Letras mayúsculas y dígitos, de 10 a 30." />
        </div>
      </Seccion>
      <CarruselEditor plantilla={c.plantillaActiva} items={items} setItems={setItems} productos={datos.datos.productos.map((p) => ({ id: p.id, nombre: p.nombre }))} />
      <Boton ocupado={accion.ocupado} motivo={motivo} onClick={guardar}>
        Guardar apariencia
      </Boton>
    </div>
  );
}

function CarruselEditor({ plantilla, items, setItems, productos }: { plantilla: PlantillaSitio; items: Items; setItems: (i: Items) => void; productos: { id: string; nombre: string }[] }): JSX.Element {
  const { api } = useApp();
  // Medios vistos en esta sesión: permiten mostrar la miniatura de las fotos que ya se agregaron.
  const conocidos = useRef(new Map<string, Medio>());
  // Sin producto elegido de antemano: se busca y se elige.
  const [productoId, setProductoId] = useState<string | null>(null);
  const fotos = useCarga(() => (productoId === null ? Promise.resolve([]) : api.llamar('listarMedios', { productoId })), [productoId]);
  // Fotos propias de la portada (no son de ningún producto): se suben aquí y se agregan al carrusel igual que las de un producto.
  const propias = useCarga(() => api.llamar('listarMedios', { productoId: ID_PORTADA }), []);
  const entradaPortada = useRef<HTMLInputElement>(null);
  const borrando = useAccion();
  const avisos = useAvisos();
  const borrarPropia = (medioId: string): void =>
    void borrando.ejecutar(async () => {
      try {
        await api.llamar('borrarMedio', { medioId });
        propias.recargar();
        avisos.ok('Foto borrada. Se liberó su lugar.');
      } catch (e) {
        // El conflicto («se usa en el carrusel…») trae el motivo exacto del servidor; el texto fijo del panel lo ocultaría.
        const motivo = e instanceof ErrorApi && e.detalle.codigo === 'conflicto' ? e.message.replace(/\s\[\d{3}\]$/, '') : mensajeDeError(e);
        avisos.error(`No se pudo borrar la foto: ${motivo}`);
      }
    });
  const subida = useSubidaPortada((m) => {
    conocidos.current.set(m.id, m);
    propias.recargar();
    if (items.length < 8 && !items.some((i) => i.medioId === m.id)) setItems([...items, { medioId: m.id, alt: '' }]);
  });
  const mover = (i: number, d: number): void => {
    const n = [...items];
    const x = n[i];
    const y = n[i + d];
    if (x === undefined || y === undefined) return;
    n[i] = y;
    n[i + d] = x;
    setItems(n);
  };
  // Medios vistos en esta sesión: permiten mostrar la miniatura de las fotos que ya se agregaron.
  // Tras recargar, solo se leen los medios de los productos que tienen fotos en este carrusel. El ítem no trae su producto:
  // se resuelve con las fichas (`listarFichas`), que ya relacionan cada foto con su producto. Un fallo de sesión se deja
  // propagar al manejo de sesión del panel; cualquier otro deja el respaldo.
  const faltan = items.map((i) => i.medioId).filter((id) => !conocidos.current.has(id));
  const guardados = useCarga(async () => {
    if (faltan.length === 0) return [] as Medio[];
    const sinSesion = (e: unknown): boolean => e instanceof ErrorApi && e.codigoHttps === 'unauthenticated';
    const seguro = async <T,>(f: () => Promise<T>, vacio: T): Promise<T> => {
      try { return await f(); } catch (e) { if (sinSesion(e)) throw e; return vacio; }
    };
    const fichas = await seguro(() => api.llamar('listarFichas', {}), []);
    const productosDe = new Set(fichas.filter((f) => f.ficha.medios.some((m) => faltan.includes(m.medioId))).map((f) => f.productoId));
    return (await Promise.all([...productosDe].map((productoId) => seguro(() => api.llamar('listarMedios', { productoId }), [] as readonly Medio[])))).flat();
  }, [faltan.join(',')]);
  for (const m of guardados.datos ?? []) conocidos.current.set(m.id, m);
  for (const m of fotos.datos ?? []) conocidos.current.set(m.id, m);
  for (const m of propias.datos ?? []) conocidos.current.set(m.id, m);
  const nombreProducto = productos.find((p) => p.id === productoId)?.nombre ?? '';
  return (
    <Seccion titulo={`Carrusel de portada (${PALETAS[plantilla].nombre})`}>
      {items.length === 0 && <Vacio titulo="El carrusel no tiene fotos" detalle="Agregue hasta 8 fotos, de los productos o subidas aquí." />}
      <ol class="lista-simple">
        {items.map((it, i) => (
          <li key={it.medioId} class="fila fila-alinear">
            <span>{i + 1}.</span>
            <Miniatura medio={conocidos.current.get(it.medioId)} alt={it.alt.trim() !== '' ? it.alt : `Foto ${String(i + 1)} del carrusel`} respaldo={`Foto ${it.medioId.slice(0, 6)}`} orden={i + 1} />
            <Campo etiqueta={`Texto alternativo de la foto ${i + 1}`} valor={it.alt} error={it.alt.trim() === '' ? 'Escriba qué se ve en la foto.' : undefined} onInput={(v) => setItems(items.map((x, j) => (j === i ? { ...x, alt: v } : x)))} />
            <Boton chico variante="secundario" onClick={() => mover(i, -1)} deshabilitado={i === 0} etiqueta={`Subir foto ${i + 1}`}>Subir</Boton>
            <Boton chico variante="secundario" onClick={() => mover(i, 1)} deshabilitado={i === items.length - 1} etiqueta={`Bajar foto ${i + 1}`}>Bajar</Boton>
            <Boton chico variante="peligro" onClick={() => setItems(items.filter((_, j) => j !== i))} etiqueta={`Quitar foto ${i + 1}`}>Quitar</Boton>
          </li>
        ))}
      </ol>
      {items.length < 8 && (
        <div class="fila fila-alinear">
          <SelectorBuscable etiqueta="Producto de la foto" valor={productoId} onCambio={setProductoId} opciones={productos.map((p) => ({ valor: p.id, texto: p.nombre }))} ayuda="Escriba para buscar el producto y luego elija la foto." />
          {(fotos.datos ?? []).filter((m) => m.tipo === 'foto' && !items.some((i) => i.medioId === m.id)).map((m) => (
            <Boton key={m.id} chico variante="secundario" etiqueta={`Agregar foto ${m.id.slice(0, 6)}`} onClick={() => setItems([...items, { medioId: m.id, alt: nombreProducto }])}>
              <Miniatura medio={m} alt={nombreProducto !== '' ? `Foto de ${nombreProducto}` : 'Foto del producto'} respaldo={`Foto ${m.id.slice(0, 6)}`} />
              Agregar foto {m.id.slice(0, 6)}
            </Boton>
          ))}
        </div>
      )}
      <h3>Fotos propias de la portada</h3>
      <p class="texto-suave">Fotos que no son de un producto (el local, una campaña). JPG, PNG, WebP o HEIC, hasta 15 MB; la cantidad máxima depende de su plan. Se guardan al subirlas; el orden y el texto alternativo se guardan con «Guardar apariencia».</p>
      <div class="fila fila-alinear">
        <Boton onClick={() => entradaPortada.current?.click()} motivo={subida.enCurso ? 'Hay una subida en curso' : items.length >= 8 ? 'El carrusel ya tiene 8 fotos: quite una para agregar otra' : undefined}>Subir foto a la portada</Boton>
        <input ref={entradaPortada} type="file" hidden aria-label="Archivo de la foto de portada" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif" onChange={(e) => { const input = e.currentTarget; const f = input.files?.[0]; input.value = ''; if (f !== undefined) subida.elegir(f); }} />
      </div>
      <ul class="lista-simple">
        {(propias.datos ?? []).filter((m) => m.tipo === 'foto').map((m, n) => (
          <li key={m.id} class="fila fila-alinear">
            <Miniatura medio={m} alt={`Foto propia ${n + 1} de la portada`} respaldo={`Foto propia ${n + 1}`} />
            {!items.some((i) => i.medioId === m.id) && items.length < 8 && (
              <Boton chico variante="secundario" etiqueta={`Agregar foto propia ${n + 1}`} onClick={() => setItems([...items, { medioId: m.id, alt: '' }])}>Agregar foto propia {n + 1}</Boton>
            )}
            <BotonConfirmado chico peligro texto="Borrar foto" pregunta="¿Borrar la foto propia de la portada?" resumen="Se borra para siempre y se libera su lugar. Si está en el carrusel, quítela primero." textoConfirmar="Sí, borrar" deshabilitado={borrando.ocupado} onConfirmar={() => borrarPropia(m.id)} />
          </li>
        ))}
      </ul>
      {subida.enCurso && (
        <p role="status">{subida.nombre}: {subida.fase === 'subiendo' ? `Subiendo ${String(Math.round(subida.progreso))} %` : subida.fase === 'procesando' ? 'Procesando la foto…' : 'Preparando la subida…'}</p>
      )}
      {subida.fase === 'error' && (
        <Alerta tipo="error">
          {subida.nombre === '' ? '' : `${subida.nombre}: `}{subida.motivo}{' '}
          {subida.reintentable ? <Boton chico variante="secundario" onClick={subida.reintentar}>Reintentar</Boton> : <Boton chico variante="secundario" onClick={subida.descartar}>Entendido</Boton>}
        </Alerta>
      )}
    </Seccion>
  );
}

export function PantallaCatalogo({ sub }: { sub: string }): JSX.Element {
  const { usuario, puedeVer } = useApp();
  const items = usuario.rol === 'adm' ? TODAS : TODAS.filter((i) => i.id === 'tablero' || i.id === 'fichas');
  const actual = items.some((i) => i.id === sub) ? sub : 'tablero';
  return (
    <div>
      <h1>Catálogo y sitio</h1>
      <p class="texto-suave">Productos por mercado hasta {LIMITES_PANEL.productos}; fotos hasta {LIMITES_PANEL.fotosPorProducto} por producto y 1 video.</p>
      {puedeVer('inventario') && <p class="texto-suave">Los productos se crean, importan y exportan en Inventario: <a href="#/inventario/csv">Ir a Inventario</a> (Importar y exportar).</p>}
      <Pestanas etiqueta="Secciones del catálogo" base="catalogo" actual={actual} items={items} />
      {actual === 'tablero' && <Tablero />}
      {actual === 'fichas' && <PantallaFichas />}
      {actual === 'secciones' && <PantallaSecciones />}
      {actual === 'apariencia' && <Apariencia />}
    </div>
  );
}
