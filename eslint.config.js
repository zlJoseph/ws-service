import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default await tseslint.config({
	extends: [
		js.configs.recommended,
		...tseslint.configs.recommended,
		...tseslint.configs.recommendedTypeChecked,
		prettier,
	],
	files: ['src/**/*.ts'],
	ignores: ['src/infrastructure/whatsapp/**'], // ignorar esta ruta
	languageOptions: {
		parserOptions: {
			project: ['./tsconfig.json'],
			tsconfigRootDir: process.cwd(),
		},
	},
	rules: {
		'@typescript-eslint/no-unused-vars': ['warn'],
		'@typescript-eslint/explicit-function-return-type': 'off',
		'@typescript-eslint/no-explicit-any': 'warn',
		'@typescript-eslint/consistent-type-imports': 'error',
		'no-console': 'warn',
	},
});
