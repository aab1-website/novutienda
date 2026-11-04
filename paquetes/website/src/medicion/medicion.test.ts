import { describe, expect, it } from 'vitest';
import type { ConfigMedicion } from '../contenido/tipos.js';
import { almacenMemoria } from '../lib/almacen.js';
import { guardarConsentimiento, leerConsentimiento, SIN_CONSENTIMIENTO, TODO_ACEPTADO } from './consentimiento.js';
import { crearMedicion, URL_GOOGLE, URL_META, URL_TIKTOK } from './medicion.js';

const COMPLETA: ConfigMedicion = { google: 'G-EJEMPLO00', searchConsole: null, meta: '1234567890123456', tiktok: 'CEJEMPLO0000EJEMPLO' };

function montar(config: ConfigMedicion = COMPLETA): { cargados: string[]; w: Record<string, unknown>; m: ReturnType<typeof crearMedicion> } {
  const cargados: string[] = [];
  const w: Record<string, unknown> = {};
  return { cargados, w, m: crearMedicion(config, { ventana: w, cargarScript: (s) => cargados.push(s) }) };
}
const comandos = (w: Record<string, unknown>): unknown[][] => ((w['dataLayer'] as ArrayLike<unknown>[] | undefined) ?? []).map((a) => Array.from(a));

describe('medición sin consentimiento', () => {
  it('no descarga NINGÚN script de Google, Meta ni TikTok', () => {
    const { cargados, m, w } = montar();
    m.iniciar(null);
    m.evento('vista_producto', { id: 'tv-1', nombre: 'TV' });
    m.evento('clic_comprar', { id: 'tv-1', nombre: 'TV' });
    m.evento('envio_formulario');
    expect(cargados).toEqual([]);
    expect(w['fbq']).toBeUndefined();
    expect(w['ttq']).toBeUndefined();
  });

  it('rechazar todo tampoco carga nada', () => {
    const { cargados, m } = montar();
    m.iniciar(SIN_CONSENTIMIENTO);
    expect(cargados).toEqual([]);
  });

  it('Consent Mode v2: el estado inicial es «denegado» y solo vive en memoria', () => {
    const { m, w, cargados } = montar();
    m.iniciar(null);
    expect(comandos(w)).toEqual([['consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied', wait_for_update: 500 }]]);
    expect(cargados).toHaveLength(0);
  });

  it('sin identificadores configurados no hay nada que hacer', () => {
    const { m, w, cargados } = montar({ google: null, searchConsole: null, meta: null, tiktok: null });
    m.iniciar(TODO_ACEPTADO);
    m.evento('vista_producto', { id: 'x-1' });
    expect(cargados).toEqual([]);
    expect(w['dataLayer']).toBeUndefined();
  });
});

