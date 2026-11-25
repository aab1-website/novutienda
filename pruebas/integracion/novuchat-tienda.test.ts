import { describe, expect, it } from 'vitest';
import { coordenadasDeMapa, enlaceMapaSeguro, MAX_TEXTO_TIENDA, textoTienda, tiendaPublicada } from '../../plataforma/funciones/servidor/http/novuchat.js';

const LARGO = "https://www.google.com/maps/place/22%C2%B043'56.8%22S/@-22.7324562,-64.3502617,17z/data=!3m1!4b1!4m4!3m3!8m2!3d-22.7324562!4d-64.3476868?hl=es";

describe('tienda del catálogo NovuChat', () => {
  it('texto: colapsa espacios y saltos, vacío es null, corta en palabra con «…»', () => {
    expect(textoTienda('  Barrio 27\nde Mayo  ')).toBe('Barrio 27 de Mayo');
    expect(textoTienda('   ')).toBeNull();
    expect(textoTienda(42)).toBeNull();
    const largo = textoTienda(`${'a'.repeat(150)} ${'b'.repeat(100)}`)!;
    expect(largo.length).toBeLessThanOrEqual(MAX_TEXTO_TIENDA);
    expect(largo.endsWith('a…')).toBe(true);
  });

  it('enlace: solo https de Google Maps', () => {
    expect(enlaceMapaSeguro('https://maps.app.goo.gl/AbC123')).toBe('https://maps.app.goo.gl/AbC123');
    expect(enlaceMapaSeguro(LARGO)).toBe(LARGO);
    expect(enlaceMapaSeguro('http://maps.app.goo.gl/AbC123')).toBeNull();
    expect(enlaceMapaSeguro('https://www.google.com/url?q=https://malo.example')).toBeNull();
    expect(enlaceMapaSeguro('https://evil.example/maps')).toBeNull();
    expect(enlaceMapaSeguro('https://user:x@maps.app.goo.gl/a')).toBeNull();
    expect(enlaceMapaSeguro('https://goo.gl/xyz')).toBeNull();
    expect(enlaceMapaSeguro(undefined)).toBeNull();
  });

  it('coordenadas: prefiere el punto exacto (!3d!4d) sobre el centro del mapa (@); el enlace corto no trae', () => {
    expect(coordenadasDeMapa(LARGO)).toEqual({ lat: -22.7324562, lng: -64.3476868 });
    expect(coordenadasDeMapa('https://www.google.com/maps/@-16.5,-68.15,15z')).toEqual({ lat: -16.5, lng: -68.15 });
    expect(coordenadasDeMapa('https://maps.app.goo.gl/AbC123')).toBeNull();
    expect(coordenadasDeMapa(null)).toBeNull();
  });

  it('tiendaPublicada: todo null sin negocio; arma los cinco campos con negocio', () => {
    expect(tiendaPublicada(undefined)).toEqual({ nombre: null, direccion: null, enlaceMapa: null, coordenadas: null, horario: null });
    expect(tiendaPublicada({ nombre: 'Tienda', direccion: 'Calle 1', horario: 'L a S', mapa: 'https://maps.app.goo.gl/AbC123' }))
      .toEqual({ nombre: 'Tienda', direccion: 'Calle 1', enlaceMapa: 'https://maps.app.goo.gl/AbC123', coordenadas: null, horario: 'L a S' });
    expect(tiendaPublicada({ mapa: 'javascript:alert(1)' })['enlaceMapa']).toBeNull();
  });
});
