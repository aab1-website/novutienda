import { render } from 'preact';
import { App } from './ui/app.js';
import type { Servicios } from './servicios.js';
import './estilos/panel.css';

/** Monta el panel en `#raiz` con los servicios dados; lo comparten el arranque real y el del doble (`humo`). */
export function montar({ sesion, api, almacen }: Servicios): void {
  const raiz = document.getElementById('raiz');
  if (raiz !== null) render(<App sesion={sesion} api={api} almacen={almacen} />, raiz);
}
