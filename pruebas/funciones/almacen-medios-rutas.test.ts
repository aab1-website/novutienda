// Contrato entre la consola y la lista blanca del bucket público: toda ruta pública que la consola puede generar
// (`planificarProcesamiento` + `nombreVersion` + la forma de `rutaPublicaMedio`) debe pasar `RUTA_PUBLICA`.
// Sin emulador: solo funciones puras. Tenant y datos sintéticos.
import { describe, expect, it } from 'vitest';
import { ID_NEGOCIO, nombreVersion, planificarProcesamiento, rutaPublicaMedio } from '@novutienda/consola';
import { RUTA_PUBLICA, tipoContenidoDe } from '../../plataforma/conectores/firebase/almacen-medios.js';

const T = 'tienda-ejemplo';
const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'.padEnd(64, '0');
// Misma forma que `rutaPublicaMedio` de la consola (no se exporta desde su índice).
const publica = (productoId: string, nombre: string): string => rutaPublicaMedio(T, productoId, nombre);

const DIMENSIONES: ReadonlyArray<readonly [number, number]> = [[1, 1], [100, 80], [512, 512], [513, 200], [700, 3000], [1280, 720], [2400, 1600], [4000, 3000], [30000, 99999]];

describe('RUTA_PUBLICA frente a lo que genera la consola', () => {
  for (const [tipo, id] of [['foto', 'camisa-azul'], ['video', 'camisa-azul'], ['logo', ID_NEGOCIO]] as const) {
    it(`acepta toda versión de ${tipo}`, () => {
      for (const [ancho, alto] of DIMENSIONES) {
        const plan = planificarProcesamiento(tipo, ancho, alto);
        expect(plan.items.length).toBeGreaterThan(0);
        for (const item of plan.items) {
          const ruta = publica(id, nombreVersion(HASH, item));
          expect(RUTA_PUBLICA.test(ruta), ruta).toBe(true);
        }
      }
    });
  }

  it('tipos de contenido de las versiones', () => {
    expect(tipoContenidoDe(publica(ID_NEGOCIO, `${HASH.slice(0, 32)}-logo512.png`))).toBe('image/png');
    expect(tipoContenidoDe(publica(ID_NEGOCIO, `${HASH.slice(0, 32)}-logo512.webp`))).toBe('image/webp');
  });

  const h = HASH.slice(0, 32);
  const negativos: Record<string, string> = {
    'carpeta _otro': publica('_otro', `${h}-logo512.png`),
    'logo0': publica(ID_NEGOCIO, `${h}-logo0.png`),
    'logo513': publica(ID_NEGOCIO, `${h}-logo513.png`),
    'logo con cero a la izquierda': publica(ID_NEGOCIO, `${h}-logo05.png`),
    'logo avif': publica(ID_NEGOCIO, `${h}-logo512.avif`),
    'logo con mayúsculas': publica(ID_NEGOCIO, `${h.toUpperCase()}-logo512.png`),
    'imagen en _negocio': publica(ID_NEGOCIO, `${h}-imagen480.webp`),
    'logo en un producto': publica('camisa-azul', `${h}-logo512.png`),
    'png en una foto': publica('camisa-azul', `${h}-imagen480.png`),
    'recorrido ..': `tenants/${T}/publico/medios/_negocio/../${h}-logo512.png`,
    'recorrido .. al tenant': `tenants/${T}/publico/medios/_negocio/${h}-logo512.png/../../x`,
    'doble barra': `tenants/${T}/publico/medios//_negocio/${h}-logo512.png`,
    'codificado %': publica(ID_NEGOCIO, `${h}-logo5%312.png`),
    'privado': `tenants/${T}/privado/medios/_negocio/${h}-logo512.png`,
    'subcarpeta extra': publica(`${ID_NEGOCIO}/x`, `${h}-logo512.png`),
    'tenant inválido': `tenants/T_X/publico/medios/_negocio/${h}-logo512.png`,
    'hash corto': publica(ID_NEGOCIO, `${h.slice(1)}-logo512.png`),
  };
  for (const [caso, ruta] of Object.entries(negativos)) {
    it(`rechaza: ${caso}`, () => {
      expect(RUTA_PUBLICA.test(ruta)).toBe(false);
    });
  }
});
