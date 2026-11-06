// Registro de la plataforma: el único lugar donde se enumeran los módulos.
// Vive en la raíz del workspace, fuera de cualquier paquete, para que el núcleo
// no importe a los módulos (frontera: nucleo no importa ningún paquete interno).
// Un módulo nuevo se registra aquí con una línea de importación por su entrada
// pública y una de `registrar`; el generador de reglas y las pruebas de
// fronteras leen este archivo.
import { crearRegistro, manifiestoNucleo, type ManifiestoModulo } from '@novutienda/nucleo';
import { manifiestoInventarios } from '@novutienda/inventarios';
import { manifiestoPos } from '@novutienda/pos';
import { manifiestoRecibos } from '@novutienda/recibos';
import { manifiestoWebsite } from '@novutienda/website';
import { manifiestoConsola } from '@novutienda/consola';
import { manifiestoPanel } from '@novutienda/panel';
// Manifiesto del operador (zona Plataforma, L1-b): datos de plataforma que no son de ningún tenant.
import { manifiestoPlataforma } from './operador/manifiesto.js';

export const registroPlataforma = crearRegistro<ManifiestoModulo>();
registroPlataforma.registrar(manifiestoNucleo);
registroPlataforma.registrar(manifiestoInventarios);
registroPlataforma.registrar(manifiestoPos);
registroPlataforma.registrar(manifiestoRecibos);
registroPlataforma.registrar(manifiestoWebsite);
registroPlataforma.registrar(manifiestoConsola);
registroPlataforma.registrar(manifiestoPanel);
registroPlataforma.registrar(manifiestoPlataforma);

/**
 * Manifiestos en orden topológico (dependencias primero). Es el orden que usa el
 * generador de reglas; las pruebas deben usar esta misma función para comparar.
 * Lanza si hay rutas duplicadas.
 */
export function manifiestosEnOrden(): ManifiestoModulo[] {
  registroPlataforma.rutas();
  // L1-c: rutas de Storage únicas y a lo sumo una `subidaReservada` en todo el registro.
  registroPlataforma.rutasAlmacenamiento();
  const porId = new Map(registroPlataforma.listar().map((m) => [m.id, m]));
  return registroPlataforma.ordenTopologico().map((id) => porId.get(id) as ManifiestoModulo);
}
