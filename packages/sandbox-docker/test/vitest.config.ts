import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        // the sources, not dist
        alias: [
            { find: /^@chamvi\/coding$/, replacement: fileURLToPath(new URL('../../coding/src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/core$/, replacement: fileURLToPath(new URL('../../core/src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/sandbox$/, replacement: fileURLToPath(new URL('../../sandbox/src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/sandbox-docker$/, replacement: fileURLToPath(new URL('../src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/test-kit$/, replacement: fileURLToPath(new URL('../../test-kit/src/index.ts', import.meta.url)) },
        ],
    },
    test: {
        globalSetup: ['test/global-setup.ts'],
        include: ['test/unit/**/*.{test,spec}.{js,ts}'],
        passWithNoTests: false,
        testTimeout: 60_000,
        hookTimeout: 600_000,
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
