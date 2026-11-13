// (b) Rutas públicas del sitio `/api/cotizacion` y `/api/disponibilidad`, con el despachador real del módulo
// website y los lectores reales (cotización del núcleo y disponibilidad del conector de Firebase).
import { despacharApi, lectorCotizacion, type DepsApi } from '@novutienda/website';
import { describe, expect, it } from 'vitest';
import { crearLectorDisponibilidad } from '../../plataforma/conectores/firebase/index.js';
import { AHORA, T, crearEscenario } from './escenario.js';
import { firestoreDoble } from './firestore-doble.js';
import { compararConFotoJson } from './foto.js';

async function preparar(): Promise<{ deps: DepsApi; quitarCotizacion: (m: 'BO' | 'AR') => void }> {
  const e = await crearEscenario();
  const deps: DepsApi = {
    leerCotizacion: lectorCotizacion(e.almacen, T, () => AHORA),
    leerDisponibilidad: crearLectorDisponibilidad(firestoreDoble(e.db), T),
    contacto: undefined as never, // las rutas bajo prueba no tocan el contacto
  };
  return { deps, quitarCotizacion: (m) => e.db.docs.delete(`tenants/${T}/cotizaciones/${m}`) };
}

const pedir = async (deps: DepsApi, ruta: string, consulta: Record<string, string> = {}, metodo = 'GET') => {
  const r = await despacharApi({ metodo, ruta, consulta, cabeceras: {}, origen: '203.0.113.9' }, deps);
  return { status: r.status, headers: r.headers, cuerpo: r.cuerpo };
};

describe('sitio: rutas públicas dinámicas', () => {
  it('/api/cotizacion por mercado, mercado inválido y método', async () => {
    const { deps, quitarCotizacion } = await preparar();
    const antes = {
      BO: await pedir(deps, '/api/cotizacion', { mercado: 'BO' }),
      AR: await pedir(deps, '/api/cotizacion', { mercado: 'AR' }),
      invalido: await pedir(deps, '/api/cotizacion', { mercado: 'XX' }),
      sinMercado: await pedir(deps, '/api/cotizacion'),
      metodo: await pedir(deps, '/api/cotizacion', { mercado: 'BO' }, 'POST'),
      barraFinal: await pedir(deps, '/api/cotizacion/', { mercado: 'BO' }),
    };
    quitarCotizacion('AR');
    compararConFotoJson('sitio-cotizacion.json', { ...antes, arSinCotizacion: await pedir(deps, '/api/cotizacion', { mercado: 'AR' }) });
  });

  it('/api/disponibilidad: disponible, agotado, inactivo, sin control de stock, desconocido y entradas inválidas', async () => {
    const { deps } = await preparar();
    const ids = 'p-lapiz,p-agotado,p-inactivo,p-servicio,p-televisor,p-celular,no-existe';
    const r = await pedir(deps, '/api/disponibilidad', { ids });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.cuerpo)).not.toMatch(/cantidad|stock/);
    compararConFotoJson('sitio-disponibilidad.json', {
      mezcla: r,
      sinIds: await pedir(deps, '/api/disponibilidad'),
      idInvalido: await pedir(deps, '/api/disponibilidad', { ids: 'MAL ID' }),
      metodo: await pedir(deps, '/api/disponibilidad', { ids }, 'POST'),
      rutaDesconocida: await pedir(deps, '/api/otra'),
    });
  });
});
