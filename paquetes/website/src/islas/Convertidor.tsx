import { useEffect, useState } from 'preact/hooks';
import { convertir, textoReferencia, type Conversion, type MonedaConv } from '../lib/convertidor.js';
import { parsearMonto } from '../lib/dinero.js';
import { EVENTOS, escuchar } from '../lib/eventos.js';
import type { Cotizaciones } from '../lib/cotizacion-cliente.js';
import { Dialogo } from './Dialogo.js';
import { Icono } from './Icono.js';
import { clienteCotizacion } from './navegador.js';

const MONEDAS: readonly { codigo: MonedaConv; nombre: string }[] = [
  { codigo: 'USD', nombre: 'Dólares (US$)' },
  { codigo: 'BOB', nombre: 'Bolivianos (Bs)' },
  { codigo: 'ARS', nombre: 'Pesos argentinos ($)' },
];

/** Convertidor de referencia con la cotización oficial (sin tasas en el código). */
export default function Convertidor() {
  const [abierto, setAbierto] = useState(false);
  const [cot, setCot] = useState<Cotizaciones | null>(null);
  const [origen, setOrigen] = useState<MonedaConv>('USD');
  const [texto, setTexto] = useState('100');

  useEffect(() => escuchar<void>(EVENTOS.abrirConvertidor, () => setAbierto(true)), []);
  useEffect(() => {
    if (abierto && cot === null) void clienteCotizacion().todas().then(setCot);
  }, [abierto, cot]);

  const monto = parsearMonto(texto);
  const r: Conversion | null = cot !== null && monto !== null ? convertir(origen, monto, cot) : null;
  const sinCotizacion = cot !== null && Object.keys(cot).length === 0;
  return (
    <>
      <button type="button" class="enlace-boton enlace-icono" aria-haspopup="dialog" onClick={() => setAbierto(true)}>
        <Icono nombre="actualizar" tamano={16} /> Convertidor de precios
      </button>
      {abierto && (
        <Dialogo titulo="Convertidor de precios" onCerrar={() => setAbierto(false)} enfocarCampo>
          {MONEDAS.map((m) => {
            const valor = m.codigo === origen ? texto : textoReferencia(r?.[m.codigo] ?? null);
            return (
              <label key={m.codigo} class="campo-conversion">
                <span>{m.nombre}</span>
                <input inputMode="decimal" value={valor} onInput={(e) => { setOrigen(m.codigo); setTexto((e.target as HTMLInputElement).value); }} />
              </label>
            );
          })}
          <p class="aviso-estado" role="status">
            {cot === null && 'Cargando la cotización oficial…'}
            {sinCotizacion && 'No hay una cotización disponible por ahora.'}
            {cot !== null && !sinCotizacion && 'Valores de referencia con la cotización oficial vigente. El precio final se confirma al comprar.'}
            {monto === null && texto.trim() !== '' && ' Escribe un número válido.'}
          </p>
        </Dialogo>
      )}
    </>
  );
}
