import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['pruebas/**/*.test.ts', 'paquetes/*/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '.claude/worktrees/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['paquetes/*/src/**/*.ts', 'plataforma/coordinador/**/*.ts', 'plataforma/conectores/**/*.ts', 'pruebas/fronteras/verificador.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
      thresholds: { lines: 70, statements: 70, functions: 70, branches: 70 },
    },
  },
});
