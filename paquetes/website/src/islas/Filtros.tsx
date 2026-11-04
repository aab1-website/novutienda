import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Mercado, Redondeo } from '@plataforma/nucleo';
import { filtrarProductos } from '../contenido/consultas.js';
import { parsearMonto } from '../lib/dinero.js';
import { monedaDe } from '../lib/mercado.js';
import { precioLocal } from '../lib/precio-vista.js';
import { useCotizacion, useMercado } from './estado.js';

interface ProductoFiltrable {
  id: string;
  marca: string;
  usd: Readonly<Record<Mercado, number>>;
}

interface Props {
  productos: readonly ProductoFiltrable[];
  marcas: readonly string[];
  inicial: Mercado;
  mercados: readonly Mercado[];
  redondeo: Redondeo;
}

/**
 * Filtros por marca y por precio. Las tarjetas ya vienen en el HTML (sin JavaScript se ven todas);
 * esta isla solo oculta las que no cumplen. El precio se filtra en la moneda del país elegido.
 */
export default function Filtros({ productos, marcas, inicial, mercados, redondeo }: Props) {
  const [mercado] = useMercado(inicial, mercados);
  const cot = useCotizacion(mercado);
  const [elegidas, setElegidas] = useState<readonly string[]>([]);
  const [minimo, setMinimo] = useState('');
  const [maximo, setMaximo] = useState('');

  const min = minimo.trim() === '' ? null : parsearMonto(minimo);
  const max = maximo.trim() === '' ? null : parsearMonto(maximo);
  const invalido = (minimo.trim() !== '' && min === null) || (maximo.trim() !== '' && max === null);

  const visibles = useMemo(
    () => new Set(filtrarProductos(productos, { marcas: elegidas, minimo: invalido ? null : min, maximo: invalido ? null : max }, (p) => precioLocal(p.usd[mercado], mercado, cot, redondeo)).map((p) => p.id)),
    [productos, elegidas, min, max, invalido, mercado, cot, redondeo],
  );

  useEffect(() => {
    for (const p of productos) {
      const el = document.querySelector<HTMLElement>(`[data-producto-id="${p.id}"]`);
      if (el !== null) el.hidden = !visibles.has(p.id);
    }
  }, [visibles, productos]);

  const alternar = (m: string): void => setElegidas((e) => (e.includes(m) ? e.filter((x) => x !== m) : [...e, m]));
  const hayFiltro = elegidas.length > 0 || minimo !== '' || maximo !== '';
  return (
    <form class="filtros" aria-label="Filtros del catálogo" onSubmit={(e) => e.preventDefault()}>
      {marcas.length > 1 && (
        <fieldset>
          <legend>Marca</legend>
          {marcas.map((m) => (
            <label key={m} class="casilla"><input type="checkbox" checked={elegidas.includes(m)} onChange={() => alternar(m)} /> {m}</label>
          ))}
        </fieldset>
      )}
      <fieldset>
        <legend>Precio ({monedaDe(mercado)})</legend>
        <label class="campo-corto">Desde <input inputMode="decimal" value={minimo} aria-invalid={min === null && minimo.trim() !== ''} onInput={(e) => setMinimo((e.target as HTMLInputElement).value)} /></label>
        <label class="campo-corto">Hasta <input inputMode="decimal" value={maximo} aria-invalid={max === null && maximo.trim() !== ''} onInput={(e) => setMaximo((e.target as HTMLInputElement).value)} /></label>
      </fieldset>
      <p class="aviso-estado" role="status">
        {invalido ? 'Escribe solo números en el precio.' : `Mostrando ${visibles.size} de ${productos.length} productos.`}
        {(minimo.trim() !== '' || maximo.trim() !== '') && ' Los productos «a consultar» no tienen precio y se ocultan al filtrar por precio.'}
      </p>
      {hayFiltro && <button type="button" class="enlace-boton" onClick={() => { setElegidas([]); setMinimo(''); setMaximo(''); }}>Limpiar filtros</button>}
    </form>
  );
}
