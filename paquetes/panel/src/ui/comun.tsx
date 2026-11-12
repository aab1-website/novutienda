import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { Dialogo } from './dialogo.js';
import { contadorAnunciable, textoContador } from './formulario.js';
import type { Carga } from './hooks.js';

export function Alerta({ tipo = 'error', children }: { tipo?: 'error' | 'ok' | 'info'; children: ComponentChildren }): JSX.Element {
  return (
    <div class={`alerta alerta-${tipo}`} role={tipo === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function ErrorCarga({ error, reintentar }: { error: string; reintentar?: () => void }): JSX.Element {
  return (
    <Alerta>
      <span>{error}</span>
      {reintentar && (
        <button type="button" class="boton boton-secundario boton-chico" onClick={reintentar}>
          Reintentar
        </button>
      )}
    </Alerta>
  );
}

export function Vacio({ titulo, detalle }: { titulo: string; detalle?: string }): JSX.Element {
  return (
    <div class="vacio">
      <p class="vacio-titulo">{titulo}</p>
      {detalle && <p class="texto-suave">{detalle}</p>}
    </div>
  );
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }): JSX.Element {
  return (
    <p class="texto-suave" role="status">
      {texto}
    </p>
  );
}

interface PropsCampo {
  etiqueta: string;
  valor: string;
  onInput: (v: string) => void;
  tipo?: string | undefined;
  ayuda?: string | undefined;
  /** Error de este campo: texto con prefijo «Error:», `aria-invalid` y enlazado con `aria-describedby`. */
  error?: string | undefined;
  /** Largo máximo: pone `maxLength` y muestra el contador «32 de 70». */
  tope?: number | undefined;
  requerido?: boolean | undefined;
  nombre?: string | undefined;
  autocompletar?: string | undefined;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | undefined;
  deshabilitado?: boolean | undefined;
  maxLength?: number | undefined;
  min?: number | undefined;
  max?: number | undefined;
}

interface PropsPie {
  id: string;
  ayuda?: string | undefined;
  error?: string | undefined;
  largo?: number;
  tope?: number | undefined;
}

/** Ayuda, error y contador bajo un campo. El contador solo se anuncia desde el 90 % del tope. */
function PieDeCampo(p: PropsPie): JSX.Element {
  return (
    <>
      {p.ayuda && (
        <p id={`${p.id}-ayuda`} class="ayuda">
          {p.ayuda}
        </p>
      )}
      {p.error && (
        <p id={`${p.id}-error`} class="campo-error">
          Error: {p.error}
        </p>
      )}
      {p.tope !== undefined && (
        <>
          <p class="contador">{textoContador(p.largo ?? 0, p.tope)}</p>
          <span class="solo-lectores" aria-live="polite">
            {contadorAnunciable(p.largo ?? 0, p.tope) ? `${textoContador(p.largo ?? 0, p.tope)} caracteres` : ''}
          </span>
        </>
      )}
    </>
  );
}

const describe = (id: string, ayuda: string | undefined, error: string | undefined): string | undefined => {
  const ids = [ayuda ? `${id}-ayuda` : '', error ? `${id}-error` : ''].filter((x) => x !== '');
  return ids.length === 0 ? undefined : ids.join(' ');
};

export function Campo(p: PropsCampo): JSX.Element {
  const id = useId();
  return (
    <div class="campo">
      <label for={id}>
        {p.etiqueta}
        {p.requerido && <span class="obligatorio"> (obligatorio)</span>}
      </label>
      <input
        id={id}
        name={p.nombre}
        type={p.tipo ?? 'text'}
        value={p.valor}
        required={p.requerido}
        autocomplete={p.autocompletar}
        inputMode={p.inputMode}
        disabled={p.deshabilitado}
        maxLength={p.tope ?? p.maxLength}
        min={p.min}
        max={p.max}
        aria-invalid={p.error ? 'true' : undefined}
        aria-describedby={describe(id, p.ayuda, p.error)}
        onInput={(e) => p.onInput((e.currentTarget as HTMLInputElement).value)}
      />
      <PieDeCampo id={id} ayuda={p.ayuda} error={p.error} largo={p.valor.length} tope={p.tope} />
    </div>
  );
}

export function Area(p: {
  etiqueta: string;
  valor: string;
  onInput: (v: string) => void;
  filas?: number;
  requerido?: boolean;
  ayuda?: string | undefined;
  error?: string | undefined;
  tope?: number | undefined;
}): JSX.Element {
  const id = useId();
  return (
    <div class="campo">
      <label for={id}>{p.etiqueta}</label>
      <textarea
        id={id}
        rows={p.filas ?? 3}
        value={p.valor}
        required={p.requerido}
        maxLength={p.tope}
        aria-invalid={p.error ? 'true' : undefined}
        aria-describedby={describe(id, p.ayuda, p.error)}
        onInput={(e) => p.onInput((e.currentTarget as HTMLTextAreaElement).value)}
      />
      <PieDeCampo id={id} ayuda={p.ayuda} error={p.error} largo={p.valor.length} tope={p.tope} />
    </div>
  );
}

export interface Opcion {
  valor: string;
  texto: string;
}

export function Selector(p: {
  etiqueta: string;
  valor: string;
  opciones: readonly Opcion[];
  onCambio: (v: string) => void;
  deshabilitado?: boolean;
  ayuda?: string | undefined;
  error?: string | undefined;
}): JSX.Element {
  const id = useId();
  return (
    <div class="campo">
      <label for={id}>{p.etiqueta}</label>
      <select id={id} value={p.valor} disabled={p.deshabilitado} aria-invalid={p.error ? 'true' : undefined} aria-describedby={describe(id, p.ayuda, p.error)} onChange={(e) => p.onCambio((e.currentTarget as HTMLSelectElement).value)}>
        {p.opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
      <PieDeCampo id={id} ayuda={p.ayuda} error={p.error} />
    </div>
  );
}

export function Casilla(p: { etiqueta: string; marcado: boolean; onCambio: (v: boolean) => void; deshabilitado?: boolean }): JSX.Element {
  const id = useId();
  return (
    <div class="casilla">
      <input id={id} type="checkbox" checked={p.marcado} disabled={p.deshabilitado} onChange={(e) => p.onCambio((e.currentTarget as HTMLInputElement).checked)} />
      <label for={id}>{p.etiqueta}</label>
    </div>
  );
}

/**
 * Botón con confirmación: al pulsarlo se abre un diálogo centrado con «Cancelar» y el botón de confirmar (nunca
 * `confirm()`). Si es peligroso, el foco inicial cae en «Cancelar». Al cerrar, el foco vuelve al botón.
 */
export function BotonConfirmado(p: {
  texto: string;
  pregunta: string;
  textoConfirmar?: string | undefined;
  onConfirmar: () => void;
  peligro?: boolean | undefined;
  deshabilitado?: boolean | undefined;
  chico?: boolean | undefined;
  /** Detalle de lo que se va a hacer, bajo la pregunta. */
  resumen?: string | undefined;
}): JSX.Element {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button type="button" class={`boton ${p.peligro ? 'boton-peligro' : 'boton-secundario'} ${p.chico ? 'boton-chico' : ''}`} disabled={p.deshabilitado} aria-haspopup="dialog" onClick={() => setAbierto(true)}>
        {p.texto}
      </button>
      {abierto && (
        <Dialogo
          variante="centro"
          titulo={p.pregunta}
          descripcion={p.resumen}
          foco={p.peligro ? 'seguro' : 'campo'}
          onCerrar={() => setAbierto(false)}
          pie={
            <>
              <button type="button" class="boton boton-secundario" data-seguro onClick={() => setAbierto(false)}>
                Cancelar
              </button>
              <button
                type="button"
                class={`boton ${p.peligro ? 'boton-peligro' : 'boton-cta'}`}
                onClick={() => {
                  setAbierto(false);
                  p.onConfirmar();
                }}
              >
                {p.textoConfirmar ?? 'Confirmar'}
              </button>
            </>
          }
        />
      )}
    </>
  );
}

export function Boton(p: {
  children?: ComponentChildren;
  onClick?: (() => void) | undefined;
  tipo?: 'button' | 'submit' | undefined;
  variante?: 'cta' | 'secundario' | 'peligro' | undefined;
  ocupado?: boolean | undefined;
  deshabilitado?: boolean | undefined;
  chico?: boolean | undefined;
  etiqueta?: string | undefined;
  /** Por qué no se puede usar ahora. El botón sigue enfocable (`aria-disabled`), el motivo se ve al lado y, al pulsarlo, no ejecuta `onClick` sino `onIntento`. */
  motivo?: string | undefined;
  /** `false`: el motivo no se pinta, solo queda como descripción accesible y tooltip (para filas repetidas de una tabla). */
  motivoVisible?: boolean | undefined;
  onIntento?: (() => void) | undefined;
}): JSX.Element {
  const idMotivo = useId();
  const conMotivo = p.motivo !== undefined && p.motivo !== '' && p.ocupado !== true;
  const clase = `boton boton-${p.variante ?? 'cta'} ${p.chico ? 'boton-chico' : ''}`;
  if (!conMotivo) {
    return (
      <button type={p.tipo ?? 'button'} class={clase} disabled={p.ocupado === true || p.deshabilitado === true} aria-busy={p.ocupado} aria-label={p.etiqueta} onClick={p.onClick}>
        {p.ocupado ? 'Procesando…' : p.children}
      </button>
    );
  }
  return (
    <span class="boton-con-motivo">
      <button
        type={p.tipo ?? 'button'}
        class={clase}
        aria-disabled="true"
        aria-describedby={idMotivo}
        title={p.motivoVisible === false ? p.motivo : undefined}
        aria-label={p.etiqueta}
        onClick={(e) => {
          // Un botón «submit» no debe enviar el formulario mientras tenga motivo.
          e.preventDefault();
          p.onIntento?.();
        }}
      >
        {p.children}
      </button>
      <span id={idMotivo} class={p.motivoVisible === false ? 'solo-lectores' : 'motivo'}>
        {p.motivo}
      </span>
    </span>
  );
}

/**
 * Pinta una carga: «Cargando» si aún no hay datos; el error con «Reintentar» si no los hubo; y, si ya hay datos y una
 * recarga falla, conserva lo que se ve y agrega el aviso «No se pudo actualizar».
 */
export function ConCarga<T>({ carga, children }: { carga: Carga<T>; children: (datos: T) => ComponentChildren }): JSX.Element {
  if (carga.datos === undefined) {
    if (carga.error !== null) return <ErrorCarga error={carga.error} reintentar={carga.recargar} />;
    return <Cargando />;
  }
  return (
    <>
      {carga.error !== null && (
        <Alerta>
          <span>No se pudo actualizar. {carga.error}</span>
          <button type="button" class="boton boton-secundario boton-chico" onClick={carga.recargar}>
            Reintentar
          </button>
        </Alerta>
      )}
      {children(carga.datos)}
    </>
  );
}

export function Pestanas(p: { etiqueta: string; base: string; actual: string; items: readonly { id: string; titulo: string }[] }): JSX.Element {
  const nav = useRef<HTMLElement>(null);
  // Las pestañas se desplazan en horizontal: la activa se acerca a la vista (jsdom no implementa scrollIntoView).
  useEffect(() => {
    const activa = nav.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (typeof activa?.scrollIntoView === 'function') activa.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [p.actual]);
  return (
    <nav ref={nav} class="pestanas" aria-label={p.etiqueta}>
      {p.items.map((i) => (
        <a key={i.id} href={`#/${p.base}/${i.id}`} aria-current={p.actual === i.id ? 'page' : undefined}>
          {i.titulo}
        </a>
      ))}
    </nav>
  );
}

export function Seccion({ titulo, children, acciones }: { titulo: string; children: ComponentChildren; acciones?: ComponentChildren }): JSX.Element {
  return (
    <section class="tarjeta">
      <header class="tarjeta-cabecera">
        <h2>{titulo}</h2>
        {acciones}
      </header>
      {children}
    </section>
  );
}

export function Dato({ etiqueta, children }: { etiqueta: string; children: ComponentChildren }): JSX.Element {
  return (
    <div class="dato">
      <dt>{etiqueta}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Fecha ISO o milisegundos a «04/11/2026 14:30» (hora de La Paz). */
export function fechaHora(v: string | number): string {
  const d = new Date(typeof v === 'number' ? v : Date.parse(v));
  if (Number.isNaN(d.getTime())) return '';
  const s = new Date(d.getTime() - 4 * 3600_000).toISOString();
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}`;
}
