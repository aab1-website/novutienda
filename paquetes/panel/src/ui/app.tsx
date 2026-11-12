import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ClienteApi } from '../api/cliente.js';
import type { AlmacenSubidas } from '../subidas/almacen.js';
import type { Sesion, UsuarioSesion } from '../sesion/sesion.js';
import { ITEMS_MENU, menuPara, parsearRuta, puedeVer, rutaPorOmision, type ModulosActivos } from '../util/menu.js';
import { ProveedorAvisos } from './avisos.js';
import { Cargando, Vacio } from './comun.js';
import { CtxApp } from './contexto.js';
import { ProveedorGuardia, useGuardia } from './guardia.js';
import { Login } from './login.js';
import { PantallaAprobaciones } from '../pantallas/pos/aprobaciones.js';
import { PantallaCatalogo } from '../pantallas/consola/catalogo.js';
import { PantallaConfiguracion } from '../pantallas/configuracion.js';
import { PantallaInventario } from '../pantallas/inventarios/inventario.js';
import { PantallaMermas } from '../pantallas/inventarios/mermas.js';
import { PantallaRecibos } from '../pantallas/recibos/recibos.js';
import { PantallaSupervision } from '../pantallas/pos/supervision.js';
import { PantallaUsuarios } from '../pantallas/usuarios.js';
import { PantallaVenta } from '../pantallas/pos/venta.js';

const NOMBRE_APP = 'Panel de gestión';
const ROL_TEXTO = { caj: 'Vendedor', sup: 'Supervisor', adm: 'Administrador' } as const;

