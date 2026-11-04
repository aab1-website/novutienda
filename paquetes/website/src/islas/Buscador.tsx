import { useEffect, useRef, useState } from 'preact/hooks';
import { buscarProductos } from '../contenido/consultas.js';
import { EVENTOS, escuchar } from '../lib/eventos.js';
import { Dialogo } from './Dialogo.js';
import { Icono } from './Icono.js';

interface EntradaIndice {
  /** id, nombre, categoría (nombre), marca, ruta */
  readonly i: string;
  readonly nombre: string;
  readonly categoria: string;
  readonly marca: string;
  readonly ruta: string;
}

/** Buscador de productos: el índice se descarga al abrir por primera vez (archivo estático del propio sitio). */
export default function Buscador({ indice = '/indice-productos.json' }: { indice?: string }) {
  const [abierto, setAbierto] = useState(false);
  const [consulta, setConsulta] = useState('');
  const [entradas, setEntradas] = useState<readonly EntradaIndice[] | null>(null);
  const [fallo, setFallo] = useState(false);
  const pedido = useRef(false);

  useEffect(() => escuchar<void>(EVENTOS.abrirBuscador, () => setAbierto(true)), []);
  useEffect(() => {
    if (!abierto || pedido.current) return;
    pedido.current = true;
    fetch(indice, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('indice'))))
      .then((j: readonly EntradaIndice[]) => setEntradas(j))
      .catch(() => {
        pedido.current = false;
        setFallo(true);
      });
  }, [abierto, indice]);

  const resultados = entradas === null ? [] : buscarProductos(entradas, consulta, 8);
  return (
    <>
      <button type="button" class="boton-icono" aria-label="Buscar productos" aria-haspopup="dialog" onClick={() => setAbierto(true)}>
        <Icono nombre="buscar" />
      </button>
      {abierto && (
        <Dialogo titulo="Buscar productos" onCerrar={() => { setAbierto(false); setConsulta(''); }} enfocarCampo>
          <label class="campo-buscar">
            <span class="solo-lectores">Buscar televisores, lavadoras, parlantes…</span>
            <input type="search" value={consulta} placeholder="Buscar televisores, lavadoras, parlantes…" autocomplete="off" onInput={(e) => setConsulta((e.target as HTMLInputElement).value)} />
          </label>
          <div aria-live="polite">
            {fallo && <p class="aviso-estado">No pudimos cargar el buscador. Revisa tu conexión e inténtalo de nuevo.</p>}
            {consulta.trim() !== '' && entradas !== null && resultados.length === 0 && <p class="aviso-estado">No encontramos productos para esa búsqueda.</p>}
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
          </div>
        </Dialogo>
      )}
    </>
  );
}
