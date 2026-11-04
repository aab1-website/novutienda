import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

// `humo` compila con los dobles en memoria (sin Firebase) para las pruebas de navegador; cualquier otro modo es la
// versión real. La salida va fuera del paquete (dist/ de la raíz ya está ignorado por git y ESLint).
export default defineConfig(({ mode }) => ({
  plugins: [preact()],
  build: {
    outDir: mode === 'humo' ? '../../dist/panel-humo' : '../../dist/panel',
    emptyOutDir: true,
    // Nada se incrusta en el HTML: la CSP no admite scripts ni estilos en línea.
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    sourcemap: false,
  },
}));
