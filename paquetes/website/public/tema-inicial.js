/* global document */
// Aplica el tema elegido antes del primer pintado, para evitar el destello. Sin elección guardada
// no hace nada y la hoja de estilos sigue al dispositivo (prefers-color-scheme).
(function () {
  try {
    var t = localStorage.getItem('cb.tema');
    if (t === 'claro' || t === 'oscuro') document.documentElement.dataset.tema = t;
  } catch {
    /* almacenamiento bloqueado: se sigue al dispositivo */
  }
})();
