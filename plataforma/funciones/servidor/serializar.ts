// Salida de los callables: JSON plano. Los `Timestamp` de Firestore pasan a texto ISO 8601 y se descartan
// los valores no serializables; nada del interior de los documentos se transforma salvo eso.
import { Timestamp } from 'firebase-admin/firestore';

export function aJson(valor: unknown, profundidad = 0): unknown {
  if (profundidad > 20) return null;
  if (valor === null || typeof valor === 'string' || typeof valor === 'boolean') return valor;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (valor instanceof Timestamp) return valor.toDate().toISOString();
  if (valor instanceof Date) return valor.toISOString();
  if (Array.isArray(valor)) return valor.map((x) => aJson(x, profundidad + 1));
  if (valor instanceof Uint8Array) return Buffer.from(valor).toString('base64');
  if (typeof valor === 'object') {
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) if (v !== undefined) salida[k] = aJson(v, profundidad + 1);
    return salida;
  }
  return null;
}
