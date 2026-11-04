import type { ComponentChildren, JSX } from 'preact';
import { useId, useState } from 'preact/hooks';

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
  requerido?: boolean | undefined;
  nombre?: string | undefined;
  autocompletar?: string | undefined;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | undefined;
  deshabilitado?: boolean | undefined;
  maxLength?: number | undefined;
  min?: number | undefined;
  max?: number | undefined;
}

export function Campo(p: PropsCampo): JSX.Element {
  const id = useId();
  const idAyuda = `${id}-ayuda`;
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
        maxLength={p.maxLength}
        min={p.min}
        max={p.max}
        aria-describedby={p.ayuda ? idAyuda : undefined}
        onInput={(e) => p.onInput((e.currentTarget as HTMLInputElement).value)}
      />
      {p.ayuda && (
        <p id={idAyuda} class="ayuda">
          {p.ayuda}
        </p>
      )}
    </div>
  );
}

export function Area(p: { etiqueta: string; valor: string; onInput: (v: string) => void; filas?: number; requerido?: boolean }): JSX.Element {
  const id = useId();
  return (
    <div class="campo">
      <label for={id}>{p.etiqueta}</label>
      <textarea id={id} rows={p.filas ?? 3} value={p.valor} required={p.requerido} onInput={(e) => p.onInput((e.currentTarget as HTMLTextAreaElement).value)} />
    </div>
  );
}

export interface Opcion {
  valor: string;
  texto: string;
}

export function Selector(p: { etiqueta: string; valor: string; opciones: readonly Opcion[]; onCambio: (v: string) => void; deshabilitado?: boolean }): JSX.Element {
  const id = useId();
  return (
    <div class="campo">
      <label for={id}>{p.etiqueta}</label>
      <select id={id} value={p.valor} disabled={p.deshabilitado} onChange={(e) => p.onCambio((e.currentTarget as HTMLSelectElement).value)}>
        {p.opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
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
 * Botón con confirmación DENTRO de la página (nunca `confirm()`): al pulsarlo aparece la pregunta con «Confirmar» y
 * «Cancelar».
 */
export function BotonConfirmado(p: {
  texto: string;
  pregunta: string;
  textoConfirmar?: string;
  onConfirmar: () => void;
  peligro?: boolean;
  deshabilitado?: boolean;
  chico?: boolean;
}): JSX.Element {
  const [abierto, setAbierto] = useState(false);
  if (!abierto) {
    return (
      <button type="button" class={`boton ${p.peligro ? 'boton-peligro' : 'boton-secundario'} ${p.chico ? 'boton-chico' : ''}`} disabled={p.deshabilitado} onClick={() => setAbierto(true)}>
        {p.texto}
      </button>
    );
  }
  return (
    <div class="confirmacion" role="group" aria-label="Confirmación">
      <p>{p.pregunta}</p>
      <div class="fila">
        <button
          type="button"
          class={`boton ${p.peligro ? 'boton-peligro' : 'boton-cta'} boton-chico`}
          onClick={() => {
            setAbierto(false);
            p.onConfirmar();
          }}
        >
          {p.textoConfirmar ?? 'Confirmar'}
        </button>
        <button type="button" class="boton boton-secundario boton-chico" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

export function Boton(p: { children: ComponentChildren; onClick?: () => void; tipo?: 'button' | 'submit'; variante?: 'cta' | 'secundario' | 'peligro'; ocupado?: boolean; deshabilitado?: boolean; chico?: boolean; etiqueta?: string }): JSX.Element {
  return (
    <button
      type={p.tipo ?? 'button'}
      class={`boton boton-${p.variante ?? 'cta'} ${p.chico ? 'boton-chico' : ''}`}
      disabled={p.ocupado === true || p.deshabilitado === true}
      aria-busy={p.ocupado}
      aria-label={p.etiqueta}
      onClick={p.onClick}
    >
      {p.ocupado ? 'Procesando…' : p.children}
    </button>
  );
}

export function Pestanas(p: { etiqueta: string; base: string; actual: string; items: readonly { id: string; titulo: string }[] }): JSX.Element {
  return (
    <nav class="pestanas" aria-label={p.etiqueta}>
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
