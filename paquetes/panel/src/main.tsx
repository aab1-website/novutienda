import { crearServicios } from './servicios.js';
import { montar } from './montar.js';

void crearServicios().then(montar);
