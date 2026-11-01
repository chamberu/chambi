import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        baileys: 'src/baileys/index.ts',
        module: 'src/module/index.ts',
    },
    format: 'esm',
    dts: true,
    sourcemap: true,
});
