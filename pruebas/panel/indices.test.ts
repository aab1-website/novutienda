// Los filtros por tipo/usuario de movimientos y por acción/usuario de auditoría deben tener su índice compuesto, para que el
// servidor pueda pasar de filtrar en memoria a una consulta exacta (docs/produccion/funciones.md §9).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Indice { collectionGroup: string; queryScope: string; fields: { fieldPath: string; order: string }[] }
const { indexes } = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')) as { indexes: Indice[] };
const firma = (i: Indice): string => `${i.collectionGroup}(${i.fields.map((f) => `${f.fieldPath} ${f.order === 'DESCENDING' ? 'desc' : 'asc'}`).join(', ')})`;

describe('índices compuestos de Firestore', () => {
  const firmas = indexes.map(firma);
  it.each(['movimientos(tipo asc, fecha desc)', 'movimientos(por asc, fecha desc)', 'auditoria(accion asc, en desc)', 'auditoria(uid asc, en desc)'])('declara %s', (esperado) => {
    expect(firmas).toContain(esperado);
  });
  it('no hay índices repetidos y todos son de colección', () => {
    expect(new Set(firmas).size).toBe(firmas.length);
    expect(indexes.every((i) => i.queryScope === 'COLLECTION')).toBe(true);
  });
});
