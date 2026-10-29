import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [
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
            { find: /^@chamvi\/core$/, replacement: fileURLToPath(new URL('../../core/src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/core\/conversation\/persistence$/, replacement: fileURLToPath(new URL('../../core/src/conversation/persistence/index.ts', import.meta.url)) },
            { find: /^@chamvi\/http$/, replacement: fileURLToPath(new URL('../../http/src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/channel-cron$/, replacement: fileURLToPath(new URL('../../channel-cron/src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/store-typeorm$/, replacement: fileURLToPath(new URL('../../store-typeorm/src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/test-kit$/, replacement: fileURLToPath(new URL('../../test-kit/src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/app$/, replacement: fileURLToPath(new URL('../src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/app\/(authup|testing)$/, replacement: `${fileURLToPath(new URL('../src/', import.meta.url))}$1/index.ts` },
        ],
    },
    test: {
        globalSetup: ['test/global-setup.ts'],
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
