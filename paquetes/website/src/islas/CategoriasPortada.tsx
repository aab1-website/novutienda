import { useEffect, useState } from 'preact/hooks';
import { anuncioPortada, TOPE_PORTADA, totalPortada, visiblesPortada, type ItemPortada } from '../lib/portada.js';

interface Props {
  categorias: readonly { id: string; nombre: string; href: string }[];
  /** Todos los productos a la venta (id y categoría, con los destacados primero y luego el orden del catálogo): la grilla del HTML trae su parte. */
  items: readonly ItemPortada[];
  tope?: number;
}

/**
 * Chips de categoría de la portada. Sin JavaScript son enlaces a `/productos/<categoría>` y la grilla muestra las primeras tarjetas;
 * con JavaScript, tocar un chip filtra la grilla ahí mismo (muestra u oculta las tarjetas ya escritas) sin cambiar de página.
 * Un clic con Ctrl, Mayús o botón central conserva el comportamiento de enlace.
 */
export default function CategoriasPortada({ categorias, items, tope = TOPE_PORTADA }: Props) {
  const [elegida, setElegida] = useState<string | null>(null);
  // Solo se anuncia tras tocar un chip, no al cargar la página.
  const [cambio, setCambio] = useState(false);

  useEffect(() => {
    const visibles = visiblesPortada(items, elegida, tope);
    for (const el of document.querySelectorAll<HTMLElement>('#portada-grilla [data-portada-id]')) el.hidden = !visibles.has(el.dataset['portadaId'] ?? '');
    // El enlace «Ver todos» de debajo de la grilla (ya escrito en el HTML) sigue a la selección.
    const enlace = document.getElementById('portada-ver-todos');
    const c = categorias.find((x) => x.id === elegida);
    if (enlace !== null) {
      enlace.setAttribute('href', c?.href ?? '/productos');
      enlace.textContent = `${c === undefined ? 'Ver todos los productos' : `Ver todos de ${c.nombre}`} (${totalPortada(items, elegida)})`;
    }
  }, [elegida, items, tope, categorias]);

  const anuncio = anuncioPortada(categorias.find((c) => c.id === elegida)?.nombre ?? null, totalPortada(items, elegida));
  const elegir = (e: MouseEvent, id: string | null): void => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setElegida(id);
    setCambio(true);
  };
  return (
    <>
      <nav class="portada-chips" aria-label="Categorías de productos">
        <ul>
          <li><a class="chip" href="/productos" aria-current={elegida === null ? 'true' : undefined} onClick={(e) => elegir(e, null)}>Todos</a></li>
          {categorias.map((c) => (
            <li key={c.id}><a class="chip" href={c.href} aria-current={elegida === c.id ? 'true' : undefined} onClick={(e) => elegir(e, c.id)}>{c.nombre}</a></li>
          ))}
        </ul>
      </nav>
      <p class="solo-lectores" role="status" aria-live="polite">{cambio ? anuncio : ''}</p>
    </>
  );
}
