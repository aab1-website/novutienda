import { SesionDoble } from '../sesion/doble.js';
import { AlmacenSubidasDoble } from '../subidas/almacen.js';
import { montar } from '../montar.js';
import { ClienteDoble } from './doble.js';

// Arranque del modo `humo` (pruebas de navegador): dobles en memoria, sin Firebase. Solo entra al HTML en ese modo.
const sesion = new SesionDoble();
const api = new ClienteDoble({ usuario: () => sesion.actual() ?? { uid: 'anonimo', rol: 'caj' } });
montar({ sesion, api, almacen: new AlmacenSubidasDoble() });
