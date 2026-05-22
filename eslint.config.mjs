import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/out/**',
      '**/coverage/**',
      '**/prisma/migrations/**',
      'apps/web/next-env.d.ts',
      'apps/web/postcss.config.js',
      'apps/web/tailwind.config.ts',
      // Plugin code is third-party-shaped CommonJS that runs in a vm sandbox
      // with its own globals (console-via-logger, no real `require`). Linting
      // it under host rules produces false positives.
      'plugins/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'warn',
    },
  },
);
