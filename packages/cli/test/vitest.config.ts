import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const source = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

export default defineConfig({
    plugins: [
        // the store-db entities use legacy decorators
        swc.vite({
            jsc: {
                parser: {
                    syntax: 'typescript',
                    decorators: true,
                },
                transform: {
                    legacyDecorator: true,
                    decoratorMetadata: false,
                },
            },
        }),
    ],
    resolve: {
        // the sources, not dist
        alias: [
            { find: /^@chamvi\/core$/, replacement: source('core/src/index.ts') },
            { find: /^@chamvi\/core\/conversation\/persistence$/, replacement: source('core/src/conversation/persistence/index.ts') },
            { find: /^@chamvi\/http$/, replacement: source('http/src/index.ts') },
            { find: /^@chamvi\/channel-cron$/, replacement: source('channel-cron/src/index.ts') },
            { find: /^@chamvi\/store-db$/, replacement: source('store-db/src/index.ts') },
            { find: /^@chamvi\/test-kit$/, replacement: source('test-kit/src/index.ts') },
            { find: /^@chamvi\/github$/, replacement: source('github/src/index.ts') },
            { find: /^@chamvi\/github\/module$/, replacement: source('github/src/module/index.ts') },
            { find: /^@chamvi\/app$/, replacement: source('app/src/index.ts') },
            { find: /^@chamvi\/app\/(authup|testing)$/, replacement: `${source('app/src/')}$1/index.ts` },
            { find: /^@chamvi\/cli$/, replacement: source('cli/src/index.ts') },
        ],
    },
    test: {
        include: ['test/unit/**/*.{test,spec}.{js,ts}'],
        passWithNoTests: false,
        testTimeout: 30_000,
        hookTimeout: 60_000,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.{ts,tsx,js,jsx}'],
            thresholds: {
                branches: 80,
                functions: 80,
                lines: 80,
                statements: 80,
            },
        },
    },
});
