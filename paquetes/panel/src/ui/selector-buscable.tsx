import type { JSX } from 'preact';
import { useId, useState } from 'preact/hooks';
import { normalizar } from '../util/buscar.js';
import '../estilos/selector.css';

export interface OpcionBuscable {
  readonly valor: string;
  readonly texto: string;
  readonly detalle?: string | undefined;
}

export interface PropsSelectorBuscable {
  readonly etiqueta: string;
  readonly opciones: readonly OpcionBuscable[];
  /** `null` = nada elegido: no hay valor por omisión. */
  readonly valor: string | null;
  readonly onCambio: (valor: string) => void;
  readonly requerido?: boolean | undefined;
  readonly ayuda?: string | undefined;
  readonly error?: string | undefined;
  readonly maxResultados?: number | undefined;
}

/** Combobox con lista (patrón APG): se escribe para acotar, ↑ ↓ Inicio Fin recorren, Enter elige, Esc cierra la lista. */
export function SelectorBuscable(p: PropsSelectorBuscable): JSX.Element {
  const id = useId();
  const max = p.maxResultados ?? 50;
  const [abierta, setAbierta] = useState(false);
  const [consulta, setConsulta] = useState<string | null>(null);
  const [activo, setActivo] = useState(0);

  const elegida = p.opciones.find((o) => o.valor === p.valor);
  const q = normalizar(consulta ?? '');
  const coinciden = q === '' ? p.opciones : p.opciones.filter((o) => normalizar(`${o.texto} ${o.detalle ?? ''}`).includes(q));
  const mostradas = coinciden.slice(0, max);
  const restantes = coinciden.length - mostradas.length;
  const idOpcion = (i: number): string => `${id}-op-${i}`;
  const idAyuda = `${id}-ayuda`;
  const idError = `${id}-error`;
  const descrito = [p.ayuda ? idAyuda : '', p.error ? idError : ''].filter((x) => x !== '').join(' ');

  const cerrar = (): void => {
    setAbierta(false);
    setConsulta(null);
  };
  const elegir = (o: OpcionBuscable): void => {
    p.onCambio(o.valor);
    cerrar();
  };
  const abrir = (): void => {
    setAbierta(true);
    setActivo(0);
  };

  const teclado = (e: KeyboardEvent): void => {
    const ultimo = mostradas.length - 1;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!abierta) abrir();
        else setActivo(Math.min(activo + 1, ultimo));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!abierta) abrir();
        else setActivo(Math.max(activo - 1, 0));
        break;
      case 'Home':
        if (abierta) {
          e.preventDefault();
          setActivo(0);
        }
        break;
      case 'End':
        if (abierta) {
          e.preventDefault();
          setActivo(Math.max(ultimo, 0));
        }
        break;
      case 'Enter':
        if (abierta) {
          e.preventDefault();
          const o = mostradas[activo];
          if (o) elegir(o);
        }
        break;
      case 'Escape':
        if (abierta) {
          e.preventDefault();
          e.stopPropagation();
          cerrar();
        }
        break;
      default:
    }
  };

  return (
    <div class="campo selector-buscable">
      <label for={`${id}-in`}>
        {p.etiqueta}
        {p.requerido && <span class="obligatorio"> (obligatorio)</span>}
      </label>
      <input
        id={`${id}-in`}
        type="text"
        role="combobox"
        autocomplete="off"
        aria-expanded={abierta}
        aria-controls={`${id}-lista`}
        aria-autocomplete="list"
        aria-activedescendant={abierta && mostradas.length > 0 ? idOpcion(Math.min(activo, mostradas.length - 1)) : undefined}
        aria-required={p.requerido ? true : undefined}
        aria-invalid={p.error ? true : undefined}
        aria-describedby={descrito === '' ? undefined : descrito}
        value={consulta ?? elegida?.texto ?? ''}
        onInput={(e) => {
          setConsulta((e.currentTarget as HTMLInputElement).value);
          setAbierta(true);
          setActivo(0);
        }}
        onKeyDown={teclado}
        onBlur={cerrar}
      />
      {abierta && (
        <div class="selector-lista" onMouseDown={(e) => e.preventDefault()}>
          <ul id={`${id}-lista`} role="listbox" aria-label={p.etiqueta} class="selector-opciones">
            {mostradas.map((o, i) => (
              <li key={o.valor} id={idOpcion(i)} role="option" aria-selected={i === activo} class="selector-opcion" onClick={() => elegir(o)}>
                <span>{o.texto}</span>
                {o.detalle && <small>{o.detalle}</small>}
              </li>
            ))}
          </ul>
          {mostradas.length === 0 && <p class="selector-nota" role="status">Sin resultados</p>}
          {restantes > 0 && <p class="selector-nota" role="status">{`Hay ${restantes} más; escriba para acotar`}</p>}
        </div>
      )}
      {p.ayuda && <p id={idAyuda} class="ayuda">{p.ayuda}</p>}
      {p.error && <p id={idError} class="selector-error" role="alert">{p.error}</p>}
    </div>
  );
}
