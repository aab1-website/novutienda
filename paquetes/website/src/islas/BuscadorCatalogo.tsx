import { useEffect, useRef, useState } from 'preact/hooks';
import { buscarProductos } from '../contenido/consultas.js';

interface EntradaIndice {
  readonly i: string;
  readonly nombre: string;
  readonly categoria: string;
  readonly marca: string;
  readonly ruta: string;
}

const MAX_RESULTADOS = 12;

/**
 * Campo «Buscar en el catálogo»: busca en todo el catálogo (el índice estático del sitio, el mismo del buscador de la
 * cabecera), no solo en las tarjetas de la página visible. El índice se descarga la primera vez que se escribe.
 */
export default function BuscadorCatalogo({ indice = '/indice-productos.json' }: { indice?: string }) {
  const [consulta, setConsulta] = useState('');
  const [entradas, setEntradas] = useState<readonly EntradaIndice[] | null>(null);
  const [fallo, setFallo] = useState(false);
  const pedido = useRef(false);

  const hayConsulta = consulta.trim() !== '';
  useEffect(() => {
    if (!hayConsulta || pedido.current) return;
    pedido.current = true;
    setFallo(false);
    fetch(indice, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('indice'))))
      .then((j: readonly EntradaIndice[]) => setEntradas(j))
      .catch(() => {
        pedido.current = false;
        setFallo(true);
      });
  }, [hayConsulta, indice]);

  const resultados = entradas === null ? [] : buscarProductos(entradas, consulta, MAX_RESULTADOS);
  return (
    <section class="buscador-catalogo" aria-label="Buscar en el catálogo">
      <label class="campo-buscar">
        <span class="campo-etiqueta">Buscar en el catálogo</span>
        <input type="search" value={consulta} placeholder="Nombre, marca o categoría" autocomplete="off" onInput={(e) => setConsulta((e.target as HTMLInputElement).value)} />
      </label>
      <div aria-live="polite">
        {fallo && <p class="aviso-estado">No pudimos cargar la búsqueda. Revisa tu conexión e inténtalo de nuevo.</p>}
        {hayConsulta && entradas !== null && resultados.length === 0 && <p class="aviso-estado">No encontramos productos para esa búsqueda.</p>}
        {resultados.length > 0 && (
          <ul class="resultados">
            {resultados.map((r) => (
              <li key={r.i}>
                <a href={r.ruta}>
                  <strong>{r.nombre}</strong>
                  <span>{r.marca} · {r.categoria}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
