import config from '@tada5hi/eslint-config';

export default [
    ...await config({ vue: true }),
    {
        ignores: [
            '**/dist/**',
            '**/coverage/**',
            '**/.vitepress/cache/**',
            'packages/ui/test-results/**',
            'packages/ui/playwright-report/**',
        ],
    },
    {
        // Node 24 does not implement the Uint8Array base64/hex encoding APIs.
        rules: {
            'unicorn/prefer-uint8array-base64': 'off',
            'unicorn/prefer-uint8array-hex': 'off',
        },
    },
    {
        // the dashboard ships to Vite's default browser target (Safari 16.4, Firefox 114),
        // which lacks the ES2025 iterator helpers and gets no polyfill
        files: ['packages/ui/app/**/*.{ts,vue}'],
        rules: {
            // Error.isError is newer than the dashboard's browser target.
            'unicorn/prefer-error-is-error': 'off',
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'CallExpression[callee.property.name=\'toArray\']',
                    message: 'Iterator.prototype.toArray is ES2025: use Array.from(iterable).',
                },
                {
                    selector: 'CallExpression[callee.object.callee.property.name=/^(entries|keys|values)$/][callee.property.name=/^(map|filter|reduce|forEach|some|every|find|flatMap|take|drop)$/]:not([callee.object.callee.object.name=\'Object\'])',
                    message: 'Iterator helpers are ES2025: use Array.from(iterable) first.',
                },
            ],
        },
    },
    {
        // documentation samples: they log, and show values as bare expressions
        files: ['packages/docs/src/snippets/**/*.ts'],
        rules: {
            'no-console': 'off',
            '@typescript-eslint/no-unused-expressions': 'off',
        },
    },
];
