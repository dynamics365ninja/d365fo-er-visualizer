import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// Type-checking is tsc's job (`pnpm lint` runs both); ESLint is here for the
// rules tsc cannot express — above all the Rules of Hooks and effect
// dependencies, where a stale closure is a silent bug.
export default tseslint.config(
  { ignores: ['dist/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The parser and store work on loosely typed XML trees; `any` is a
      // deliberate boundary there, not an oversight.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    // User-facing text lives in i18n.ts, both languages side by side. An
    // inline `locale === 'cs' ? … : …` bypasses it: the other language drifts,
    // and the Czech tone and terminology stop being checked in one place.
    files: ['src/{components,state,utils,fno}/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error',
        ...[
          "BinaryExpression[operator=/^[!=]==?$/][left.type='Identifier'][left.name=/^(loc|locale|\\w+Locale)$/][right.type='Literal']",
          "BinaryExpression[operator=/^[!=]==?$/][right.type='Identifier'][right.name=/^(loc|locale|\\w+Locale)$/][left.type='Literal']",
          "BinaryExpression[operator=/^[!=]==?$/][left.type='MemberExpression'][left.property.name='locale'][right.type='Literal']",
          "BinaryExpression[operator=/^[!=]==?$/][right.type='MemberExpression'][right.property.name='locale'][left.type='Literal']",
        ].map(selector => ({
          selector,
          message: "Don't branch on the locale for text — add a key to the Translations interface and both dictionaries in src/i18n.ts and use `t.<key>` (or getTranslations(locale) when a locale is passed in).",
        })),
      ],
    },
  },
);
