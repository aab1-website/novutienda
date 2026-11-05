// Aplica el tema elegido antes de pintar (evita el parpadeo). Archivo propio: la CSP no admite scripts en línea.
try {
  const t = globalThis.localStorage.getItem('panel.tema');
  if (t === 'claro' || t === 'oscuro') globalThis.document.documentElement.setAttribute('data-tema', t);
} catch {
  // sin almacenamiento: se usa el tema del dispositivo
}
