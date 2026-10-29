import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [vue()],
    define: { __CHAMVI_VERSION__: JSON.stringify('0.0.0') },
    resolve: {
        // the sources, not dist
        alias: [
            { find: /^@chamvi\/app$/, replacement: fileURLToPath(new URL('../../app/src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/app\/testing$/, replacement: fileURLToPath(new URL('../../app/src/testing/index.ts', import.meta.url)) },
            { find: /^@chamvi\/core$/, replacement: fileURLToPath(new URL('../../core/src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/core\/conversation\/persistence$/, replacement: fileURLToPath(new URL('../../core/src/conversation/persistence/index.ts', import.meta.url)) },
            { find: /^@chamvi\/http$/, replacement: fileURLToPath(new URL('../../http/src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/channel-cron$/, replacement: fileURLToPath(new URL('../../channel-cron/src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/store-typeorm$/, replacement: fileURLToPath(new URL('../../store-typeorm/src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/test-kit$/, replacement: fileURLToPath(new URL('../../test-kit/src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/ui$/, replacement: fileURLToPath(new URL('../src/index.ts', import.meta.url)) },
            { find: /^@chamvi\/ui\/module$/, replacement: fileURLToPath(new URL('../src/module/index.ts', import.meta.url)) },
        ],
    },
    test: {
        include: ['test/unit/**/*.{test,spec}.{js,ts}'],
        passWithNoTests: false,
        testTimeout: 30_000,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.{ts,tsx,js,jsx}', 'app/**/*.{ts,vue}'],
            thresholds: {
                branches: 80,
                functions: 80,
                lines: 80,
                statements: 80,
            },
        },
    },
});
