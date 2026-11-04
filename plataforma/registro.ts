// Registro de la plataforma: el único lugar donde se enumeran los módulos.
// Vive en la raíz del workspace, fuera de cualquier paquete, para que el núcleo
// no importe a los módulos (frontera: nucleo no importa ningún paquete interno).
// Un módulo nuevo se registra aquí con una línea de importación por su entrada
// pública y una de `registrar`; el generador de reglas y las pruebas de
// fronteras leen este archivo.
import { crearRegistro, manifiestoNucleo, type ManifiestoModulo } from '@plataforma/nucleo';
import { manifiestoInventarios } from '@plataforma/inventarios';
import { manifiestoPos } from '@plataforma/pos';
import { manifiestoRecibos } from '@plataforma/recibos';
import { manifiestoWebsite } from '@plataforma/website';
import { manifiestoConsola } from '@plataforma/consola';
import { manifiestoPanel } from '@plataforma/panel';

export const registroPlataforma = crearRegistro<ManifiestoModulo>();
registroPlataforma.registrar(manifiestoNucleo);
registroPlataforma.registrar(manifiestoInventarios);
registroPlataforma.registrar(manifiestoPos);
registroPlataforma.registrar(manifiestoRecibos);
registroPlataforma.registrar(manifiestoWebsite);
registroPlataforma.registrar(manifiestoConsola);
registroPlataforma.registrar(manifiestoPanel);

/**
 * Manifiestos en orden topológico (dependencias primero). Es el orden que usa el
 * generador de reglas; las pruebas deben usar esta misma función para comparar.
 * Lanza si hay rutas duplicadas.
 */
export function manifiestosEnOrden(): ManifiestoModulo[] {
  registroPlataforma.rutas();
  const porId = new Map(registroPlataforma.listar().map((m) => [m.id, m]));
  return registroPlataforma.ordenTopologico().map((id) => porId.get(id) as ManifiestoModulo);
}
