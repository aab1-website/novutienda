import { SesionDoble } from '../sesion/doble.js';
import { AlmacenSubidasDoble } from '../subidas/almacen.js';
import { montar } from '../montar.js';
import { conCorreoDeInvitacion } from '../api/invitaciones.js';
import { ClienteDoble } from './doble.js';
import { sembrarEjemplos } from './estado.js';

// Arranque del modo `humo` (pruebas de navegador): dobles en memoria, sin Firebase. Solo entra al HTML en ese modo.
const sesion = new SesionDoble();
const doble = new ClienteDoble({ usuario: () => sesion.actual() ?? { uid: 'anonimo', rol: 'caj' } });
// `?semilla` en la dirección carga datos de ejemplo (turno cerrado, ventas, créditos, mermas) para medir las listas.
if (new URLSearchParams(window.location.search).has('semilla')) sembrarEjemplos(doble.estado, Date.now());
const api = conCorreoDeInvitacion(doble, sesion);
montar({ sesion, api, almacen: new AlmacenSubidasDoble() });
