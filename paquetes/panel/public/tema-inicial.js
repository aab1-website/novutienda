// Aplica el tema elegido antes de pintar (evita el parpadeo). Archivo propio: la CSP no admite scripts en línea.
try {
  var t = localStorage.getItem('panel.tema');
  if (t === 'claro' || t === 'oscuro') document.documentElement.setAttribute('data-tema', t);
} catch (e) {
  /* sin almacenamiento: se usa el tema del dispositivo */
}
