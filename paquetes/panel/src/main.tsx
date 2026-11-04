import { render } from 'preact';
import { App } from './ui/app.js';
import { crearServicios } from './servicios.js';
import './estilos/panel.css';

const raiz = document.getElementById('raiz');
if (raiz !== null) {
  void crearServicios().then(({ sesion, api, almacen }) => render(<App sesion={sesion} api={api} almacen={almacen} />, raiz));
}
