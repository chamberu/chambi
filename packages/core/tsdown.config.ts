import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        'conversation/persistence': 'src/conversation/persistence/index.ts',
    },
    format: 'esm',
    dts: true,
    sourcemap: true,
});
