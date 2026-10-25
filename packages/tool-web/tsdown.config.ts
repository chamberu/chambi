import { defineConfig } from 'tsdown';

export default defineConfig({
    // html-worker: the HTML conversion worker, loaded by URL next to the entry
    entry: {
        index: 'src/index.ts',
        'html-worker': 'src/html/worker.ts',
    },
    format: 'esm',
    dts: true,
    sourcemap: true,
});
