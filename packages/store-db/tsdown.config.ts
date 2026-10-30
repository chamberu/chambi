import { defineConfig } from 'tsdown';
import swc from 'unplugin-swc';

export default defineConfig({
    entry: ['src/index.ts'],
    format: 'esm',
    dts: true,
    sourcemap: true,
    plugins: [
        swc.rolldown({
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
});
