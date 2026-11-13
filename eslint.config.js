// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'coverage/*', 'supabase/functions/*', '.expo/*'],
  },
  {
    rules: {
      // Segurança e qualidade (AGENTS.md seções 5 e 7)
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      eqeqeq: ['error', 'always'],
      'no-restricted-syntax': [
        'error',
        {
          selector: "Identifier[name='service_role']",
          message: 'service_role jamais pode aparecer no código do app (SECURITY.md SEC-15).',
        },
        {
          selector: 'Literal[value=/service_role|SERVICE_ROLE/]',
          message: 'service_role jamais pode aparecer no código do app (SECURITY.md SEC-15).',
        },
      ],
    },
  },
  {
    files: ['src/lib/security-meta.test.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
]);
