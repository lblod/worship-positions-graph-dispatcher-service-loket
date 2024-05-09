const js = require('@eslint/js');
const qunitPlugin = require('eslint-plugin-qunit/configs/recommended');
const eslintConfigPrettier = require('eslint-config-prettier');
const stylisticJs = require('@stylistic/eslint-plugin-js');

const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      '@stylistic/js': stylisticJs,
    },
    rules: {
      indent: ['error', 2, { SwitchCase: 1 }],
      'linebreak-style': ['error', 'unix'],
      '@stylistic/js/quotes': ['error', 'single'],
      semi: ['error', 'always'],
    },
  },
  {
    ignores: [
      '/dist/',
      '/tmp/',
      '/bower_components/',
      '/node_modules/',
      '/coverage/',
      '!.*',
      '.*/',
      '.eslintcache',
      'eslint.config.js',
      '/test/setup.js',
    ],
  },
  //qunitPlugin,
  eslintConfigPrettier,
  eslintPluginPrettierRecommended,
];
