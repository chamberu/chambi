import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        // the sources, not dist
        alias: [
            { find: /^@chamvi\/app$/, replacement: fileURLToPath(new URL('../../app/src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/app\/testing$/, replacement: fileURLToPath(new URL('../../app/src/testing/index.ts', import.meta.url)) },
            { find: /^@chamvi\/core$/, replacement: fileURLToPath(new URL('../../core/src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/core\/conversation\/persistence$/, replacement: fileURLToPath(new URL('../../core/src/conversation/persistence/index.ts', import.meta.url)) },
            { find: /^@chamvi\/http$/, replacement: fileURLToPath(new URL('../../http/src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/sandbox$/, replacement: fileURLToPath(new URL('../src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/sandbox\/module$/, replacement: fileURLToPath(new URL('../src/module/index.ts', import.meta.url)) },
            { find: /^@chamvi\/sandbox-local$/, replacement: fileURLToPath(new URL('../../sandbox-local/src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/channel-cron$/, replacement: fileURLToPath(new URL('../../channel-cron/src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/store-typeorm$/, replacement: fileURLToPath(new URL('../../store-typeorm/src/index.ts', import.meta.url)) },
        ],
    },
    test: {
        include: ['test/unit/**/*.{test,spec}.{js,ts}'],
        passWithNoTests: false,
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
