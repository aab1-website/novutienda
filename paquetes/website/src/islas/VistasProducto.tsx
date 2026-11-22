import { useEffect, useState } from 'preact/hooks';
import { marcarVista, textoVistas, yaContoVista } from '../lib/vistas.js';
import { almacenLocal } from './navegador.js';

/** Cuenta la vista (una por navegador y 24 h) y, desde 10 vistas reales, muestra «N personas vieron este producto». */
export default function VistasProducto({ id, apiBase = '' }: { id: string; apiBase?: string }) {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let vivo = true;
    const ahora = Date.now();
    const cuenta = !yaContoVista(almacenLocal(), id, ahora);
    fetch(`${apiBase}/api/vista?id=${encodeURIComponent(id)}`, { method: cuenta ? 'POST' : 'GET', headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { vistas?: unknown } | null) => {
        if (cuenta && j !== null) marcarVista(almacenLocal(), id, ahora);
        if (vivo && typeof j?.vistas === 'number') setN(j.vistas);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [id, apiBase]);
  const texto = n === null ? null : textoVistas(n);
  return texto === null ? null : <p class="ficha-vistas" role="status">{texto}</p>;
}
