import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Red secundaria: la verificación principal de fronteras es pruebas/fronteras.
const sinProfundas = {
  group: ['@plataforma/*/src', '@plataforma/*/src/**', '**/src/**'],
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
            { group: ['@plataforma/*', '@tenant/*'], message: 'nucleo no depende de otros paquetes.' },
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
            { group: ['@plataforma/nucleo/*', '@tenant/*'], message: 'Use solo @plataforma/nucleo.' },
          ],
        },
      ],
    },
  },
  {
    // Los tenants: solo @plataforma/nucleo/extension.
    files: ['tenants/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            sinProfundas,
            { group: ['@plataforma/*', '!@plataforma/nucleo/extension'], message: 'Los tenants solo usan @plataforma/nucleo/extension.' },
          ],
        },
      ],
    },
  },
);
