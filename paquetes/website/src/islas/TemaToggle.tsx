import { useEffect, useState } from 'preact/hooks';
import { alternarTema, guardarTema, leerTema, temaEfectivo, type Tema } from '../lib/tema.js';
import { Icono } from './Icono.js';
import { almacenLocal } from './navegador.js';

function efectivo(): Tema {
  return temaEfectivo(leerTema(almacenLocal()), window.matchMedia('(prefers-color-scheme: dark)').matches);
}

/** Modo claro/oscuro: por defecto sigue al dispositivo y recuerda la elección. */
export default function TemaToggle() {
  const [tema, setTema] = useState<Tema>('claro');
  useEffect(() => {
    setTema(efectivo());
    const consulta = window.matchMedia('(prefers-color-scheme: dark)');
    const alCambiar = (): void => {
      if (leerTema(almacenLocal()) === null) setTema(efectivo());
    };
    consulta.addEventListener('change', alCambiar);
    return () => consulta.removeEventListener('change', alCambiar);
  }, []);

  const alternar = (): void => {
    const nuevo = alternarTema(tema);
    guardarTema(almacenLocal(), nuevo);
    document.documentElement.dataset['tema'] = nuevo;
    setTema(nuevo);
  };
  return (
    <button type="button" class="boton-icono boton-borde" aria-label={tema === 'oscuro' ? 'Cambiar a modo día' : 'Cambiar a modo noche'} onClick={alternar}>
      <Icono nombre={tema === 'oscuro' ? 'sol' : 'luna'} tamano={18} />
    </button>
  );
}
