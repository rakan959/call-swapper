import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

const reactHooksRecommendedRules = reactHooks.configs.recommended?.rules ?? {};

export default tseslint.config(
  {
    ignores: ['coverage', 'docs', 'dist', 'node_modules', '.stryker-tmp'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    extends: [...tseslint.configs.recommended, prettier],
    rules: {
      ...reactHooksRecommendedRules,
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': ['error', 'WithStatement'],
      'no-console': ['error', { allow: ['error', 'warn', 'info'] }],
    },
  },
);
