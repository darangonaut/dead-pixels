import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    files: ['**/*.ts'],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
  },
  {
    // Herná logika je čistý TypeScript bez PixiJS a DOM (testovateľná vo Vitest).
    files: ['src/game/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['pixi.js', 'pixi.js/*'], message: 'Logika nesmie importovať PixiJS.' },
            {
              group: ['@/render/*', '@/ui/*', '@/input/*', '@/audio/*'],
              message: 'Logika nesmie závisieť od vyšších vrstiev.',
            },
          ],
        },
      ],
    },
  },
);
