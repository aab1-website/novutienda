import type { JSX } from 'preact';
import type { ConteoAbierto } from '../api/tipos.js';
import { Alerta } from './comun.js';

/** Texto que ocupa el lugar de una existencia, total, «bajo el mínimo» o «disponible» que el servidor ocultó (llega `null`). */
export const TEXTO_OCULTO = 'Oculto';
export const DESCRIPCION_OCULTO = 'Oculto mientras hay un conteo abierto';

/** Pasadas estas horas el aviso de conteo abierto pasa a tono de alerta. */
export const HORAS_ALERTA_CONTEO = 24;
const MS_ALERTA_CONTEO = HORAS_ALERTA_CONTEO * 3600_000;

/** Nombres de almacén por omisión; una pantalla puede pasar los suyos con la prop `nombreAlmacen`. */
const NOMBRES_ALMACEN: Readonly<Record<string, string>> = { tienda: 'Tienda', 'deposito-1': 'Depósito 1', 'deposito-2': 'Depósito 2' };
const nombreAlmacenPorOmision = (id: string): string => NOMBRES_ALMACEN[id] ?? id;

/**
 * Lo que se muestra cuando el valor es `null` (oculto por un conteo abierto): «Oculto», nunca «0». La descripción accesible va
 * en `aria-label` del propio texto para que un lector de pantalla diga el motivo.
 */
export function ExistenciaOculta(): JSX.Element {
  return (
    <span class="existencia-oculta" role="img" aria-label={DESCRIPCION_OCULTO} title={DESCRIPCION_OCULTO}>
      {TEXTO_OCULTO}
    </span>
  );
}

/** Fecha y hora de un instante ISO en La Paz (UTC-4, sin horario de verano): `dd/mm/aaaa hh:mm`. */
export function fechaHoraLaPaz(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms - 4 * 3600_000);
  const dos = (n: number): string => String(n).padStart(2, '0');
  return `${dos(d.getUTCDate())}/${dos(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}`;
}

/** `true` si el conteo lleva abierto más de 24 horas (sin fecha no se puede saber: no cuenta). */
export const conteoVencido = (c: ConteoAbierto, ahoraMs: number): boolean => {
  if (c.abiertoEn === null) return false;
  const desde = Date.parse(c.abiertoEn);
  return !Number.isNaN(desde) && ahoraMs - desde > MS_ALERTA_CONTEO;
};

interface PropsAviso {
  readonly conteos: readonly ConteoAbierto[] | undefined;
  /** Nombre legible del almacén (por omisión, el de Tienda y los depósitos). */
  readonly nombreAlmacen?: ((ubicacionId: string) => string) | undefined;
  /** Reloj inyectable para pruebas. */
  readonly ahoraMs?: number | undefined;
}

/**
 * Aviso de conteo abierto: una línea por almacén en conteo. Pasadas 24 horas pasa a tono de alerta (rojo) y lo dice con texto,
 * no solo con color. Con `abiertoEn` nulo no inventa una fecha. Sin conteos no muestra nada.
 */
export function AvisoConteoAbierto({ conteos, nombreAlmacen = nombreAlmacenPorOmision, ahoraMs }: PropsAviso): JSX.Element | null {
  if (conteos === undefined || conteos.length === 0) return null;
  const ahora = ahoraMs ?? Date.now();
  const lineas = conteos.map((c) => {
    const vencido = conteoVencido(c, ahora);
    const desde = c.abiertoEn === null ? '' : ` desde ${fechaHoraLaPaz(c.abiertoEn)}`;
    return { id: c.conteoId, vencido, texto: `Hay un conteo abierto en ${nombreAlmacen(c.ubicacionId)}${desde}.` };
  });
  const alguno = lineas.some((l) => l.vencido);
  return (
    <Alerta tipo={alguno ? 'error' : 'info'}>
      <div class="aviso-conteo" data-vencido={alguno ? 'si' : 'no'}>
        {lineas.map((l) => (
          <p key={l.id} class="aviso-conteo-linea">
            {l.texto}
            {l.vencido && <strong class="aviso-conteo-vencido"> Lleva abierto desde hace más de {HORAS_ALERTA_CONTEO} horas.</strong>}
          </p>
        ))}
        <p class="aviso-conteo-linea texto-suave">Las existencias se ocultan hasta que se cierre.</p>
      </div>
    </Alerta>
  );
}