function useHash(): string {
  const [h, setH] = useState(window.location.hash);
  useEffect(() => {
    const f = (): void => setH(window.location.hash);
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return h;
}

const existe_ = (seccion: string): boolean => seccion === '' || ITEMS_MENU.some((i) => i.id === seccion);

function useUsuario(sesion: Sesion): UsuarioSesion | null {
  const [u, setU] = useState<UsuarioSesion | null>(sesion.actual());
  useEffect(() => sesion.alCambiar(setU), [sesion]);
  return u;
}

type CargaModulos = { readonly estado: 'cargando' | 'error' } | { readonly estado: 'lista'; readonly modulos: readonly string[] };

/** Módulos encendidos del negocio. Falla cerrado: mientras carga o si falla, no hay módulos (solo pantallas de Central). */
function useModulosActivos(api: ClienteApi, uid: string | undefined): CargaModulos {
  const [carga, setCarga] = useState<CargaModulos>({ estado: 'cargando' });
  useEffect(() => {
    setCarga({ estado: 'cargando' });
    if (uid === undefined) return undefined;
    let vigente = true;
    api.llamar('modulosActivos', {}).then(
      (modulos) => vigente && setCarga({ estado: 'lista', modulos }),
      () => vigente && setCarga({ estado: 'error' }),
    );
    return () => {
      vigente = false;
    };
  }, [api, uid]);
  return carga;
}

type Tema = 'auto' | 'claro' | 'oscuro';

function useTema(): [Tema, () => void] {
  const [tema, setTema] = useState<Tema>(() => {
    const g = localStorage.getItem('panel.tema');
    return g === 'claro' || g === 'oscuro' ? g : 'auto';
  });
  useEffect(() => {
    if (tema === 'auto') document.documentElement.removeAttribute('data-tema');
    else document.documentElement.setAttribute('data-tema', tema);
    if (tema === 'auto') localStorage.removeItem('panel.tema');
    else localStorage.setItem('panel.tema', tema);
  }, [tema]);
  const alternar = (): void => setTema((t) => (t === 'auto' ? 'oscuro' : t === 'oscuro' ? 'claro' : 'auto'));
  return [tema, alternar];
}

/** Mapa id de pantalla del registro → componente (L2-4); una prueba exige que sus claves sean las del registro. */
export const COMPONENTES_PANTALLA: Readonly<Record<string, (p: { sub: string }) => JSX.Element>> = {
  venta: ({ sub }) => <PantallaVenta sub={sub} />,
  recibos: () => <PantallaRecibos />,
  inventario: ({ sub }) => <PantallaInventario sub={sub} />,
  mermas: () => <PantallaMermas />,
  aprobaciones: ({ sub }) => <PantallaAprobaciones sub={sub} />,
  supervision: ({ sub }) => <PantallaSupervision sub={sub} />,
  catalogo: ({ sub }) => <PantallaCatalogo sub={sub} />,
  usuarios: () => <PantallaUsuarios />,
  configuracion: ({ sub }) => <PantallaConfiguracion sub={sub} />,
};

function Pantalla({ seccion, sub }: { seccion: string; sub: string }): JSX.Element {
  const Componente = COMPONENTES_PANTALLA[seccion];
  return Componente === undefined ? <Cargando /> : <Componente sub={sub} />;
}

export function App(p: { sesion: Sesion; api: ClienteApi; almacen: AlmacenSubidas }): JSX.Element {
  return (
    <ProveedorAvisos>
      <AppInterna {...p} />
    </ProveedorAvisos>
  );
}

function AppInterna({ sesion, api, almacen }: { sesion: Sesion; api: ClienteApi; almacen: AlmacenSubidas }): JSX.Element {
  const usuario = useUsuario(sesion);
  const [vencida, setVencida] = useState(false);
  const rutaGuardada = useRef('');
  const yaVencida = useRef(false);
  const hash = useHash();
  const [tema, alternarTema] = useTema();
  const ruta = parsearRuta(hash);
  // G-15: el servidor dijo «unauthenticated» y el token no se pudo renovar (ver hooks.ts). Se guarda la ruta, se cierra la sesión y el ingreso explica por qué; al
  // entrar de nuevo, la ruta sigue en la barra de direcciones y se vuelve a ella.
  const sesionVencida = useCallback(() => {
    if (yaVencida.current) return;
    yaVencida.current = true;
    rutaGuardada.current = window.location.hash;
    setVencida(true);
    void sesion.cerrar();
  }, [sesion]);
  const contexto = useMemo(
    () => (usuario === null ? null : { api, almacen, usuario, cerrarSesion: () => void sesion.cerrar(), sesionVencida, renovarSesion: () => sesion.renovar() }),
    [api, almacen, usuario, sesion, sesionVencida],
  );

  useEffect(() => {
    if (usuario === null) return;
    const guardada = rutaGuardada.current;
    rutaGuardada.current = '';
    yaVencida.current = false;
    setVencida(false);
    if (guardada !== '' && window.location.hash !== guardada) window.location.hash = guardada;
  }, [usuario]);

  const carga = useModulosActivos(api, usuario?.uid);
  const modulos: ModulosActivos = carga.estado === 'lista' ? carga.modulos : null;
  const rol = usuario?.rol;

  useEffect(() => {
    if (rol === undefined || carga.estado === 'cargando' || ruta.seccion !== '') return;
    const inicio = rutaPorOmision(rol, modulos);
    if (inicio !== null) window.location.hash = inicio;
  }, [rol, carga.estado, modulos, ruta.seccion]);

  const tituloPantalla = usuario === null ? undefined : menuPara(usuario.rol, modulos).find((i) => i.id === ruta.seccion)?.titulo;
  useEffect(() => {
    document.title =
      usuario === null ? `Ingreso · ${NOMBRE_APP}` : `${tituloPantalla === undefined ? '' : `${tituloPantalla} · `}${usuario.tenantId} · ${NOMBRE_APP}`;
  }, [usuario, tituloPantalla]);

  const principalListo = usuario !== null && existe_(ruta.seccion) && !(carga.estado === 'cargando' && !puedeVer(usuario.rol, ruta.seccion, modulos));
  // Al cambiar de pantalla el foco pasa al encabezado principal (G-12): quien usa lector de pantalla o teclado se entera del cambio.
  useEffect(() => {
    if (!principalListo) return;
    const main = document.getElementById('contenido');
    const titulo = main?.querySelector<HTMLElement>('h1') ?? main;
    if (titulo === null || titulo === undefined) return;
    if (titulo !== main) titulo.tabIndex = -1;
    titulo.focus({ preventScroll: false });
  }, [principalListo, ruta.seccion]);

  if (usuario === null || contexto === null) return <Login sesion={sesion} nombre={NOMBRE_APP} motivo={vencida ? 'vencida' : undefined} />;

  const menu = menuPara(usuario.rol, modulos);
  const existe = ruta.seccion === '' || ITEMS_MENU.some((i) => i.id === ruta.seccion);
  const permitida = ruta.seccion === '' || puedeVer(usuario.rol, ruta.seccion, modulos);
  // Una pantalla de módulo espera a saber qué módulos hay encendidos (sin parpadeo de «no tiene acceso»).
  const esperando = carga.estado === 'cargando' && existe && !permitida;
  const textoTema = tema === 'auto' ? 'Tema: automático' : tema === 'claro' ? 'Tema: claro' : 'Tema: oscuro';

  return (
    <CtxApp.Provider value={contexto}>
      <ProveedorGuardia>
      <a class="salto" href="#contenido" onClick={(e) => { e.preventDefault(); document.getElementById('contenido')?.focus(); }}>
        Saltar al contenido
      </a>
      <Cabecera
        usuario={usuario}
        tenant={usuario.tenantId}
        cargando={carga.estado === 'cargando'}
        menu={menu}
        seccion={ruta.seccion}
        hash={hash}
        textoTema={textoTema}
        alternarTema={alternarTema}
        cerrarSesion={contexto.cerrarSesion}
      />
      <main id="contenido" tabIndex={-1} class="contenedor principal">
        {!existe ? (
          <Vacio titulo="Esta página no existe" detalle="Elija una opción del menú." />
        ) : esperando ? (
          <Cargando />
        ) : permitida ? (
          <Pantalla seccion={ruta.seccion} sub={ruta.sub} />
        ) : (
          <Vacio titulo="No tiene acceso a esta página" detalle={carga.estado === 'error' ? 'No se pudieron cargar los módulos de su negocio. Recargue la página.' : 'Elija una opción de su menú.'} />
        )}
      </main>
      </ProveedorGuardia>
    </CtxApp.Provider>
  );
}

interface PropsCabecera {
  readonly usuario: UsuarioSesion;
  readonly tenant: string;
  readonly cargando: boolean;
  readonly menu: readonly { id: string; titulo: string }[];
  readonly seccion: string;
  readonly hash: string;
  readonly textoTema: string;
  readonly alternarTema: () => void;
  readonly cerrarSesion: () => void;
}

/**
 * Cabecera. Desde 1024 px se ve completa; por debajo queda una sola fila (marca, comercio y botón «Menú») y el resto
 * (navegación, tema, usuario, salir) se pliega en un panel. El botón lleva `aria-expanded` y `aria-controls`; Esc cierra
 * y devuelve el foco al botón; al abrir, el foco pasa al primer enlace; navegar cierra el panel.
 */
function Cabecera(p: PropsCabecera): JSX.Element {
  const [abierto, setAbierto] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const { confirmarSalida } = useGuardia();

  // Navegar (cualquier cambio de ruta) cierra el menú.
  useEffect(() => setAbierto(false), [p.hash]);
  useEffect(() => {
    if (!abierto) return undefined;
    panel.current?.querySelector<HTMLElement>('a[href]')?.focus();
    const alTeclear = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setAbierto(false);
      boton.current?.focus();
    };
    const alClicFuera = (e: MouseEvent): void => {
      if (e.target instanceof Node && !panel.current?.contains(e.target) && !boton.current?.contains(e.target)) setAbierto(false);
    };
    document.addEventListener('keydown', alTeclear);
    document.addEventListener('click', alClicFuera);
    return () => {
      document.removeEventListener('keydown', alTeclear);
      document.removeEventListener('click', alClicFuera);
    };
  }, [abierto]);

  return (
    <header class="cabecera">
      <div class="cabecera-interior">
        <span class="marca-nombre">{NOMBRE_APP}</span>
        <span class="marca-tenant" title={`Comercio: ${p.tenant}`}>Comercio: {p.tenant}</span>
        <button
          ref={boton}
          type="button"
          class="boton boton-secundario boton-chico boton-menu"
          aria-expanded={abierto}
          aria-controls="cabecera-panel"
          onClick={() => setAbierto((a) => !a)}
        >
          Menú
        </button>
        <div id="cabecera-panel" ref={panel} class={abierto ? 'cabecera-panel abierto' : 'cabecera-panel'}>
          {p.cargando ? (
            <span class="menu" />
          ) : (
            <nav aria-label="Menú principal" class="menu">
              {p.menu.map((i) => (
                <a key={i.id} href={`#/${i.id}`} aria-current={p.seccion === i.id ? 'page' : undefined}>
                  {i.titulo}
                </a>
              ))}
            </nav>
          )}
          <div class="controles">
            <button type="button" class="boton boton-secundario boton-chico" onClick={p.alternarTema}>
              {p.textoTema}
            </button>
            <span class="texto-suave usuario-actual">
              {p.usuario.correo} · {ROL_TEXTO[p.usuario.rol]}
            </span>
            <button type="button" class="boton boton-secundario boton-chico" onClick={() => confirmarSalida(p.cerrarSesion)}>
              Salir
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
