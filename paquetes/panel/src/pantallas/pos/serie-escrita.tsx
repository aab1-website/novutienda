import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { UbicacionId, UnidadSerie } from '../../api/tipos.js';
import { mensajeDeError } from '../../api/errores.js';
import { Boton } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';

/** Por qué una unidad hallada no se puede vender aquí; `null` si sirve. Nunca nombra otras unidades ni cantidades. */
export function motivoSerieNoVendible(u: UnidadSerie | undefined, productoId: string, almacenId: UbicacionId, yaEnVenta: readonly string[]): string | null {
  if (u === undefined) return 'Esa serie no existe.';
  if (u.productoId !== productoId) return 'Esa serie es de otro producto.';
  if (u.estado === 'vendida') return 'Esa serie ya fue vendida.';
  if (u.estado !== 'disponible') return 'Esa serie no está disponible.';
  if (u.ubicacionId !== almacenId) return 'Esa serie es de otro almacén.';
  if (yaEnVenta.includes(u.serie)) return 'Esa serie ya está en la venta.';
  return null;
}

interface Props {
  readonly productoId: string;
  readonly almacenId: UbicacionId;
  readonly elegidas: string[];
  readonly alCambiar: (series: string[]) => void;
}

/**
 * Alta de series por escáner o teclado, para el almacén en conteo (donde no se lista lo disponible: su número sería el stock).
 * Texto + Enter agrega; valida una a una con `buscarSerie` y el campo conserva el foco para la siguiente lectura.
 */
export function SerieEscrita({ productoId, almacenId, elegidas, alCambiar }: Props): JSX.Element {
  const { api } = useApp();
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const entrada = useRef<HTMLInputElement>(null);
  // Lecturas pendientes y bloqueo en refs: el estado de Preact no se actualiza entre dos Enter seguidos del lector.
  const cola = useRef<string[]>([]);
  const ocupado = useRef(false);
  const acumuladas = useRef<string[]>([...elegidas]);
  acumuladas.current = ocupado.current ? acumuladas.current : [...elegidas];
  const idCampo = `serie-escrita-${productoId}`;

  const validar = async (serie: string): Promise<void> => {
    try {
      const halladas = await api.llamar('buscarSerie', { serie });
      // El servidor compara la serie exacta: sin normalizar mayúsculas; el producto se filtra aquí porque la búsqueda no lo admite.
      const exacta = halladas.find((u) => u.serie === serie && u.productoId === productoId) ?? halladas.find((u) => u.serie === serie);
      const motivo = motivoSerieNoVendible(exacta, productoId, almacenId, acumuladas.current);
      if (motivo !== null || exacta === undefined) {
        setError(motivo ?? 'Esa serie no existe.');
      } else {
        setError('');
        acumuladas.current = [...acumuladas.current, exacta.serie];
        alCambiar(acumuladas.current);
      }
    } catch (x) {
      setError(mensajeDeError(x));
    }
  };

  const agregar = async (): Promise<void> => {
    const serie = texto.replace(/[\r\n]+/g, '').trim();
    if (serie === '') return;
    setTexto('');
    if (entrada.current) entrada.current.value = '';
    cola.current.push(serie);
    if (ocupado.current) return;
    ocupado.current = true;
    try {
      for (let siguiente = cola.current.shift(); siguiente !== undefined; siguiente = cola.current.shift()) await validar(siguiente);
    } finally {
      ocupado.current = false;
      entrada.current?.focus();
    }
  };

  return (
    <div class="series series-escritas">
      <div class="campo">
        <label for={idCampo}>Serie de la unidad</label>
        <input
          id={idCampo}
          ref={entrada}
          type="text"
          autocomplete="off"
          value={texto}
          aria-invalid={error === '' ? undefined : 'true'}
          aria-describedby={error === '' ? undefined : `${idCampo}-error`}
          onInput={(e) => {
            setTexto((e.currentTarget as HTMLInputElement).value);
            if (error !== '') setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void agregar();
            }
          }}
        />
        <p class="texto-suave">Escanee o escriba la serie y pulse Enter.</p>
        {error !== '' && (
          <p id={`${idCampo}-error`} class="texto-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {elegidas.length > 0 && (
        <ul class="lista-simple">
          {elegidas.map((s) => (
            <li key={s} class="fila fila-alinear">
              <span>{s}</span>
              <Boton chico variante="peligro" etiqueta={`Quitar serie ${s}`} onClick={() => alCambiar(elegidas.filter((x) => x !== s))}>
                Quitar
              </Boton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