describe('medición por categoría', () => {
  it('solo analítica: carga Google y no Meta ni TikTok; las señales de publicidad siguen denegadas', () => {
    const { m, w, cargados } = montar();
    m.iniciar(null);
    m.aplicar({ analitica: true, marketing: false });
    expect(cargados).toEqual([`${URL_GOOGLE}?id=G-EJEMPLO00`]);
    const upd = comandos(w).find((c) => c[0] === 'consent' && c[1] === 'update');
    expect(upd?.[2]).toEqual({ ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' });
    m.evento('vista_producto', { id: 'tv-1', nombre: 'TV' });
    expect(comandos(w).at(-1)).toEqual(['event', 'view_item', { items: [{ item_id: 'tv-1', item_name: 'TV' }] }]);
    expect(w['fbq']).toBeUndefined();
  });

  it('marketing: carga Meta y TikTok, y Google con señales de publicidad concedidas', () => {
    const { m, w, cargados } = montar();
    m.iniciar(TODO_ACEPTADO);
    expect(cargados).toEqual([
      `${URL_GOOGLE}?id=G-EJEMPLO00`,
      URL_META,
      `${URL_TIKTOK}?sdkid=CEJEMPLO0000EJEMPLO&lib=ttq`,
    ]);
    expect(w['fbq']).toBeTypeOf('function');
    expect(w['ttq']).toBeDefined();
  });

  it('no se carga dos veces aunque se aplique varias veces', () => {
    const { m, cargados } = montar();
    m.iniciar(TODO_ACEPTADO);
    m.aplicar(TODO_ACEPTADO);
    m.aplicar({ analitica: true, marketing: true });
    expect(cargados).toHaveLength(3);
  });

  it('solo marketing (sin analítica) también carga Google en modo de consentimiento parcial', () => {
    const { m, w } = montar();
    m.iniciar(null);
    m.aplicar({ analitica: false, marketing: true });
    const upd = comandos(w).find((c) => c[0] === 'consent' && c[1] === 'update');
    expect(upd?.[2]).toMatchObject({ ad_storage: 'granted', analytics_storage: 'denied' });
  });

  it('revocar vuelve a «denegado» y deja de enviar eventos', () => {
    const { m, w } = montar();
    m.iniciar(TODO_ACEPTADO);
    m.aplicar(SIN_CONSENTIMIENTO);
    const antes = comandos(w).length;
    m.evento('clic_comprar', { id: 'tv-1', nombre: 'TV' });
    expect(comandos(w)).toHaveLength(antes);
    const ultimo = comandos(w).filter((c) => c[1] === 'update').at(-1);
    expect(ultimo?.[2]).toEqual({ ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
    expect((w['ttq'] as unknown[]).some((x) => Array.isArray(x) && x[0] === 'revokeConsent')).toBe(true);
  });

  it('los eventos llevan solo código y nombre del producto, con los nombres de cada plataforma', () => {
    const { m, w } = montar();
    m.iniciar(TODO_ACEPTADO);
    m.evento('vista_producto', { id: 'tv-1', nombre: 'TV' });
    m.evento('clic_comprar', { id: 'tv-1', nombre: 'TV' });
    m.evento('envio_formulario');
    const g = comandos(w).filter((c) => c[0] === 'event').map((c) => c[1]);
    expect(g).toEqual(['view_item', 'clic_comprar', 'generate_lead']);
    const fbq = w['fbq'] as { queue?: unknown[][] };
    const meta = (fbq.queue ?? []).filter((c) => c[0] === 'track').map((c) => c[1]);
    expect(meta).toEqual(['PageView', 'ViewContent', 'InitiateCheckout', 'Lead']);
    const tiktok = (w['ttq'] as unknown[][]).filter((c) => Array.isArray(c) && c[0] === 'track').map((c) => c[1]);
    expect(tiktok).toEqual(['ViewContent', 'ClickButton', 'SubmitForm']);
    expect(JSON.stringify(comandos(w))).not.toMatch(/@|tel|correo/i);
  });

  it('el stub de TikTok expone instance() con los métodos diferidos', () => {
    const { m, w } = montar();
    m.iniciar(TODO_ACEPTADO);
    const inst = (w['ttq'] as unknown as { instance(id: string): Record<string, (...a: unknown[]) => void> & unknown[] }).instance('CEJEMPLO0000EJEMPLO');
    inst['track']?.('x');
    expect(Array.from(inst)).toEqual([['track', 'x']]);
  });
});

describe('consentimiento guardado', () => {
  it('es null hasta que la persona decide, y se recuerda por categoría', () => {
    const a = almacenMemoria();
    expect(leerConsentimiento(a)).toBeNull();
    guardarConsentimiento(a, { analitica: true, marketing: false });
    expect(leerConsentimiento(a)).toEqual({ analitica: true, marketing: false });
  });
  it('un valor dañado o de otra versión se trata como «sin decidir»', () => {
    const a = almacenMemoria();
    a.setItem('cb.consentimiento', '{no json');
    expect(leerConsentimiento(a)).toBeNull();
    a.setItem('cb.consentimiento', JSON.stringify({ v: 2, analitica: true, marketing: true }));
    expect(leerConsentimiento(a)).toBeNull();
    a.setItem('cb.consentimiento', JSON.stringify({ v: 1, analitica: 'si', marketing: true }));
    expect(leerConsentimiento(a)).toBeNull();
  });
});
