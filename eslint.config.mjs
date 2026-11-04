import js from '@eslint/js';

// The Colophon view scripts are function bodies (Dataview runs them inside a function and
// allows top-level `await` and `return`), so ESLint cannot parse them as modules. The processor
// below wraps each one in an async function for linting and shifts the reported lines back.
const wrap = (params) => ({
  preprocess: (text) => [`globalThis.__body = async function (${params}) {\n${text}\n};\n`],
  postprocess: (messages) =>
    messages[0].map((m) => ({
      ...m,
      line: m.line - 1,
      endLine: m.endLine === undefined ? undefined : m.endLine - 1,
    })),
});

const browserGlobals = Object.fromEntries(
  ['window', 'document', 'console', 'navigator', 'requestAnimationFrame'].map((n) => [
    n,
    'readonly',
  ]),
);
const nodeGlobals = Object.fromEntries(
  ['process', 'console', 'URL', 'Buffer'].map((n) => [n, 'readonly']),
);

export default [
  { ignores: ['node_modules/**', 'example-vault/.obsidian/**'] },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['error', { args: 'none' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
    },
  },
  {
    files: ['tools/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: nodeGlobals },
  },
  {
    // Shipped to users and run from the release archive without npm install: node: modules only.
    files: ['tools/user/**/*.mjs'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!node:|\\./).*',
              message: 'tools/user may import only node: modules and its own files',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['example-vault/Colophon/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: browserGlobals },
    processor: {
      meta: { name: 'colophon-body' },
      supportsAutofix: false,
      preprocess: (text, filename) =>
        (filename.endsWith('model.js') || filename.endsWith('recommend.js')
          ? wrap('')
          : filename.endsWith('lib.js')
            ? wrap('dv, root')
            : wrap('dv, input')
        ).preprocess(text),
      postprocess: (messages) => wrap('').postprocess(messages),
    },
  },
];
