import js from '@eslint/js';
import sonarjs from 'eslint-plugin-sonarjs';
import meteor from 'eslint-plugin-meteor';
import {fixupPluginRules} from '@eslint/compat';
import globals from 'globals';

export default [
  js.configs.recommended,
  sonarjs.configs.recommended,
  {
    plugins: {
      meteor: fixupPluginRules(meteor)
    },
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.meteor,
        console: true
      }
    },
    rules: {
      // SonarJS
      'sonarjs/cognitive-complexity': ['error', 50],
      'sonarjs/no-identical-functions': 'off',
      'sonarjs/todo-tag': 'off',
      'sonarjs/no-clear-text-protocols': 'off',
      'sonarjs/no-hardcoded-passwords': 'off',
      'sonarjs/pseudo-random': 'off',
      'sonarjs/constructor-for-side-effects': 'off',

      // General
      'no-console': 'off',
      'no-redeclare': ['error', {builtinGlobals: false}],
      'no-unused-vars': ['error', {caughtErrors: 'none', argsIgnorePattern: '^_'}],
      'indent': ['error', 2],
      'max-len': ['error', {code: 160}],
      'no-multiple-empty-lines': ['error', {max: 2}],
      'no-var': 'warn',
      'comma-dangle': ['error', 'never'],
      'quotes': ['warn', 'single'],

      // Meteor
      'meteor/audit-argument-checks': 'off',
      'meteor/no-session': 'off',
      'meteor/eventmap-params': ['error', {
        eventParamName: 'event',
        templateInstanceParamName: 'instance'
      }],
      'meteor/template-names': 'off'
    }
  },
  {
    files: ['**/*.spec.js', '**/*.test.js'],
    languageOptions: {
      globals: {
        ...globals.mocha,
        ...globals.jest
      }
    }
  },
  {
    ignores: [
      'node_modules/',
      '.meteor/',
      'packages/',
      'public/',
      'tests/',
      'test_api/',
      'tools/',
      'docker/',
      'client/vendor/',
      'imports/lib/vendor/',
      '**/*.less',
      '**/*.html',
      '**/*.json'
    ]
  }
];
