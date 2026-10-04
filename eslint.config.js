import js from '@eslint/js'
import ts from 'typescript-eslint'
import globals from 'globals'
import hooks from 'eslint-plugin-react-hooks'
export default ts.config({ignores:['dist/**','node_modules/**','test-results/**','playwright-report/**','.local/**']},js.configs.recommended,...ts.configs.recommended,{files:['scripts/*.mjs'],languageOptions:{globals:globals.node}},{files:['scripts/service-worker.template.js'],languageOptions:{globals:globals.serviceworker}},{files:['**/*.{ts,tsx}'],languageOptions:{globals:{...globals.browser,...globals.node}},plugins:{'react-hooks':hooks},rules:{...hooks.configs.recommended.rules}})
