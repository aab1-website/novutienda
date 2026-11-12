// L3-5: los consumidores que la plataforma suscribe al bus son exactamente los `consume` de los manifiestos.
import type { BaseDatosIdentidad } from '@novutienda/nucleo';
import { describe, expect, it } from 'vitest';
import { consumidoresDePlataforma } from '../../plataforma/coordinador/consumidores.js';
import { registroPlataforma } from '../../plataforma/registro.js';

// Construir los consumidores no toca la base: solo se leen su nombre y sus tipos.
const consumidores = consumidoresDePlataforma({} as BaseDatosIdentidad);

/** Reacciones del coordinador que NO están en ningún `consume` (consumidor opcional que depende del emisor; ver el informe de la tanda). */
const OPCIONALES_DEL_COORDINADOR = ['consola:producto.cambiado'];

describe('consumidores del bus frente a los manifiestos', () => {
  it('cada par módulo:evento de consumidoresDePlataforma es un `consume` del manifiesto, y al revés', () => {
    const suscritos = consumidores.flatMap((c) => c.tipos.map((t) => `${c.nombre.split(':')[0]}:${t}`)).filter((p) => !OPCIONALES_DEL_COORDINADOR.includes(p)).sort();
    const declarados = registroPlataforma.listar().flatMap((m) => m.consume.map((t) => `${m.id}:${t}`)).sort();
    expect(suscritos).toEqual(declarados);
  });

  it('los opcionales del coordinador existen y ningún manifiesto los declara en `consume`', () => {
    const suscritos = consumidores.flatMap((c) => c.tipos.map((t) => `${c.nombre.split(':')[0]}:${t}`));
    const declarados = registroPlataforma.listar().flatMap((m) => m.consume.map((t) => `${m.id}:${t}`));
    for (const o of OPCIONALES_DEL_COORDINADOR) {
      expect(suscritos).toContain(o);
      expect(declarados).not.toContain(o);
    }
  });

  it('el nombre de cada consumidor coincide con sus tipos y no hay pares repetidos', () => {
    for (const c of consumidores) expect(c.nombre).toBe(`${c.nombre.split(':')[0]}:${c.tipos.join(',')}`);
    const nombres = consumidores.map((c) => c.nombre);
    expect(new Set(nombres).size).toBe(nombres.length);
  });
});
