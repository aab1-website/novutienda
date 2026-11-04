import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { LIMITES_PANEL, PLANTILLAS_SITIO, type Carrusel, type ConfigSitio, type PlantillaSitio, type Simulacion } from '../api/tipos.js';
import { Alerta, Boton, BotonConfirmado, Campo, Cargando, Casilla, Dato, ErrorCarga, Pestanas, Selector, Seccion, Vacio, fechaHora } from '../ui/comun.js';
import { useApp } from '../ui/contexto.js';
import { useAccion, useCarga } from '../ui/hooks.js';
import { aBase64, formatoBytes } from '../util/base64.js';
import { descargarTexto } from '../util/csv.js';
import { PALETAS } from '../util/plantillas-vista.js';
import { PantallaFichas } from './catalogo-ficha.js';
import { PantallaSecciones } from './catalogo-secciones.js';

const TODAS = [
  { id: 'tablero', titulo: 'Tablero' }, { id: 'fichas', titulo: 'Fichas, fotos y video' }, { id: 'secciones', titulo: 'Secciones' },
  { id: 'apariencia', titulo: 'Apariencia' }, { id: 'importar', titulo: 'Importar y exportar' },
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

function Tablero(): JSX.Element {
  const { api, usuario } = useApp();
  const t = useCarga(() => api.llamar('obtenerTablero', {}), []);
  const accion = useAccion();
  const [msg, setMsg] = useState<string | null>(null);
  if (t.cargando) return <Cargando />;
  if (t.error || !t.datos) return <ErrorCarga error={t.error ?? 'Sin datos'} reintentar={t.recargar} />;
  const d = t.datos;
  return (
    <div>
      <Seccion titulo="Sitio">
        <dl class="datos">
          <Dato etiqueta="Cambios sin publicar"><span data-prueba="cambios">{d.cambiosSinPublicar}</span></Dato>
          <Dato etiqueta="Último cambio">{fechaHora(d.ultimoCambioEn)}</Dato>
          <Dato etiqueta="Publicado">{d.publicadoEn === null ? 'Todavía no se publicó' : `${fechaHora(d.publicadoEn)} (versión ${d.versionPublicada})`}</Dato>
        </dl>
        {usuario.rol === 'adm' ? (
          <BotonConfirmado texto="Publicar el sitio" pregunta="¿Publicar los cambios? El sitio se reconstruye en unos minutos." textoConfirmar="Sí, publicar" deshabilitado={accion.ocupado || d.cambiosSinPublicar === 0} onConfirmar={() => void accion.ejecutar(async () => { const r = await api.llamar('publicarSitio', {}); setMsg(`Publicado: versión ${r.version}, ${r.productos} productos.${r.advertencias.length ? ` Avisos: ${r.advertencias.join(' ')}` : ''}`); t.recargar(); })} />
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
              {c.mercado === 'BO' ? 'Bolivia' : 'Argentina'}:{' '}
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

function Apariencia(): JSX.Element {
  const { api } = useApp();
  const datos = useCarga(async () => ({ config: await api.llamar('leerConfigSitio', {}), carruseles: await api.llamar('listarCarruseles', {}), productos: await api.llamar('listarProductos', {}) }), []);
  const accion = useAccion();
  const [cfg, setCfg] = useState<ConfigSitio | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [items, setItems] = useState<Carrusel['items'] | null>(null);
  if (datos.cargando) return <Cargando />;
  if (datos.error || !datos.datos) return <ErrorCarga error={datos.error ?? 'Sin datos'} reintentar={datos.recargar} />;
  const c: ConfigSitio = cfg ?? datos.datos.config ?? { plantillaActiva: 'cielo', whatsappNovuchat: '', medicion: {} };
  const med = c.medicion;
  const setMed = (k: keyof ConfigSitio['medicion'], v: string): void => {
    const { [k]: _quitado, ...resto } = med;
    void _quitado;
    setCfg({ ...c, medicion: v.trim() === '' ? resto : { ...resto, [k]: v.trim() } });
    setOk(null);
  };
  const carrusel = datos.datos.carruseles.find((x) => x.plantilla === c.plantillaActiva);
  const itemsActuales = items ?? carrusel?.items ?? [];
  return (
    <div>
      <Seccion titulo="Plantilla de color">
        <p class="texto-suave">Cinco plantillas, cada una con tema claro y oscuro. Las vistas son aproximadas; el sitio muestra la definitiva.</p>
        <fieldset class="plantillas">
          <legend>Plantilla activa</legend>
          {PLANTILLAS_SITIO.map((id) => (
            <label key={id} class={`plantilla-opcion ${c.plantillaActiva === id ? 'activa' : ''}`}>
              <input type="radio" name="plantilla" value={id} checked={c.plantillaActiva === id} onChange={() => { setCfg({ ...c, plantillaActiva: id }); setItems(null); setOk(null); }} />
              <span class="plantilla-nombre">{PALETAS[id].nombre}</span>
              <span class="fila"><VistaPrevia id={id} tema="claro" /><VistaPrevia id={id} tema="oscuro" /></span>
            </label>
          ))}
        </fieldset>
        <div class="cuadricula">
          <Campo etiqueta="WhatsApp del asistente (solo dígitos, con código de país)" valor={c.whatsappNovuchat} onInput={(v) => { setCfg({ ...c, whatsappNovuchat: v }); setOk(null); }} inputMode="numeric" requerido />
          <Campo etiqueta="Google Analytics (G-…)" valor={med.ga4 ?? ''} onInput={(v) => setMed('ga4', v)} />
          <Campo etiqueta="Search Console" valor={med.searchConsole ?? ''} onInput={(v) => setMed('searchConsole', v)} />
          <Campo etiqueta="Píxel de Meta" valor={med.metaPixel ?? ''} onInput={(v) => setMed('metaPixel', v)} />
          <Campo etiqueta="Píxel de TikTok" valor={med.tiktokPixel ?? ''} onInput={(v) => setMed('tiktokPixel', v)} />
        </div>
        {accion.error && <Alerta>{accion.error}</Alerta>}
        {ok && <Alerta tipo="ok">{ok}</Alerta>}
        <Boton ocupado={accion.ocupado} deshabilitado={!/^[1-9]\d{7,14}$/.test(c.whatsappNovuchat)} onClick={() => void accion.ejecutar(async () => { await api.llamar('guardarConfigSitio', { config: c }); setOk('Apariencia guardada. Falta publicar el sitio.'); setCfg(null); datos.recargar(); })}>
          Guardar apariencia
        </Boton>
      </Seccion>
      <CarruselEditor plantilla={c.plantillaActiva} items={itemsActuales} setItems={setItems} productos={datos.datos.productos.map((p) => ({ id: p.id, nombre: p.nombre }))} alGuardar={datos.recargar} />
    </div>
  );
}

function CarruselEditor({ plantilla, items, setItems, productos, alGuardar }: { plantilla: PlantillaSitio; items: Carrusel['items']; setItems: (i: Carrusel['items']) => void; productos: { id: string; nombre: string }[]; alGuardar: () => void }): JSX.Element {
  const { api } = useApp();
  const accion = useAccion();
  const [productoId, setProductoId] = useState(productos[0]?.id ?? '');
  const fotos = useCarga(() => (productoId === '' ? Promise.resolve([]) : api.llamar('listarMedios', { productoId })), [productoId]);
  const [ok, setOk] = useState(false);
  const mover = (i: number, d: number): void => {
    const n = [...items];
    const x = n[i];
    const y = n[i + d];
    if (x === undefined || y === undefined) return;
    n[i] = y;
    n[i + d] = x;
    setItems(n);
  };
  return (
    <Seccion titulo={`Carrusel de portada (${PALETAS[plantilla].nombre})`}>
      {items.length === 0 && <Vacio titulo="El carrusel no tiene fotos" detalle="Agregue hasta 8 fotos de los productos." />}
      <ol class="lista-simple">
        {items.map((it, i) => (
          <li key={it.medioId} class="fila fila-alinear">
            <span>{i + 1}.</span>
            <Campo etiqueta={`Texto alternativo de la foto ${i + 1}`} valor={it.alt} onInput={(v) => setItems(items.map((x, j) => (j === i ? { ...x, alt: v } : x)))} />
            <Boton chico variante="secundario" onClick={() => mover(i, -1)} deshabilitado={i === 0} etiqueta={`Subir foto ${i + 1}`}>Subir</Boton>
            <Boton chico variante="secundario" onClick={() => mover(i, 1)} deshabilitado={i === items.length - 1} etiqueta={`Bajar foto ${i + 1}`}>Bajar</Boton>
            <Boton chico variante="peligro" onClick={() => setItems(items.filter((_, j) => j !== i))} etiqueta={`Quitar foto ${i + 1}`}>Quitar</Boton>
          </li>
        ))}
      </ol>
      {items.length < 8 && (
        <div class="fila fila-alinear">
          <Selector etiqueta="Producto de la foto" valor={productoId} onCambio={setProductoId} opciones={productos.map((p) => ({ valor: p.id, texto: p.nombre }))} />
          {(fotos.datos ?? []).filter((m) => m.tipo === 'foto' && !items.some((i) => i.medioId === m.id)).map((m) => (
            <Boton key={m.id} chico variante="secundario" onClick={() => setItems([...items, { medioId: m.id, alt: '' }])}>Agregar foto {m.id.slice(0, 6)}</Boton>
          ))}
        </div>
      )}
      {accion.error && <Alerta>{accion.error}</Alerta>}
      {ok && <Alerta tipo="ok">Carrusel guardado.</Alerta>}
      <Boton ocupado={accion.ocupado} deshabilitado={items.some((i) => i.alt.trim() === '')} onClick={() => void accion.ejecutar(async () => { await api.llamar('guardarCarrusel', { carrusel: { plantilla, items } }); setOk(true); alGuardar(); })}>
        Guardar carrusel
      </Boton>
      {items.some((i) => i.alt.trim() === '') && <p class="texto-suave">Cada foto necesita texto alternativo.</p>}
    </Seccion>
  );
}

function Importar(): JSX.Element {
  const { api } = useApp();
  const accion = useAccion();
  const [contenido, setContenido] = useState<string | null>(null);
  const [sim, setSim] = useState<Simulacion | null>(null);
  const [omitir, setOmitir] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const elegir = (e: Event): void => {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    if (f === undefined) return;
    void accion.ejecutar(async () => {
      const b64 = aBase64(new Uint8Array(await f.arrayBuffer()));
      setContenido(b64);
      setSim(await api.llamar('simularImportacion', { contenidoBase64: b64 }));
      setMsg(null);
    });
  };
  return (
    <Seccion titulo="Importar y exportar productos">
      <p class="texto-suave">Siempre se simula antes de importar. El archivo no modifica el stock. Se admite CSV (y Excel si el servidor lo habilita).</p>
      <div class="fila">
        <Boton variante="secundario" onClick={() => void accion.ejecutar(async () => { descargarTexto('productos-sitio.csv', (await api.llamar('exportarProductosCsvSitio', {})).csv); })}>Exportar productos</Boton>
      </div>
      <div class="campo">
        <label for="archivo-importar">Archivo a importar</label>
        <input id="archivo-importar" type="file" accept=".csv,.xlsx,text/csv" onChange={elegir} />
      </div>
      {accion.error && <Alerta>{accion.error}</Alerta>}
      {sim && (
        <div>
          <p>Simulación: <strong>{sim.resumen.crear}</strong> por crear, <strong>{sim.resumen.actualizar}</strong> por actualizar, <strong>{sim.resumen.sinCambios}</strong> sin cambios, <strong>{sim.resumen.errores}</strong> con errores.</p>
          {sim.columnasIgnoradas.length > 0 && <Alerta tipo="info">Se ignoran: {sim.columnasIgnoradas.join(', ')}.</Alerta>}
          <table class="tabla">
            <caption class="solo-lectores">Simulación de la importación</caption>
            <thead><tr><th scope="col">Línea</th><th scope="col">Producto</th><th scope="col">Acción</th><th scope="col">Detalle</th></tr></thead>
            <tbody>{sim.filas.map((f) => <tr key={f.linea}><td>{f.linea}</td><td>{f.id}</td><td>{f.accion}</td><td>{[...f.errores, ...f.advertencias].join('; ')}</td></tr>)}</tbody>
          </table>
          {sim.resumen.errores > 0 && <Casilla etiqueta="Importar omitiendo las filas con error" marcado={omitir} onCambio={setOmitir} />}
          <Boton ocupado={accion.ocupado} deshabilitado={contenido === null || (sim.resumen.errores > 0 && !omitir) || sim.resumen.crear + sim.resumen.actualizar === 0} onClick={() => void accion.ejecutar(async () => { const r = await api.llamar('importarProductos', { contenidoBase64: contenido ?? '', omitirErrores: omitir }); setMsg(`Importadas ${r.aplicadas} filas.`); setSim(null); setContenido(null); })}>
            Importar
          </Boton>
        </div>
      )}
      {msg && <Alerta tipo="ok">{msg}</Alerta>}
    </Seccion>
  );
}

export function PantallaCatalogo({ sub }: { sub: string }): JSX.Element {
  const { usuario } = useApp();
  const items = usuario.rol === 'adm' ? TODAS : TODAS.filter((i) => i.id === 'tablero' || i.id === 'fichas');
  const actual = items.some((i) => i.id === sub) ? sub : 'tablero';
  return (
    <div>
      <h1>Catálogo y sitio</h1>
      <p class="texto-suave">Productos por mercado hasta {LIMITES_PANEL.productos}; fotos hasta {LIMITES_PANEL.fotosPorProducto} por producto y 1 video.</p>
      <Pestanas etiqueta="Secciones del catálogo" base="catalogo" actual={actual} items={items} />
      {actual === 'tablero' && <Tablero />}
      {actual === 'fichas' && <PantallaFichas />}
      {actual === 'secciones' && <PantallaSecciones />}
      {actual === 'apariencia' && <Apariencia />}
      {actual === 'importar' && <Importar />}
    </div>
  );
}
