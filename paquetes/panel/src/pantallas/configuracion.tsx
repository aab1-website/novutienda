import { esNitValido, MENSAJE_NIT } from '@novutienda/nucleo';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { MEDIOS_PAGO, type ConfigPos, type LogoNegocio, type MercadoDeclarado, type MedioPago, type PlantillaRecibo } from '../api/tipos.js';
import { Alerta, Area, Boton, Campo, Cargando, Casilla, ErrorCarga, Pestanas, Selector, Seccion } from '../ui/comun.js';
import { useAvisos } from '../ui/avisos.js';
import { ErrorApi, mensajeDeError } from '../api/errores.js';
import { useApp } from '../ui/contexto.js';
import { useCambiosSinGuardar } from '../ui/guardia.js';
import { useAccion, useCarga } from '../ui/hooks.js';
import { useConfiguracionComercial } from '../ui/comercial.js';
import { Tabla } from '../ui/tabla.js';
import { baseDeMedios, urlDelLogo } from '../util/logo.js';

const MEDIO_TEXTO: Record<MedioPago, string> = { efectivo: 'Efectivo', qr: 'QR', transferencia: 'Transferencia', credito: 'Crédito' };
const bpAPorciento = (bp: number): string => String(bp / 100).replace('.', ',');
const porcientoABp = (t: string): number | null => {
  const n = Number(t.trim().replace(',', '.'));
  return t.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) : null;
};
const opc = (t: string): string | undefined => (t.trim() === '' ? undefined : t.trim());

type Destino = 'caja' | 'recibos';
const NOMBRE_DESTINO: Record<Destino, string> = { caja: 'la configuración de la caja', recibos: 'la plantilla de recibos' };
interface DatosNegocio { readonly nombre: string; readonly direccion: string; readonly telefono: string; readonly nit: string; readonly logoUrl: string }
const CAMPOS_NEGOCIO = ['nombre', 'direccion', 'telefono', 'nit', 'logoUrl'] as const;
const datosDe = (n: ConfigPos['negocio'], logo: string | undefined): DatosNegocio => ({ nombre: n.nombre, direccion: n.direccion ?? '', telefono: n.telefono ?? '', nit: n.nit ?? '', logoUrl: logo ?? '' });
const normal = (d: DatosNegocio): string => JSON.stringify(CAMPOS_NEGOCIO.map((k) => d[k].trim()));
const negocioDe = (d: DatosNegocio): ConfigPos['negocio'] => ({ nombre: d.nombre.trim(), ...(opc(d.direccion) ? { direccion: opc(d.direccion) as string } : {}), ...(opc(d.telefono) ? { telefono: opc(d.telefono) as string } : {}), ...(opc(d.nit) ? { nit: opc(d.nit) as string } : {}) });

