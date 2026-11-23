/** Disponibilidad viva (`/api/disponibilidad`, la regla de existencias públicas del sitio): ids que están agotados AHORA. */
const POR_LLAMADA = 50;

export async function agotadosAhora(ids: readonly string[], base = '/api/disponibilidad'): Promise<ReadonlySet<string>> {
  const agotados = new Set<string>();
  const lotes: string[][] = [];
  for (let i = 0; i < ids.length; i += POR_LLAMADA) lotes.push(ids.slice(i, i + POR_LLAMADA));
  await Promise.all(lotes.map(async (lote) => {
    try {
      const r = await fetch(`${base}?ids=${lote.join(',')}`, { headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      const j = (await r.json()) as { disponibilidad?: Record<string, string> };
      for (const [id, v] of Object.entries(j.disponibilidad ?? {})) if (v === 'agotado') agotados.add(id);
    } catch {
      // Sin respuesta se queda lo del build: no se oculta nada por error.
    }
  }));
  return agotados;
}
