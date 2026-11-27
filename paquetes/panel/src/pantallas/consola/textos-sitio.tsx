import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { Alerta, Area, Boton, Campo, Casilla, ConCarga, Seccion } from '../../ui/comun.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { mover } from './caracteristicas-vista.js';
import {
  aEstado, aNegocio, iguales, LARGO_MAXIMO_MAPA, LIMITES_DATOS, revisarTextos, TOPES_TEXTOS, type BloqueEditable, type EstadoTextos, type MensajeEditable, type NegocioCrudo,
} from './textos-sitio-logica.js';

/** Lectura de `sitio/negocio` (`leerNegocioSitio`) y guardado con control de versión (`guardarNegocioSitio`, solo adm). */
export interface ServicioTextos {
  leer(): Promise<{ readonly negocio: NegocioCrudo | null; readonly version: number; readonly invalido?: readonly string[] }>;
  guardar(negocio: NegocioCrudo, versionEsperada: number): Promise<{ readonly version: number }>;
}

interface Cargado { readonly negocio: NegocioCrudo | null; readonly version: number; readonly invalido: boolean }

function Formulario({ servicio, inicial, recargar }: { servicio: ServicioTextos; inicial: Cargado; recargar: () => void }): JSX.Element {
  const [base, setBase] = useState<{ estado: EstadoTextos; negocio: NegocioCrudo | null; version: number }>({ estado: aEstado(inicial.negocio), negocio: inicial.negocio, version: inicial.version });
  const [e, setE] = useState<EstadoTextos>(base.estado);
  const [intento, setIntento] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const accion = useAccion();
  const formulario = useRef<HTMLFormElement>(null);
  const errores = intento ? revisarTextos(e, base.estado) : {};
  const sucio = !iguales(e, base.estado);
  const cambiar = (c: Partial<EstadoTextos>): void => { setGuardado(false); setE({ ...e, ...c }); };
  const bloque = (i: number, c: Partial<BloqueEditable>): void => cambiar({ nosotros: e.nosotros.map((b, j) => (j === i ? { ...b, ...c } : b)) });
  const msg = (i: number, c: Partial<MensajeEditable>): void => cambiar({ mensajes: e.mensajes.map((m, j) => (j === i ? { ...m, ...c } : m)) });

  const guardar = (): void => {
    setIntento(true);
    if (Object.keys(revisarTextos(e, base.estado)).length > 0) {
      // Lleva el foco al primer campo con error, para quien usa lector de pantalla o teclado.
      setTimeout(() => formulario.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    // Sin datos del negocio guardados no hay sobre qué escribir: el resto de los datos los carga la persona que implementa el sitio.
    if (base.negocio === null) return;
    const negocio = base.negocio;
    void accion.ejecutar(async () => {
      const r = await servicio.guardar(aNegocio(negocio, e), base.version);
      setBase({ estado: e, negocio: aNegocio(negocio, e), version: r.version });
      setGuardado(true);
      setIntento(false);
    });
  };

  if (base.negocio === null) {
    return (
      <Alerta tipo="info">
        {inicial.invalido
          ? 'Los datos generales del sitio guardados tienen un error y no se pueden editar desde aquí. Pida ayuda a quien administra el sitio.'
          : 'Todavía no hay datos generales del sitio guardados, así que no hay dónde escribir estos textos. Pida que los carguen primero.'}
      </Alerta>
    );
  }

  return (
    <form ref={formulario} class="ficha-formulario" onSubmit={(ev) => { ev.preventDefault(); guardar(); }} noValidate>
      <p class="texto-suave">El nombre y la dirección son obligatorios. Los demás textos son opcionales: si deja uno vacío, esa parte no aparece en el sitio.</p>
      <section class="ficha-bloque" aria-labelledby="textos-datos">
        <h3 id="textos-datos">Datos de la tienda</h3>
        <Campo etiqueta="Nombre de la tienda" valor={e.nombre} tope={LIMITES_DATOS.nombre.max} ayuda="Así se llama su tienda en la página. Ejemplo: Tienda Ejemplo." error={errores['nombre']} onInput={(v) => cambiar({ nombre: v })} />
        <Campo etiqueta="Lema" valor={e.lema} tope={LIMITES_DATOS.lema.max} ayuda="Una frase corta que acompaña al nombre. Ejemplo: Todo para su hogar. Si lo deja vacío, no se muestra." error={errores['lema']} onInput={(v) => cambiar({ lema: v })} />
        <Campo etiqueta="Dirección" valor={e.direccion} tope={LIMITES_DATOS.direccion.max} ayuda="Así la verán sus clientes en el pie de la página. Ejemplo: Av. Principal 123, zona Centro." error={errores['direccion']} onInput={(v) => cambiar({ direccion: v })} />
        <Campo etiqueta="Horario de atención" valor={e.horario} tope={LIMITES_DATOS.horario.max} ayuda="Escriba los días y horas en que atiende. Ejemplo: Lunes a sábado, de 9:00 a 19:00. Si lo deja vacío, no se muestra." error={errores['horario']} onInput={(v) => cambiar({ horario: v })} />
        <Campo etiqueta="Teléfono" valor={e.telefono} tope={LIMITES_DATOS.telefono.max} ayuda="El número para llamar a la tienda, con código de país si quiere. Ejemplo: +591 2 2123456. Si lo deja vacío, no se muestra." error={errores['telefono']} onInput={(v) => cambiar({ telefono: v })} />
        <Campo etiqueta="Correo" valor={e.correo} tope={LIMITES_DATOS.correo.max} ayuda="Ejemplo: ventas@sutienda.com. Si lo deja vacío, no se muestra." error={errores['correo']} onInput={(v) => cambiar({ correo: v })} />
      </section>
      <section class="ficha-bloque" aria-labelledby="textos-mapa">
        <h3 id="textos-mapa">Cómo llegar</h3>
        <Campo etiqueta="Enlace de Google Maps" valor={e.mapa} tope={LARGO_MAXIMO_MAPA} ayuda="Abra su tienda en Google Maps, toque «Compartir» y copie el enlace aquí. Si lo deja vacío, el sitio no muestra «Cómo llegar»." error={errores['mapa']} onInput={(v) => cambiar({ mapa: v })} />
      </section>

      <section class="ficha-bloque" aria-labelledby="textos-mision">
        <h3 id="textos-mision">Misión y visión</h3>
        <Area etiqueta="Misión" valor={e.mision} filas={4} tope={TOPES_TEXTOS.texto} error={errores['mision']} onInput={(v) => cambiar({ mision: v })} />
        <Area etiqueta="Visión" valor={e.vision} filas={4} tope={TOPES_TEXTOS.texto} error={errores['vision']} onInput={(v) => cambiar({ vision: v })} />
      </section>

      <fieldset class="ficha-bloque">
        <legend>Sobre nosotros, envíos y garantías</legend>
        <p class="texto-suave">Aparece en la sección Nosotros de la página. Cada renglón es un párrafo.</p>
        {errores['nosotros'] !== undefined && <p role="alert">{errores['nosotros']}</p>}
        <ol class="ficha-medios">
          {e.nosotros.map((b, i) => (
            <li key={i} class="ficha-medio">
              <Campo etiqueta="Título" valor={b.titulo} tope={TOPES_TEXTOS.tituloBloque} ayuda="Ejemplo: Envíos." error={errores[`nosotros.${String(i)}.titulo`]} onInput={(v) => bloque(i, { titulo: v })} />
              <Area etiqueta="Texto" valor={b.texto} filas={4} error={errores[`nosotros.${String(i)}.texto`]} onInput={(v) => bloque(i, { texto: v })} />
              <div class="ficha-zona-botones">
                <Boton chico variante="secundario" onClick={() => cambiar({ nosotros: e.nosotros.filter((_, j) => j !== i) })}>Quitar</Boton>
              </div>
            </li>
          ))}
        </ol>
        <Boton variante="secundario" deshabilitado={e.nosotros.length >= TOPES_TEXTOS.bloquesNosotros} onClick={() => cambiar({ nosotros: [...e.nosotros, { titulo: '', texto: '' }] })}>Agregar bloque</Boton>
        {e.nosotros.length >= TOPES_TEXTOS.bloquesNosotros && <p class="texto-suave">Llegó al máximo de {TOPES_TEXTOS.bloquesNosotros} bloques.</p>}
      </fieldset>

      <section class="ficha-bloque" aria-labelledby="textos-cifra">
        <h3 id="textos-cifra">Cifra de clientes</h3>
        <Campo etiqueta="Cifra" valor={e.cifraValor} tope={TOPES_TEXTOS.cifraValor} ayuda="Por ejemplo: Más de 500 clientes." error={errores['cifraValor']} onInput={(v) => cambiar({ cifraValor: v })} />
        <Campo etiqueta="Detalle de la cifra" valor={e.cifraDetalle} tope={TOPES_TEXTOS.cifraDetalle} ayuda="Por ejemplo: familias atendidas desde 2015." error={errores['cifraDetalle']} onInput={(v) => cambiar({ cifraDetalle: v })} />
        <Casilla etiqueta="Confirmo que la cifra es real" marcado={e.cifraConfirmada} onCambio={(v) => cambiar({ cifraConfirmada: v })} />
        <p class="texto-suave">El sitio solo muestra la cifra si está confirmada.</p>
      </section>

      <fieldset class="ficha-bloque">
        <legend>Ejemplo de conversación de WhatsApp</legend>
        <p class="texto-suave">Hasta {TOPES_TEXTOS.mensajes} mensajes de ejemplo entre un cliente y el comercio. Se muestran en este orden.</p>
        {errores['mensajes'] !== undefined && <p role="alert">{errores['mensajes']}</p>}
        <ol class="ficha-medios">
          {e.mensajes.map((m, i) => (
            <li key={i} class="ficha-medio">
              <div class="campo">
                <label for={`chat-de-${String(i)}`}>Quién escribe el mensaje {i + 1}</label>
                <select id={`chat-de-${String(i)}`} value={m.de} onChange={(ev) => msg(i, { de: ev.currentTarget.value === 'comercio' ? 'comercio' : 'cliente' })}>
                  <option value="cliente">El cliente</option>
                  <option value="comercio">El comercio</option>
                </select>
              </div>
              <Area etiqueta={`Texto del mensaje ${String(i + 1)}`} valor={m.texto} filas={2} tope={TOPES_TEXTOS.mensaje} error={errores[`mensaje.${String(i)}`]} onInput={(v) => msg(i, { texto: v })} />
              <div class="ficha-zona-botones">
                <Boton chico variante="secundario" deshabilitado={i === 0} onClick={() => cambiar({ mensajes: mover(e.mensajes, i, i - 1) })}>Subir el mensaje {i + 1}</Boton>
                <Boton chico variante="secundario" deshabilitado={i === e.mensajes.length - 1} onClick={() => cambiar({ mensajes: mover(e.mensajes, i, i + 1) })}>Bajar el mensaje {i + 1}</Boton>
                <Boton chico variante="secundario" onClick={() => cambiar({ mensajes: e.mensajes.filter((_, j) => j !== i) })}>Quitar el mensaje {i + 1}</Boton>
              </div>
            </li>
          ))}
        </ol>
        <Boton variante="secundario" deshabilitado={e.mensajes.length >= TOPES_TEXTOS.mensajes} onClick={() => cambiar({ mensajes: [...e.mensajes, { de: e.mensajes.at(-1)?.de === 'cliente' ? 'comercio' : 'cliente', texto: '' }] })}>Agregar un mensaje</Boton>
        {e.mensajes.length >= TOPES_TEXTOS.mensajes && <p class="texto-suave">Llegó al máximo de {TOPES_TEXTOS.mensajes} mensajes.</p>}
      </fieldset>

      {accion.error !== null && (
        <Alerta>
          <span>{accion.error}</span>
          <Boton chico variante="secundario" onClick={recargar}>Volver a cargar</Boton>
        </Alerta>
      )}
      {guardado && <Alerta tipo="ok">Guardado. Falta publicar el sitio para que los cambios se vean.</Alerta>}
      <div>
        <Boton tipo="submit" ocupado={accion.ocupado} deshabilitado={!sucio}>Guardar textos del sitio</Boton>
        <p class="texto-suave">Lo guardado se ve en la página después de pulsar Publicar; tarda unos minutos.</p>
      </div>
    </form>
  );
}

/** Pestaña «Textos del sitio» de «Catálogo y sitio» (solo administrador). */
export function PantallaTextosSitio({ servicio }: { servicio: ServicioTextos }): JSX.Element {
  const carga = useCarga<Cargado>(async () => {
    const r = await servicio.leer();
    return { negocio: r.negocio, version: r.version, invalido: (r.invalido?.length ?? 0) > 0 };
  }, []);
  return (
    <Seccion titulo="Textos del sitio">
      <ConCarga carga={carga}>{(d) => <Formulario key={d.version} servicio={servicio} inicial={d} recargar={carga.recargar} />}</ConCarga>
    </Seccion>
  );
}
