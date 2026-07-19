import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // Downgrade to warn: flags async data-loading effects as false positives
      // because it can't track setState calls across async boundaries.
      'react-hooks/set-state-in-effect': 'warn',
      // Context files intentionally co-export a provider component + a hook
      // (TransferContext exports TransferProvider and useTransfers).
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
])
