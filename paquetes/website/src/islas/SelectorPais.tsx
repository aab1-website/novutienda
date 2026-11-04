import { useEffect, useState } from 'preact/hooks';
import type { Mercado } from '@plataforma/nucleo';
import { leerMercado, monedaDe } from '../lib/mercado.js';
import { Dialogo } from './Dialogo.js';
import { useMercado } from './estado.js';
import { almacenLocal } from './navegador.js';

interface Props {
  inicial: Mercado;
  mercados: readonly Mercado[];
}

const PAIS: Readonly<Record<Mercado, { nombre: string; moneda: string; aria: string }>> = {
  BO: { nombre: 'Bolivia', moneda: 'Bolivianos (Bs)', aria: 'Ver precios en bolivianos' },
  AR: { nombre: 'Argentina', moneda: 'Pesos ($)', aria: 'Ver precios en pesos argentinos' },
};

/** Selector de país en la cabecera y ventana de primera visita. */
export default function SelectorPais({ inicial, mercados }: Props) {
  const [mercado, elegir] = useMercado(inicial, mercados);
  const [primeraVisita, setPrimeraVisita] = useState(false);

  useEffect(() => {
    setPrimeraVisita(mercados.length > 1 && leerMercado(almacenLocal(), mercados) === null);
    // Solo al montar.
  }, []);

  if (mercados.length < 2) return null;
  return (
    <>
      <div class="selector-pais" role="group" aria-label="País y moneda de los precios">
        {mercados.map((m) => (
          <button key={m} type="button" class={`pastilla bandera-${m.toLowerCase()}`} aria-pressed={m === mercado} aria-label={PAIS[m].aria} onClick={() => elegir(m)}>
            <span class="bandera" aria-hidden="true" />
            {monedaDe(m)}
          </button>
        ))}
      </div>
      {primeraVisita && (
        <Dialogo titulo="¿Desde dónde nos visitas?" onCerrar={() => { elegir(mercado); setPrimeraVisita(false); }}>
          <p class="dialogo-texto">Selecciona tu país para ver los precios en tu moneda local.</p>
          <div class="opciones-pais">
            {mercados.map((m) => (
              <button key={m} type="button" class="opcion-pais" onClick={() => { elegir(m); setPrimeraVisita(false); }}>
                <span class={`bandera bandera-grande bandera-${m.toLowerCase()}`} aria-hidden="true" />
                <strong>{PAIS[m].nombre}</strong>
                <span>{PAIS[m].moneda}</span>
              </button>
            ))}
          </div>
        </Dialogo>
      )}
    </>
  );
}
