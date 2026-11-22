import type { JSX } from 'preact';
import { Boton, Campo } from '../../ui/comun.js';
import { claveViñeta, TOPES_FICHA } from './ficha-revision.js';

/** Viñetas que viajan al servidor: recortadas, sin filas vacías; sin ninguna, la clave se omite (el sitio no pinta la pieza). */
export function viñetasParaEnviar(v: readonly string[] | undefined): { caracteristicas?: string[] } {
  const llenas = (v ?? []).map((t) => t.trim()).filter((t) => t !== '');
  return llenas.length === 0 ? {} : { caracteristicas: llenas };
}

/** Mueve el elemento `de` a la posición `a` (fuera de rango: sin cambio). */
export function mover<T>(l: readonly T[], de: number, a: number): T[] {
  const c = [...l];
  if (de < 0 || a < 0 || de >= c.length || a >= c.length) return c;
  const [x] = c.splice(de, 1);
  c.splice(a, 0, x as T);
  return c;
}

interface Props {
  readonly valor: readonly string[];
  readonly errores: Readonly<Record<string, string>>;
  readonly onCambio: (v: string[]) => void;
}

/** «Características destacadas»: hasta 8 viñetas que el sitio muestra en la página del producto; se agregan, quitan y reordenan. */
export function ListaViñetas({ valor, errores, onCambio }: Props): JSX.Element {
  const tope = TOPES_FICHA.caracteristicas;
  return (
    <fieldset class="ficha-bloque">
      <legend>Características destacadas</legend>
      <p class="texto-suave">Frases cortas que el sitio muestra como lista en la página del producto. Hasta {tope}. Si no agrega ninguna, esa lista no aparece.</p>
      {errores['caracteristicas'] !== undefined && <p role="alert">{errores['caracteristicas']}</p>}
      <ol class="ficha-medios">
        {valor.map((t, i) => (
          <li key={i} class="ficha-medio">
            <Campo
              etiqueta={`Característica ${String(i + 1)}`} valor={t} tope={TOPES_FICHA.caracteristica} error={errores[claveViñeta(i)]}
              onInput={(v) => onCambio(valor.map((x, j) => (j === i ? v : x)))}
            />
            <div class="ficha-zona-botones">
              <Boton chico variante="secundario" deshabilitado={i === 0} onClick={() => onCambio(mover(valor, i, i - 1))}>Subir la característica {i + 1}</Boton>
              <Boton chico variante="secundario" deshabilitado={i === valor.length - 1} onClick={() => onCambio(mover(valor, i, i + 1))}>Bajar la característica {i + 1}</Boton>
              <Boton chico variante="secundario" onClick={() => onCambio(valor.filter((_, j) => j !== i))}>Quitar la característica {i + 1}</Boton>
            </div>
          </li>
        ))}
      </ol>
      <Boton variante="secundario" deshabilitado={valor.length >= tope} onClick={() => onCambio([...valor, ''])}>Agregar una característica</Boton>
      {valor.length >= tope && <p class="texto-suave">Llegó al máximo de {tope} características.</p>}
    </fieldset>
  );
}
