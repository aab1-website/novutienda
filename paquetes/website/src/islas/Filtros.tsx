import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Mercado, Redondeo } from '@novutienda/nucleo';
import { filtrarProductos } from '../contenido/consultas.js';
import { parsearMonto } from '../lib/dinero.js';
import { monedaDe } from '../lib/mercado.js';
import { avisoDeFiltro } from '../lib/paginas.js';
import { precioLocal } from '../lib/precio-vista.js';
import { useCotizacion, useMercado } from './estado.js';

interface ProductoFiltrable {
  id: string;
  marca: string;
  usd: Readonly<Record<Mercado, number>>;
}

interface Props {
  productos: readonly ProductoFiltrable[];
  /** Cada marca lleva a su página estática. */
  marcas: readonly { nombre: string; href: string }[];
  /** Marca de la página actual, si es la página de una marca. */
  marcaActual?: string;
  /** Página mostrada y total de páginas de esta lista: el precio filtra solo los productos de la página visible. */
  pagina?: number;
  totalPaginas?: number;
  inicial: Mercado;
  mercados: readonly Mercado[];
  redondeo: Redondeo;
}

/**
 * Marcas (enlaces a su página) y filtro por precio. Las tarjetas de la página ya vienen en el HTML (sin JavaScript se ven todas);
 * esta isla solo oculta las que no cumplen el precio. El precio se filtra en la moneda del país elegido.
 */
export default function Filtros({ productos, marcas, marcaActual, pagina = 1, totalPaginas = 1, inicial, mercados, redondeo }: Props) {
  const [mercado] = useMercado(inicial, mercados);
  const cot = useCotizacion(mercado);
  const [minimo, setMinimo] = useState('');
  const [maximo, setMaximo] = useState('');

  const min = minimo.trim() === '' ? null : parsearMonto(minimo);
  const max = maximo.trim() === '' ? null : parsearMonto(maximo);
  const invalido = (minimo.trim() !== '' && min === null) || (maximo.trim() !== '' && max === null);

  const visibles = useMemo(
    () => new Set(filtrarProductos(productos, { marcas: [], minimo: invalido ? null : min, maximo: invalido ? null : max }, (p) => precioLocal(p.usd[mercado], mercado, cot, redondeo)).map((p) => p.id)),
    [productos, min, max, invalido, mercado, cot, redondeo],
  );

  useEffect(() => {
    for (const p of productos) {
      const el = document.querySelector<HTMLElement>(`[data-producto-id="${p.id}"]`);
      if (el !== null) el.hidden = !visibles.has(p.id);
    }
  }, [visibles, productos]);

  const hayFiltro = minimo !== '' || maximo !== '';
  return (
    <form class="filtros" aria-label="Filtros del catálogo" onSubmit={(e) => e.preventDefault()}>
      {marcas.length > 1 && (
        <nav class="filtro-marcas" aria-label="Marcas">
          <p class="filtros-titulo">Marca</p>
          <ul>
            {marcas.map((m) => (
              <li key={m.nombre}><a href={m.href} aria-current={marcaActual === m.nombre ? 'page' : undefined}>{m.nombre}</a></li>
            ))}
          </ul>
        </nav>
      )}
      <fieldset>
        <legend>Precio ({monedaDe(mercado)})</legend>
        <label class="campo-corto">Desde <input inputMode="decimal" value={minimo} aria-invalid={min === null && minimo.trim() !== ''} onInput={(e) => setMinimo((e.target as HTMLInputElement).value)} /></label>
        <label class="campo-corto">Hasta <input inputMode="decimal" value={maximo} aria-invalid={max === null && maximo.trim() !== ''} onInput={(e) => setMaximo((e.target as HTMLInputElement).value)} /></label>
      </fieldset>
      <p class="aviso-estado" role="status">
        {invalido ? 'Escribe solo números en el precio.' : avisoDeFiltro(visibles.size, productos.length, pagina, totalPaginas)}
        {(minimo.trim() !== '' || maximo.trim() !== '') && ' Los productos «a consultar» no tienen precio y se ocultan al filtrar por precio.'}
      </p>
      {hayFiltro && <button type="button" class="enlace-boton" onClick={() => { setMinimo(''); setMaximo(''); }}>Limpiar filtros</button>}
    </form>
  );
}
