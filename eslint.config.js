import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Red secundaria: la verificación principal de fronteras es pruebas/fronteras.
const sinProfundas = {
  group: ['@novutienda/*/src', '@novutienda/*/src/**', '**/src/**'],
  message: 'Importación profunda: use la entrada pública del paquete.',
};

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', '.tsbuild/**', 'node_modules/**', '**/node_modules/**', '.claude/worktrees/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-restricted-imports': ['error', { patterns: [sinProfundas] }],
    },
  },
  {
    // nucleo no importa ningún paquete interno.
    files: ['paquetes/nucleo/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            sinProfundas,
            { group: ['@novutienda/*', '@tenant/*'], message: 'nucleo no depende de otros paquetes.' },
          ],
        },
      ],
    },
  },
  {
    // Los demás paquetes: solo la entrada pública de nucleo (más lo que declare su manifiesto).
    files: ['paquetes/*/**/*.ts'],
    ignores: ['paquetes/nucleo/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            sinProfundas,
            // `/servidor` (Node) solo para módulos de lógica de servidor; panel y sitio lo prohíben abajo.
            { group: ['@novutienda/nucleo/*', '!@novutienda/nucleo/servidor', '@tenant/*'], message: 'Use solo @novutienda/nucleo (o @novutienda/nucleo/servidor en código de servidor).' },
          ],
        },
      ],
    },
  },
  {
    // Código que llega al navegador: solo la raíz de nucleo, sin Node.
    files: ['paquetes/panel/**/*.{ts,tsx}', 'paquetes/website/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            sinProfundas,
            { group: ['@novutienda/nucleo/*', '@tenant/*'], message: 'El navegador usa solo @novutienda/nucleo; lo que depende de Node va por @novutienda/nucleo/servidor, en el servidor.' },
          ],
        },
      ],
    },
  },
  {
    // Los tenants: solo @novutienda/nucleo/extension.
    files: ['tenants/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            sinProfundas,
            { group: ['@novutienda/*', '!@novutienda/nucleo/extension'], message: 'Los tenants solo usan @novutienda/nucleo/extension.' },
          ],
        },
      ],
    },
  },
);
