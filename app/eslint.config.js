// Ported from Le-Space/simple-todo apps/invoice01 (eslint.config.js) at 56647d5.
// Changed: no build-time globals, because this app defines none.
import prettier from 'eslint-config-prettier';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import svelteConfig from './svelte.config.js';
import belege from './eslint/no-german.js';

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

/** @type {import('eslint').Linter.Config[]} */
export default [
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: { svelteConfig }
		}
	},
	{
		// Text people read comes from the catalogue, in German and English (#192).
		files: ['src/**/*.js', 'src/**/*.svelte'],
		ignores: ['src/lib/i18n/**', '**/*.spec.js'],
		plugins: { belege },
		rules: { 'belege/no-german': 'error' }
	}
];