/** Topes más estrictos de los dos validadores del servidor (caja y recibos): el formulario avisa antes de enviar. */
function validarNegocio(d: DatosNegocio): Partial<Record<keyof DatosNegocio, string>> {
  const e: Partial<Record<keyof DatosNegocio, string>> = {};
  if (d.nombre.trim().length > 100) e.nombre = 'El nombre admite hasta 100 caracteres';
  if (d.direccion.trim().length > 200) e.direccion = 'La dirección admite hasta 200 caracteres';
  if (d.telefono.trim().length > 30) e.telefono = 'El teléfono admite hasta 30 caracteres';
  if (d.nit.trim() !== '' && !esNitValido(d.nit.trim())) e.nit = MENSAJE_NIT;
  const logo = d.logoUrl.trim();
  // Igual de estricto que caja y recibos: https en minúsculas, sin espacios ni comillas, hasta 490 caracteres tras https://.
  if (logo !== '' && !/^https:\/\/[^\s"'<>`\\]{1,490}$/.test(logo)) e.logoUrl = 'La dirección del logo debe empezar con https://, sin espacios ni comillas';
  return e;
}

type EstadoLogo = { readonly estado: 'subido'; readonly logo: LogoNegocio } | { readonly estado: 'sin-logo' } | { readonly estado: 'no-disponible' };

/**
 * Logo subido como archivo (se sube en Catálogo y sitio). Sin logo subido, la dirección web de abajo sigue siendo el respaldo;
 * si la acción no está disponible (módulo apagado, sin permiso o error), solo se dice «Sin logo subido».
 */
function LogoSubido({ estado, conDireccion }: { readonly estado: EstadoLogo; readonly conDireccion: boolean }): JSX.Element {
  // Si la imagen no carga (ruta caída, base mal configurada) se muestra el texto del caso, nunca un ícono roto.
  const [fallida, setFallida] = useState<string | null>(null);
  const urlVista = estado.estado === 'subido' ? urlDelLogo(baseDeMedios(), estado.logo) : null;
  if (estado.estado === 'no-disponible') return <p class="texto-suave" data-prueba="logo-no-disponible">Sin logo subido</p>;
  if (estado.estado === 'sin-logo' || (urlVista !== null && fallida === urlVista)) {
    return (
      <p class="texto-suave" data-prueba="logo-sin-subir">
        {conDireccion ? 'Se usa la dirección web de abajo como respaldo. ' : 'Sin logo subido. '}
        Puede subir un archivo en <a href="#/catalogo/apariencia">Catálogo y sitio</a>.
      </p>
    );
  }
  const url = urlVista;
  return (
    <div data-prueba="logo-subido">
      {url !== null && <img src={url} alt="Logo del negocio" referrerpolicy="no-referrer" onError={() => setFallida(url)} width={96} height={96} style="width:96px;height:96px;object-fit:contain" />}
      <p class="texto-suave">Este logo se sube en <a href="#/catalogo/apariencia">Catálogo y sitio → Apariencia</a>. La dirección web de abajo queda de respaldo.</p>
    </div>
  );
}

/**
 * Datos del negocio: se editan una vez y se guardan en sus dos destinos (configuración de la caja y plantilla de recibos)
 * con las acciones existentes. El guardado no es atómico: se dice cuál quedó guardado y cuál no, y se reintenta solo el que falló.
 */
function DatosDelNegocio(): JSX.Element {
  const { api, sesionVencida, renovarSesion } = useApp();
  const caja = useCarga(() => api.llamar('leerConfigPos', {}), []);
  const recibos = useCarga(() => api.llamar('leerPlantilla', {}), []);
  // El logo subido es de otro módulo: si no se puede leer, la pantalla sigue sin él.
  const logo = useCarga<EstadoLogo>(() => api.llamar('leerLogo', {}).then((l): EstadoLogo => (l === null ? { estado: 'sin-logo' } : { estado: 'subido', logo: l }), (): EstadoLogo => ({ estado: 'no-disponible' })), []);
  const avisos = useAvisos();
  const [d, setD] = useState<DatosNegocio | null>(null);
  const [base, setBase] = useState('');
  const [difieren, setDifieren] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  // Destinos que no se guardaron en el último intento, con el motivo, y lo enviado (el reintento reenvía eso mismo).
  const [fallos, setFallos] = useState<Partial<Record<Destino, string>>>({});
  const [enviado, setEnviado] = useState<DatosNegocio | null>(null);
  const [resultado, setResultado] = useState('');
  const avisoGuardado = useRef(0);
  const enCurso = useRef(false);
  useEffect(() => {
    if (caja.datos === undefined || recibos.datos === undefined) return;
    const deCaja = datosDe(caja.datos.negocio, caja.datos.logoUrl);
    setD(deCaja);
    setBase(normal(deCaja));
    setDifieren(normal(deCaja) !== normal(datosDe(recibos.datos.negocio, recibos.datos.logoUrl)));
  }, [caja.datos, recibos.datos]);
  const pendientes = (Object.keys(fallos) as Destino[]).filter((k) => fallos[k] !== undefined);
  const sucio = d !== null && (normal(d) !== base || pendientes.length > 0);
  const { marcarGuardado } = useCambiosSinGuardar(sucio);
  if (caja.cargando || recibos.cargando || d === null) {
    const error = caja.error ?? recibos.error;
    return error ? <ErrorCarga error={error} reintentar={() => { caja.recargar(); recibos.recargar(); }} /> : <Cargando />;
  }
  const poner = (k: keyof DatosNegocio, v: string): void => {
    if (avisoGuardado.current !== 0) avisos.cerrar(avisoGuardado.current);
    avisoGuardado.current = 0;
    setResultado('');
    setFallos({});
    setEnviado(null);
    setD({ ...d, [k]: v });
  };
  const errores = validarNegocio(d);
  const motivo = d.nombre.trim() === '' ? 'Escriba el nombre del negocio' : Object.values(errores)[0];

  /** Una escritura con la renovación de sesión de siempre; devuelve el motivo del fallo o `null` si se guardó. */
  const intentar = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try {
      try {
        await fn();
      } catch (e) {
        if (!(e instanceof ErrorApi && e.codigoHttps === 'unauthenticated') || !(await renovarSesion().catch(() => false))) throw e;
        await fn();
      }
      return null;
    } catch (e) {
      if (e instanceof ErrorApi && e.codigoHttps === 'unauthenticated') sesionVencida();
      return mensajeDeError(e);
    }
  };
  const escribir: Record<Destino, (x: DatosNegocio) => Promise<unknown>> = {
    caja: async (x) => {
      const v = await api.llamar('leerConfigPos', {});
      const logo = opc(x.logoUrl);
      const config: ConfigPos = { negocio: negocioDe(x), ...(logo !== undefined ? { logoUrl: logo } : {}), colores: v.colores, mediosHabilitados: v.mediosHabilitados, monedaPorDefecto: v.monedaPorDefecto, topesDescuentoBp: v.topesDescuentoBp, textoRecibo: v.textoRecibo, serieRecibo: v.serieRecibo };
      await api.llamar('guardarConfigPos', { config });
    },
    recibos: async (x) => {
      const v = await api.llamar('leerPlantilla', {});
      const logo = opc(x.logoUrl);
      const plantilla: PlantillaRecibo = { negocio: negocioDe(x), ...(logo !== undefined ? { logoUrl: logo } : {}), ...(v.pie !== undefined ? { pie: v.pie } : {}), ...(v.politicaGarantia !== undefined ? { politicaGarantia: v.politicaGarantia } : {}), ...(v.politicaCambios !== undefined ? { politicaCambios: v.politicaCambios } : {}) };
      await api.llamar('guardarPlantilla', { plantilla });
    },
  };
  const guardarEn = async (destinos: readonly Destino[], x: DatosNegocio): Promise<void> => {
    if (enCurso.current) return;
    enCurso.current = true;
    setOcupado(true);
    setResultado('');
    try {
      const nuevos: Partial<Record<Destino, string>> = {};
      for (const dest of destinos) {
        const motivoFallo = await intentar(() => escribir[dest](x));
        if (motivoFallo !== null) nuevos[dest] = motivoFallo;
      }
      // Lo que ya estaba guardado de un intento anterior sigue guardado: solo cuentan los destinos de este intento.
      const sigue = (Object.keys(fallos) as Destino[]).filter((k) => !destinos.includes(k) && fallos[k] !== undefined);
      const todos: Partial<Record<Destino, string>> = { ...Object.fromEntries(sigue.map((k) => [k, fallos[k]])), ...nuevos };
      setEnviado(x);
      setFallos(todos);
      if (Object.keys(todos).length === 0) {
        marcarGuardado();
        setBase(normal(x));
        setDifieren(false);
        avisoGuardado.current = avisos.ok('Datos del negocio guardados. Se usan en la caja y en los recibos nuevos.');
      } else {
        const guardados = (['caja', 'recibos'] as const).filter((k) => todos[k] === undefined);
        const faltan = (['caja', 'recibos'] as const).filter((k) => todos[k] !== undefined);
        const texto =
          guardados.length === 0
            ? `No se guardaron los datos del negocio ni en ${NOMBRE_DESTINO.caja} ni en ${NOMBRE_DESTINO.recibos}. ${faltan.map((k) => `${NOMBRE_DESTINO[k]}: ${todos[k]}`).join(' ')}`
            : `Los datos del negocio se guardaron en ${NOMBRE_DESTINO[guardados[0] as Destino]}, pero no en ${NOMBRE_DESTINO[faltan[0] as Destino]}: ${todos[faltan[0] as Destino]}`;
        setResultado(texto);
        avisos.error(texto, { silencioso: true });
      }
    } finally {
      enCurso.current = false;
      setOcupado(false);
    }
  };
  const guardar = (e: Event): void => {
    e.preventDefault();
    if (motivo !== undefined) return;
    void guardarEn(['caja', 'recibos'], d);
  };
  return (
    <Seccion titulo="Datos del negocio">
      <p class="texto-suave">Se escriben una sola vez y se guardan en la configuración de la caja y en la plantilla de los recibos.</p>
      {difieren && (
        <Alerta tipo="info">
          La caja y la plantilla de recibos tenían datos distintos. Abajo se muestran los de la caja; al pulsar "Guardar datos del negocio" quedarán iguales en las dos.
        </Alerta>
      )}
      <form class="formulario" onSubmit={guardar} noValidate>
        <div class="cuadricula">
          <Campo etiqueta="Nombre del negocio" valor={d.nombre} onInput={(v) => poner('nombre', v)} requerido error={errores.nombre} />
          <Campo etiqueta="Dirección" valor={d.direccion} onInput={(v) => poner('direccion', v)} error={errores.direccion} />
          <Campo etiqueta="Teléfono" valor={d.telefono} onInput={(v) => poner('telefono', v)} error={errores.telefono} />
          <Campo etiqueta="NIT" inputMode="numeric" valor={d.nit} onInput={(v) => poner('nit', v)} error={errores.nit} />
          <Campo etiqueta="Logo por dirección web (opcional; mejor súbalo en Catálogo y sitio)" valor={d.logoUrl} onInput={(v) => poner('logoUrl', v)} error={errores.logoUrl} />
        </div>
        {logo.datos !== undefined && <LogoSubido estado={logo.datos} conDireccion={d.logoUrl.trim() !== ''} />}
        {resultado !== '' && <Alerta>{resultado}</Alerta>}
        {pendientes.length > 0 && enviado !== null && (
          <div class="acciones">
            {pendientes.map((k) => (
              <Boton key={k} tipo="button" variante="secundario" ocupado={ocupado} onClick={() => void guardarEn([k], enviado)}>
                {`Reintentar en ${NOMBRE_DESTINO[k]}`}
              </Boton>
            ))}
          </div>
        )}
        <Boton tipo="submit" ocupado={ocupado} motivo={motivo}>
          Guardar datos del negocio
        </Boton>
      </form>
    </Seccion>
  );
}

function ConfigPosForm(): JSX.Element {
  const { api } = useApp();
  const cfg = useCarga(() => api.llamar('leerConfigPos', {}), []);
  const comercial = useConfiguracionComercial();
  const accion = useAccion();
  const avisos = useAvisos();
  const [c, setC] = useState<ConfigPos | null>(null);
  const [topes, setTopes] = useState({ caj: '', sup: '', adm: '' });
  // Lo último cargado o guardado: lo que difiera de esto es «cambios sin guardar».
  const [base, setBase] = useState<string | null>(null);
  const avisoGuardado = useRef(0);
  useEffect(() => {
    if (cfg.datos !== undefined) {
      const t = { caj: bpAPorciento(cfg.datos.topesDescuentoBp.caj), sup: bpAPorciento(cfg.datos.topesDescuentoBp.sup), adm: bpAPorciento(cfg.datos.topesDescuentoBp.adm) };
      setC(cfg.datos);
      setTopes(t);
      setBase(JSON.stringify([cfg.datos, t]));
    }
  }, [cfg.datos]);
  const sucio = c !== null && base !== null && JSON.stringify([c, topes]) !== base;
  const { marcarGuardado } = useCambiosSinGuardar(sucio);
  if (cfg.cargando || c === null) return cfg.error ? <ErrorCarga error={cfg.error} reintentar={cfg.recargar} /> : <Cargando />;

  // Las monedas de cobro son las que declara el comercio; sin su configuración solo se ofrece la vigente (no se inventan).
  const monedas = comercial.estado === 'lista' ? comercial.comercial.monedasCaja : [c.monedaPorDefecto];
  const bp = { caj: porcientoABp(topes.caj), sup: porcientoABp(topes.sup), adm: porcientoABp(topes.adm) };
  const topesOk = bp.caj !== null && bp.sup !== null && bp.adm !== null;
  const guardar = (e: Event): void => {
    e.preventDefault();
    // El botón ya lo impide; el envío por teclado (Enter) también se valida aquí.
    if (!topesOk || c.mediosHabilitados.length === 0) return;
    const resto = {
      colores: c.colores, mediosHabilitados: c.mediosHabilitados, monedaPorDefecto: c.monedaPorDefecto,
      topesDescuentoBp: { caj: bp.caj as number, sup: bp.sup as number, adm: bp.adm as number }, textoRecibo: c.textoRecibo, serieRecibo: c.serieRecibo.trim().toUpperCase(),
    };
    const enviado = JSON.stringify([c, topes]);
    void accion.ejecutar(async () => {
      // Los datos del negocio y el logo se editan en su propia sección: se toman de lo guardado, no de lo cargado al abrir.
      // Límite aceptado: entre releer y escribir puede colarse otro guardado, porque el servidor reemplaza el registro completo.
      const vigente = await api.llamar('leerConfigPos', {});
      const config: ConfigPos = { negocio: vigente.negocio, ...(vigente.logoUrl !== undefined ? { logoUrl: vigente.logoUrl } : {}), ...resto };
      await api.llamar('guardarConfigPos', { config });
      marcarGuardado();
      setBase(enviado);
      avisoGuardado.current = avisos.ok('Configuración guardada.');
    }, { error: 'ambos' });
  };
  // Al cambiar algo, el «guardado» anterior ya no describe lo que se ve: se retira.
  const editado = (): void => {
    if (avisoGuardado.current !== 0) avisos.cerrar(avisoGuardado.current);
    avisoGuardado.current = 0;
  };
  const poner = (nuevo: ConfigPos): void => { editado(); setC(nuevo); };
  const ponerTopes = (nuevo: typeof topes): void => { editado(); setTopes(nuevo); };
  const alternarMedio = (m: MedioPago, v: boolean): void => poner({ ...c, mediosHabilitados: v ? [...c.mediosHabilitados, m] : c.mediosHabilitados.filter((x) => x !== m) });
  const motivo = !topesOk
    ? 'Los topes de descuento deben estar entre 0 y 100'
    : c.mediosHabilitados.length === 0
      ? 'Habilite al menos un medio de pago'
      : undefined;

  return (
    <Seccion titulo="Punto de venta">
      <form class="formulario" onSubmit={guardar} noValidate>
        <div class="cuadricula">
          <Campo etiqueta="Color primario" tipo="color" valor={c.colores.primario} onInput={(v) => poner({ ...c, colores: { ...c.colores, primario: v } })} ayuda="Color de su negocio en el punto de venta." />
          <Campo etiqueta="Color secundario" tipo="color" valor={c.colores.secundario} onInput={(v) => poner({ ...c, colores: { ...c.colores, secundario: v } })} ayuda="Color de apoyo de su negocio en el punto de venta." />
          <Selector etiqueta="Moneda por defecto" valor={c.monedaPorDefecto} onCambio={(v) => poner({ ...c, monedaPorDefecto: v })} deshabilitado={comercial.estado !== 'lista'} opciones={monedas.map((m) => ({ valor: m, texto: m }))} />
          <Campo etiqueta="Serie del recibo" valor={c.serieRecibo} onInput={(v) => poner({ ...c, serieRecibo: v })} maxLength={6} ayuda="1 a 6 letras mayúsculas o dígitos. Se define solo aquí." />
        </div>
        <fieldset>
          <legend>Medios de pago habilitados</legend>
          {MEDIOS_PAGO.map((m) => <Casilla key={m} etiqueta={MEDIO_TEXTO[m]} marcado={c.mediosHabilitados.includes(m)} onCambio={(v) => alternarMedio(m, v)} />)}
        </fieldset>
        <fieldset>
          <legend>Tope de descuento sin aprobación (% del subtotal)</legend>
          <div class="cuadricula">
            <Campo etiqueta="Vendedor" valor={topes.caj} onInput={(v) => ponerTopes({ ...topes, caj: v })} inputMode="decimal" ayuda="Porcentaje máximo que puede dar sin pedir aprobación." />
            <Campo etiqueta="Supervisor" valor={topes.sup} onInput={(v) => ponerTopes({ ...topes, sup: v })} inputMode="decimal" />
            <Campo etiqueta="Administrador" valor={topes.adm} onInput={(v) => ponerTopes({ ...topes, adm: v })} inputMode="decimal" />
          </div>
        </fieldset>
        <Area etiqueta="Texto del recibo" valor={c.textoRecibo} onInput={(v) => poner({ ...c, textoRecibo: v })} />
        {accion.error && <Alerta>{accion.error}</Alerta>}
        <Boton tipo="submit" ocupado={accion.ocupado} motivo={motivo}>
          Guardar configuración
        </Boton>
      </form>
    </Seccion>
  );
}

const TEXTO_CAMBIO = (m: MercadoDeclarado): string => (m.tieneTipoCambio ? `Sí (${m.monedaVenta}/${m.monedaBase})` : 'No: el precio base es el precio');

/** Mercados y monedas del comercio, solo lectura: los define el operador de la plataforma, no se editan aquí. */
function MercadosYMonedas(): JSX.Element {
  const c = useConfiguracionComercial();
  return (
    <Seccion titulo="Mercados y monedas">
      <p class="texto-suave">Solo lectura. Los mercados y las monedas los define el operador de la plataforma; para cambiarlos, solicítelo a él.</p>
      {c.estado === 'cargando' && <Cargando />}
      {c.estado === 'error' && <Alerta>{`No se pudieron cargar los mercados y monedas. ${c.mensaje}`}</Alerta>}
      {c.estado === 'lista' && (
        <>
          <Tabla
            titulo="Mercados del comercio"
            filas={c.comercial.mercados}
            clave={(m) => m.id}
            vacio={{ titulo: 'No hay mercados declarados' }}
            columnas={[
              { id: 'mercado', titulo: 'Mercado', valor: (m) => m.nombre, encabezadoFila: true },
              { id: 'venta', titulo: 'Moneda de venta', valor: (m) => m.monedaVenta },
              { id: 'base', titulo: 'Moneda base del precio', valor: (m) => m.monedaBase },
              { id: 'cambio', titulo: 'Tipo de cambio', valor: TEXTO_CAMBIO },
            ]}
          />
          <p>Monedas de cobro en caja: {c.comercial.monedasCaja.join(', ')}.</p>
          {c.comercial.monedaCosto !== undefined && <p>Moneda del costo: {c.comercial.monedaCosto}.</p>}
        </>
      )}
    </Seccion>
  );
}

/** `plantillaRecibo` la aporta el compositor solo si el módulo de recibos está encendido; sin ella no hay pestaña. */
export function PantallaConfiguracion({ sub, plantillaRecibo: PestanaRecibo }: { sub: string; plantillaRecibo?: () => JSX.Element }): JSX.Element {
  const actual = sub === 'recibo' && PestanaRecibo !== undefined ? 'recibo' : 'negocio';
  const items = PestanaRecibo === undefined ? [{ id: 'negocio', titulo: 'Negocio y POS' }] : [{ id: 'negocio', titulo: 'Negocio y POS' }, { id: 'recibo', titulo: 'Plantilla del recibo' }];
  return (
    <div>
      <h1>Configuración</h1>
      <Pestanas etiqueta="Configuración" base="configuracion" actual={actual} items={items} />
      {actual === 'negocio' || PestanaRecibo === undefined ? (
        <>
          <DatosDelNegocio />
          <ConfigPosForm />
          <MercadosYMonedas />
        </>
      ) : (
        <PestanaRecibo />
      )}
    </div>
  );
}
