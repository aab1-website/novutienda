// API HTTP contra el emulador: rutas públicas del sitio, API de NovuChat (catálogo, inventario, pedido firmado)
// y endpoints firmados de reconstrucción del sitio.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { esperar, firmar, hayEmulador, herramientas, http, sembrarTenant, T, TENANT_TODO_ENCENDIDO, unico, type Herramientas } from './ayudas.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const sha256 = (t: string): string => createHash('sha256').update(t).digest('hex');
const secretoPedidos = process.env['NOVUCHAT_PEDIDOS_SECRETO'] ?? '';
const secretoSitio = process.env['SITIO_RECONSTRUCCION_SECRETO'] ?? '';

describe.skipIf(!hayEmulador)('API HTTP (emulador)', () => {
  let h: Herramientas;
  const prod = unico('api-lapiz').toLowerCase();
  const prodSinControl = unico('api-servicio').toLowerCase();
  const token = randomBytes(24).toString('hex');

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, T, {
      productos: [
        { id: prod, nombre: 'Lápiz API', precioUSD: { bo: 1000, ar: 2000 }, tienda: 10 },
        { id: prodSinControl, nombre: 'Servicio API', precioUSD: { bo: 500, ar: 500 }, tienda: 0, controlaStock: false },
      ],
    });
    // Copia publicada (la escribe `publicarSitio`) con una foto procesada.
    await h.firestore.doc(`tenants/${T}/publicado/producto__${prodSinControl}`).set({
      id: prodSinControl, slug: 'servicio-api', nombre: 'Servicio API', categoria: 'general', descripcion: 'Sin control de stock', garantia: '', medios: [],
      seo: { titulo: 't', descripcion: 'd' }, precioUSD: { bo: 5, ar: 5 },
    });
    await h.firestore.doc(`tenants/${T}/publicado/producto__${prod}`).set({
      id: prod, slug: 'lapiz-api', nombre: 'Lápiz API', categoria: 'general', descripcion: 'Lápiz de prueba', garantia: '', medios: [
        { tipo: 'foto', alt: 'Lápiz', ancho: 1000, alto: 800, versiones: [
          { clase: 'imagen', lado: 480, formato: 'webp', ruta: `tenants/${T}/publico/medios/${prod}/aaa-imagen480.webp` },
          { clase: 'imagen', lado: 960, formato: 'webp', ruta: `tenants/${T}/publico/medios/${prod}/bbb-imagen960.webp` },
        ] },
      ], seo: { titulo: 't', descripcion: 'd' }, precioUSD: { bo: 10, ar: 20 },
    });
    // Token del tenant: solo se guarda su SHA-256 (rotación: hasta dos documentos activos).
    await h.firestore.doc(`novuchatTokens/${sha256(token)}`).set({ tenantId: T, hash: sha256(token), activo: true });
  });

  it('sonda de salud: /api/salud (pública) y /healthz (emulador)', async () => {
    for (const ruta of ['/api/salud', '/healthz']) {
      const r = await http(ruta);
      expect(r.status).toBe(200);
      expect(r.texto).toBe('ok');
    }
  });

  it('toda respuesta lleva HSTS y nosniff, también las de error (Hosting solo las agrega a las 2xx reescritas)', async () => {
    for (const [ruta, estado] of [['/api/no-existe', 404], ['/api/salud', 200]] as const) {
      const r = await http(ruta);
      expect(r.status).toBe(estado);
      expect(r.cabeceras.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
      expect(r.cabeceras.get('x-content-type-options')).toBe('nosniff');
    }
  });

  describe('rutas públicas del sitio', () => {
    it('cotización vigente', async () => {
      const r = await http('/api/cotizacion?mercado=BO');
      expect(r.status).toBe(200);
      expect(r.cuerpo).toMatchObject({ cotizaciones: { BO: { par: 'BOB/USD', valor: 7, estado: 'vigente' } } });
      expect((await http('/api/cotizacion?mercado=XX')).status).toBe(400);
    });

    it('disponibilidad: solo disponible o agotado', async () => {
      const r = await http(`/api/disponibilidad?ids=${prod},no-existe-xx`);
      expect(r.status).toBe(200);
      expect(r.cuerpo).toEqual({ disponibilidad: { [prod]: 'disponible' } });
      expect(r.texto).not.toMatch(/cantidad|stock/);
    });

    it('contacto: App Check antes del límite, reCAPTCHA, idempotencia y límite de tasa', async () => {
      const origen = `203.0.113.${String(Math.floor(Math.random() * 200) + 1)}`;
      const envioId = unico('envio').padEnd(20, 'x');
      const cuerpo = { envioId, nombre: 'Ana Pérez', correo: 'ana@ejemplo.test', mensaje: 'Quisiera una cotización', aceptaPrivacidad: true, recaptchaToken: 'simulado-humano-xxxxxxxxxxxxxxxx' };
      // Cadena como la arma Hosting: lo que escribe el cliente, su IP vista por Fastly y la de Fastly vista por el GFE.
      const cadena = `9.9.9.9, ${origen}, 151.101.1.1`;
      const enviar = (c: unknown, extra: Record<string, string> = {}) =>
        http('/api/contacto', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': cadena, 'x-firebase-appcheck': 'simulado-valido', ...extra }, body: JSON.stringify(c) });

      // Sin token de App Check (ni con `fastly-client-ip` falsificada): 401 y el límite NO se consume.
      for (let i = 0; i < 5; i += 1) {
        const sin = await http('/api/contacto', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': cadena, 'fastly-client-ip': '8.8.8.8' }, body: JSON.stringify(cuerpo) });
        expect(sin.status).toBe(401);
      }

      const bot = await enviar({ ...cuerpo, recaptchaToken: 'simulado-bot-xxxxxxxxxxxxxxxxx' }); // 1.º del límite
      expect(bot.status).toBe(403);

      const ok = await enviar(cuerpo); // 2.º
      expect(ok.status).toBe(200);
      expect(ok.cuerpo).toEqual({ ok: true, repetido: false });
      const doc = (await h.firestore.doc(`tenants/${T}/contactos/${envioId}`).get()).data();
      expect(doc).toMatchObject({ nombre: 'Ana Pérez', pais: null });

      const repetido = await enviar(cuerpo); // 3.º
      expect(repetido.cuerpo).toEqual({ ok: true, repetido: true });

      // Cambiar `fastly-client-ip` o anteponer valores en X-Forwarded-For no cambia de cubo: el origen es el último salto confiable.
      const falsificado = await enviar(cuerpo, { 'fastly-client-ip': '8.8.4.4', 'x-forwarded-for': `7.7.7.7, 6.6.6.6, ${origen}, 151.101.1.1` });
      expect(falsificado.status).toBe(429); // 4.º: más de CONTACTO_MAXIMO (3) en la ventana
      expect(falsificado.cabeceras.get('retry-after')).toMatch(/^\d+$/);
      // El origen se guarda con hash salado, nunca en claro.
      const claves = (await h.firestore.collection('limitesTasa').get()).docs.map((d) => d.id);
      expect(claves.some((c) => c.includes(origen))).toBe(false);
      expect(claves.every((c) => /^[0-9a-f]{64}$/.test(c))).toBe(true);
    });
  });

  describe('NovuChat: catálogo e inventario', () => {
    const auth = { authorization: `Bearer ${token}` };

    it('sin credencial o con una inválida → 401', async () => {
      const a = await http('/api/novuchat/v1/catalogo?mercado=BO');
      expect(a.status).toBe(401);
      expect(a.cuerpo).toEqual({ error: 'sin_credencial' });
      const b = await http('/api/novuchat/v1/catalogo?mercado=BO', { headers: { authorization: 'Bearer ' + randomBytes(24).toString('hex') } });
      expect(b.status).toBe(401);
      expect(b.cuerpo).toEqual({ error: 'credencial_invalida' });
      // Un token desactivado (rotación) deja de valer.
      const viejo = randomBytes(16).toString('hex');
      await h.firestore.doc(`novuchatTokens/${sha256(viejo)}`).set({ tenantId: T, hash: sha256(viejo), activo: false });
      expect((await http('/api/novuchat/v1/catalogo?mercado=BO', { headers: { authorization: `Bearer ${viejo}` } })).status).toBe(401);
    });

    it('200 con precio final por mercado, stock de tienda y ETag; 304 con If-None-Match', async () => {
      const r = await http('/api/novuchat/v1/catalogo?mercado=BO', { headers: auth });
      expect(r.status).toBe(200);
      expect(r.cabeceras.get('cache-control')).toBe('private, max-age=60');
      const c = r.cuerpo as { version: number; mercado: string; moneda: string; cotizacion: { valor: number; estado: string }; items: Record<string, unknown>[] };
      expect(c).toMatchObject({ version: 1, mercado: 'BO', moneda: 'BOB', cotizacion: { par: 'BOB/USD', valor: 7, estado: 'vigente' } });
      const item = c.items.find((i) => i['id'] === prod);
      expect(item).toMatchObject({
        nombre: 'Lápiz API', precio: 70, precioCentavos: 7000, moneda: 'BOB', stock: 10, activo: true, area: 'general',
        foto: `https://medios.ejemplo.test/tenants/${T}/publico/medios/${prod}/bbb-imagen960.webp`, urlProducto: 'https://sitio.ejemplo.test/producto/lapiz-api',
        stockPorAlmacen: { tienda: 10, 'deposito-1': 0, 'deposito-2': 0 },
      });
      expect(item).toMatchObject({ disponible: true });
      // Sin control de stock: disponible (no `stock: 0`, que se leería como agotado).
      expect(c.items.find((i) => i['id'] === prodSinControl)).toMatchObject({ stock: null, disponible: true, activo: true });
      const etag = r.cabeceras.get('etag');
      expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
      const igual = await http('/api/novuchat/v1/catalogo?mercado=BO', { headers: { ...auth, 'if-none-match': etag ?? '' } });
      expect(igual.status).toBe(304);
      expect(igual.texto).toBe('');
      // En Argentina el precio sale de la lista AR (20 USD × 1000 = 20 000 ARS, múltiplo de 100).
      const ar = (await http('/api/novuchat/v1/catalogo?mercado=AR', { headers: auth })).cuerpo as { items: Record<string, unknown>[] };
      expect(ar.items.find((i) => i['id'] === prod)).toMatchObject({ precio: 20_000, moneda: 'ARS' });
      expect((await http('/api/novuchat/v1/catalogo?mercado=XX', { headers: auth })).status).toBe(400);
      expect((await http('/api/novuchat/v1/catalogo?mercado=BO', { method: 'POST', headers: auth })).status).toBe(405);
    });

    it('inventario de solo lectura: existencias por almacén y sin costos', async () => {
      const r = await http('/api/novuchat/v1/inventario', { headers: auth });
      expect(r.status).toBe(200);
      const item = (r.cuerpo as { items: Record<string, unknown>[] }).items.find((i) => i['id'] === prod);
      expect(item).toMatchObject({ stockTotal: 10, stockPorAlmacen: { tienda: 10, 'deposito-1': 0, 'deposito-2': 0 } });
      expect(r.texto).not.toMatch(/costo/i);
    });
  });

  describe('NovuChat: pedido firmado', () => {
    const enviar = (cuerpo: string, o: { marca?: string; firma?: string } = {}) => {
      const marca = o.marca ?? String(Date.now());
      return http('/api/novuchat/v1/pedidos/confirmar', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-marca-tiempo': marca, 'x-firma': o.firma ?? firmar(secretoPedidos, marca, cuerpo) },
        body: cuerpo,
      });
    };
    const pedido = (id: string, cantidad: number): string =>
      JSON.stringify({ pedidoId: id, items: [{ productoId: prod, cantidad }], confirmadoEn: new Date().toISOString() });

    it('200 la primera vez y 200 repetido (idempotente por pedidoId); descuenta de tienda una sola vez', async () => {
      const id = unico('PED').toUpperCase();
      const antes = (await h.firestore.doc(`tenants/${T}/existencias/${prod}__tienda`).get()).data()?.['cantidad'] as number;
      const a = await enviar(pedido(id, 2));
      expect(a.status, a.texto).toBe(200);
      expect(a.cuerpo).toMatchObject({ ok: true, operacionId: `nc-${id}`, repetida: false });
      const b = await enviar(pedido(id, 2));
      expect(b.status).toBe(200);
      expect(b.cuerpo).toMatchObject({ repetida: true });
      expect((await h.firestore.doc(`tenants/${T}/existencias/${prod}__tienda`).get()).data()?.['cantidad']).toBe(antes - 2);
      // Mismo pedido con otro contenido: conflicto.
      expect((await enviar(pedido(id, 3))).status).toBe(409);
    });

    it('401 con firma inválida, marca vencida o sin cabeceras', async () => {
      const c = pedido(unico('PED'), 1);
      expect((await enviar(c, { firma: 'a'.repeat(64) })).status).toBe(401);
      const vieja = String(Date.now() - 6 * 60_000);
      expect((await enviar(c, { marca: vieja })).status).toBe(401);
      const sin = await http('/api/novuchat/v1/pedidos/confirmar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: c });
      expect(sin.status).toBe(401);
      // Cuerpo alterado después de firmar.
      const marca = String(Date.now());
      const alterado = await enviar(c.replace('"cantidad":1', '"cantidad":9'), { marca, firma: firmar(secretoPedidos, marca, c) });
      expect(alterado.status).toBe(401);
    });

    it('409 con faltantes cuando no alcanza el stock, sin escribir el pedido', async () => {
      const id = unico('PED');
      const r = await enviar(pedido(id, 9999));
      expect(r.status).toBe(409);
      expect(r.cuerpo).toMatchObject({ ok: false, error: 'stock-insuficiente', faltantes: [{ productoId: prod, almacenId: 'tienda', pedido: 9999 }] });
      expect((await h.firestore.doc(`tenants/${T}/operaciones/nc-${id}`).get()).exists).toBe(false);
    });

    it('400 con cuerpo mal formado (firma válida)', async () => {
      const r = await enviar(JSON.stringify({ pedidoId: 'x', items: [], confirmadoEn: 'ayer' }));
      expect(r.status).toBe(400);
      expect((await http('/api/novuchat/v1/pedidos/confirmar')).status).toBe(405);
    });
  });

  describe('reconstrucción del sitio (endpoint firmado)', () => {
    const firmado = (metodo: string, ruta: string, cuerpo = '') => {
      const marca = String(Date.now());
      const texto = `${metodo}\n${ruta}\n${cuerpo}`;
      return http(ruta, { method: metodo, headers: { 'content-type': 'application/json', 'x-marca-tiempo': marca, 'x-firma': firmar(secretoSitio, marca, texto) }, ...(cuerpo !== '' ? { body: cuerpo } : {}) });
    };

    it('lista los trabajos pendientes y los hace avanzar una sola vez', async () => {
      const id = unico('rec');
      await h.firestore.doc(`tenants/${T}/reconstrucciones/${id}`).set({ estado: 'pendiente', version: 3, motivo: 'publicacion', solicitadaEnMs: Date.now() });
      const lista = await firmado('GET', `/api/sitio/v1/reconstrucciones?tenantId=${T}`);
      expect(lista.status, lista.texto).toBe(200);
      expect((lista.cuerpo as { trabajos: { id: string }[] }).trabajos.map((t) => t.id)).toContain(id);
      const a = await firmado('POST', `/api/sitio/v1/reconstrucciones/${id}/estado`, JSON.stringify({ tenantId: T, estado: 'en_curso' }));
      expect(a.status, a.texto).toBe(200);
      expect((await firmado('POST', `/api/sitio/v1/reconstrucciones/${id}/estado`, JSON.stringify({ tenantId: T, estado: 'pendiente' }))).status).toBe(409);
      const fin = await firmado('POST', `/api/sitio/v1/reconstrucciones/${id}/estado`, JSON.stringify({ tenantId: T, estado: 'completada' }));
      expect(fin.status).toBe(200);
      const docs = await esperar(async () => (await h.firestore.doc(`tenants/${T}/reconstrucciones/${id}`).get()).data()?.['estado'] === 'completada', 5000, 'estado completada');
      expect(docs).toBe(true);
      const pub = await firmado('GET', `/api/sitio/v1/publicado?tenantId=${T}`);
      expect(pub.status).toBe(200);
      expect(Object.keys((pub.cuerpo as { documentos: object }).documentos)).toContain(`producto__${prod}`);
      // Sin documento de configuración rige la política vigente (BOB 2 decimales; ARS múltiplo de 100).
      expect((pub.cuerpo as { redondeo: unknown }).redondeo).toEqual({
        BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' }, ARS: { tipo: 'multiplo', multiplo: 100, modo: 'cercano' },
      });
    });

    it('el publicado entrega el redondeo configurado en tenants/{t}/config/redondeo', async () => {
      const t = unico('red').toLowerCase();
      const regla = { BOB: { tipo: 'decimales', decimales: 0, modo: 'arriba' }, ARS: { tipo: 'multiplo', multiplo: 500, modo: 'abajo' } };
      await h.firestore.doc(`tenants/${t}`).set(TENANT_TODO_ENCENDIDO); // L3-3: la API exige el documento del tenant
      await h.firestore.doc(`tenants/${t}/config/redondeo`).set(regla);
      const pub = await firmado('GET', `/api/sitio/v1/publicado?tenantId=${t}`);
      expect(pub.status, pub.texto).toBe(200);
      expect((pub.cuerpo as { redondeo: unknown }).redondeo).toEqual(regla);
    });

    it('401 sin firma válida', async () => {
      const r = await http(`/api/sitio/v1/reconstrucciones?tenantId=${T}`, { headers: { 'x-marca-tiempo': String(Date.now()), 'x-firma': 'b'.repeat(64) } });
      expect(r.status).toBe(401);
    });
  });

  describe('script de tokens de NovuChat', () => {
    const correr = (args: string[], entrada = '') =>
      spawnSync('node', ['plataforma/funciones/scripts/token-novuchat.mjs', ...args, '--proyecto', 'demo-pruebas'], { input: entrada, encoding: 'utf8', env: process.env });

    it('registra solo el hash, impone el tope de dos activos y desactiva sin imprimir el token', async () => {
      const t = unico('tok').toLowerCase();
      const a = randomBytes(24).toString('hex');
      const b = randomBytes(24).toString('hex');
      const c = randomBytes(24).toString('hex');
      const r1 = correr(['registrar', '--tenant', t], a);
      expect(r1.status, r1.stderr).toBe(0);
      expect(r1.stdout).toContain(sha256(a));
      expect(r1.stdout + r1.stderr).not.toContain(a);
      expect(correr(['registrar', '--tenant', t], b).status).toBe(0);
      expect(correr(['registrar', '--tenant', t], c).status).toBe(1); // tercer token activo
      expect(correr(['registrar', '--tenant', t], 'corto').status).toBe(1);
      expect(correr(['desactivar', '--hash', sha256(a)]).status).toBe(0);
      expect((await h.firestore.doc(`novuchatTokens/${sha256(a)}`).get()).data()).toMatchObject({ tenantId: t, hash: sha256(a), activo: false });
      expect(correr(['registrar', '--tenant', t], c).status).toBe(0);
      expect(correr(['listar', '--tenant', t]).stdout.trim().split('\n')).toHaveLength(3);
      expect(correr(['desactivar', '--hash', 'no-es-hash']).status).toBe(1);
      expect(correr(['otra']).status).toBe(1);
    });
  });
});
