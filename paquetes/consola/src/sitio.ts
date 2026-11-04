import { validarEnlace } from './enlaces.js';
import { ID_MEDIO } from './fichas.js';
import { esPlantilla, PLANTILLAS, type PlantillaId } from './plantillas.js';
import { esObjeto, resultado, soloClaves, textoPlano, type Validacion } from './validar.js';

/** `sitio/config`. */
export interface ConfigSitio {
  readonly plantillaActiva: PlantillaId;
  /** Número del asistente de NovuChat al que apunta «Comprar»: solo dígitos, con código de país. */
  readonly whatsappNovuchat: string;
  readonly medicion: {
    readonly ga4?: string;
    readonly searchConsole?: string;
    readonly metaPixel?: string;
    readonly tiktokPixel?: string;
  };
}

const PATRONES_MEDICION = {
  ga4: /^G-[A-Z0-9]{4,12}$/,
  searchConsole: /^[A-Za-z0-9_-]{20,100}$/,
  metaPixel: /^\d{8,20}$/,
  tiktokPixel: /^[A-Z0-9]{10,30}$/,
} as const;

export function validarConfigSitio(x: unknown): Validacion<ConfigSitio> {
  const errores: string[] = [];
  if (!esObjeto(x)) return { ok: false, errores: ['la configuración debe ser un objeto'] };
  soloClaves(x, ['plantillaActiva', 'whatsappNovuchat', 'medicion'], 'config', errores);
  if (!esPlantilla(x['plantillaActiva'])) errores.push(`plantillaActiva: debe ser una de ${PLANTILLAS.join(', ')}`);
  const wa = x['whatsappNovuchat'];
  if (typeof wa !== 'string' || !/^[1-9]\d{7,14}$/.test(wa)) errores.push('whatsappNovuchat: solo dígitos, con código de país (8 a 15 dígitos)');
  const medicion: { -readonly [k in keyof ConfigSitio['medicion']]: string } = {};
  const m = x['medicion'];
  if (!esObjeto(m)) errores.push('medicion: debe ser un objeto');
  else {
    soloClaves(m, Object.keys(PATRONES_MEDICION), 'medicion', errores);
    for (const [k, patron] of Object.entries(PATRONES_MEDICION)) {
      const v = m[k];
      if (v === undefined || v === '') continue;
      if (typeof v !== 'string' || !patron.test(v)) errores.push(`medicion.${k}: formato inválido`);
      else medicion[k as keyof typeof medicion] = v;
    }
  }
  return resultado(errores, {
    plantillaActiva: esPlantilla(x['plantillaActiva']) ? x['plantillaActiva'] : PLANTILLAS[0],
    whatsappNovuchat: typeof wa === 'string' ? wa : '',
    medicion,
  });
}

export interface ItemCarrusel {
  readonly medioId: string;
  readonly alt: string;
  readonly enlace?: string;
}

/** `carruseles/{plantilla}`: fotos de portada de la plantilla. */
export interface Carrusel {
  readonly plantilla: PlantillaId;
  readonly items: readonly ItemCarrusel[];
}

export function validarCarrusel(x: unknown): Validacion<Carrusel> {
  const errores: string[] = [];
  if (!esObjeto(x)) return { ok: false, errores: ['el carrusel debe ser un objeto'] };
  soloClaves(x, ['plantilla', 'items'], 'carrusel', errores);
  if (!esPlantilla(x['plantilla'])) errores.push(`plantilla: debe ser una de ${PLANTILLAS.join(', ')}`);
  const items: ItemCarrusel[] = [];
  const crudos = x['items'];
  if (!Array.isArray(crudos) || crudos.length > 8) errores.push('items: lista de hasta 8 fotos');
  else {
    crudos.forEach((it: unknown, i: number) => {
      const r = `items[${String(i)}]`;
      if (!esObjeto(it)) {
        errores.push(`${r}: debe ser un objeto`);
        return;
      }
      soloClaves(it, ['medioId', 'alt', 'enlace'], r, errores);
      const id = it['medioId'];
      if (typeof id !== 'string' || !ID_MEDIO.test(id)) errores.push(`${r}.medioId: inválido`);
      const alt = textoPlano(it['alt'], `${r}.alt`, { min: 1, max: 160 }, errores);
      let enlace: string | undefined;
      if (it['enlace'] !== undefined) {
        const e = validarEnlace(it['enlace']);
        if (e.ok) enlace = e.valor;
        else errores.push(`${r}.enlace: ${e.error}`);
      }
      if (typeof id === 'string' && alt !== undefined) items.push(enlace === undefined ? { medioId: id, alt } : { medioId: id, alt, enlace });
    });
  }
  return resultado(errores, { plantilla: esPlantilla(x['plantilla']) ? x['plantilla'] : PLANTILLAS[0], items });
}
