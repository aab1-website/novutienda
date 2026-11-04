import { useEffect, useState } from 'preact/hooks';
import { EVENTOS, escuchar } from '../lib/eventos.js';
import { guardarConsentimiento, leerConsentimiento, SIN_CONSENTIMIENTO, TODO_ACEPTADO, type Consentimiento as Decision } from '../medicion/consentimiento.js';
import { almacenLocal, medicionGlobal } from './navegador.js';

/**
 * Aviso de cookies y medición, por categoría. «Solo lo necesario» pesa lo mismo que «Aceptar todo».
 * Sin decisión no se mide nada. La persona puede cambiarla en cualquier momento desde el pie.
 */
export default function Consentimiento() {
  const [visible, setVisible] = useState(false);
  const [detalle, setDetalle] = useState(false);
  const [elegido, setElegido] = useState<Decision>(SIN_CONSENTIMIENTO);

  useEffect(() => {
    const guardada = leerConsentimiento(almacenLocal());
    medicionGlobal(); // aplica la decisión guardada (o nada)
    if (guardada === null) setVisible(true);
    else setElegido(guardada);
    return escuchar<void>(EVENTOS.abrirConsentimiento, () => {
      setElegido(leerConsentimiento(almacenLocal()) ?? SIN_CONSENTIMIENTO);
      setDetalle(true);
      setVisible(true);
    });
  }, []);

  const decidir = (d: Decision): void => {
    guardarConsentimiento(almacenLocal(), d);
    medicionGlobal().aplicar(d);
    setElegido(d);
    setVisible(false);
    setDetalle(false);
  };

  return (
    <>
      <button type="button" class="enlace-boton" onClick={() => { setElegido(leerConsentimiento(almacenLocal()) ?? SIN_CONSENTIMIENTO); setDetalle(true); setVisible(true); }}>
        Preferencias de cookies
      </button>
      {visible && (
        <section class="consentimiento" role="dialog" aria-modal="false" aria-labelledby="titulo-consentimiento">
          <h2 id="titulo-consentimiento" class="consentimiento-titulo">Cookies y medición</h2>
          <p>
            Usamos medición de Google, Meta y TikTok para saber qué páginas te ayudan y mejorar la publicidad. Solo se activa si lo aceptas;
            si no, el sitio funciona igual. <a href="/privacidad">Cómo tratamos tus datos</a>.
          </p>
          {detalle && (
            <fieldset class="consentimiento-categorias">
              <legend class="solo-lectores">Categorías de medición</legend>
              <label><input type="checkbox" checked disabled /> Necesarias (siempre activas): recuerdan tu país, tema y carrito.</label>
              <label><input type="checkbox" checked={elegido.analitica} onChange={(e) => setElegido({ ...elegido, analitica: (e.target as HTMLInputElement).checked })} /> Analítica: Google Analytics.</label>
              <label><input type="checkbox" checked={elegido.marketing} onChange={(e) => setElegido({ ...elegido, marketing: (e.target as HTMLInputElement).checked })} /> Marketing: píxeles de Meta y TikTok, y señales de publicidad de Google.</label>
            </fieldset>
          )}
          <div class="consentimiento-acciones">
            <button type="button" class="boton boton-secundario" onClick={() => decidir(SIN_CONSENTIMIENTO)}>Solo lo necesario</button>
            {detalle ? (
              <button type="button" class="boton boton-secundario" onClick={() => decidir(elegido)}>Guardar mi elección</button>
            ) : (
              <button type="button" class="boton boton-secundario" onClick={() => setDetalle(true)}>Personalizar</button>
            )}
            <button type="button" class="boton boton-cta" onClick={() => decidir(TODO_ACEPTADO)}>Aceptar todo</button>
          </div>
        </section>
      )}
    </>
  );
}
