import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { IconifyJSON } from '@iconify/types';
import { getIcons } from '@iconify/utils';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import lucide from '@vuecs/icons-lucide';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

// the dev server proxies the API to a chamvi app on port 3000
const API = 'http://127.0.0.1:3000';

const ICONS_ID = 'virtual:chamvi-icons';

const { version } = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * The Lucide icons the vuecs preset names, bundled as one small Iconify
 * collection: Iconify would otherwise fetch them from api.iconify.design,
 * which the dashboard's CSP (connect-src 'self') refuses.
 */
function icons(): Plugin {
    return {
        name: 'chamvi-icons',
        resolveId: (id) => (id === ICONS_ID ? `\0${ICONS_ID}` : undefined),
        load(id) {
            if (id !== `\0${ICONS_ID}`) {
                return undefined;
            }

            const names = new Set<string>(['x', 'check']);
            const collect = (value: unknown): void => {
                if (typeof value === 'string' && value.startsWith('lucide:')) {
                    names.add(value.slice('lucide:'.length));
                } else if (value && typeof value === 'object') {
                    Object.values(value).forEach(collect);
                }
            };

            collect(lucide().defaults);

            const path = createRequire(import.meta.url).resolve('@iconify-json/lucide/icons.json');
            const collection = JSON.parse(readFileSync(path, 'utf8')) as IconifyJSON;
            const subset = getIcons(collection, [...names].sort(), true);

            if (!subset) {
                throw new Error('lucide icons missing');
            }

            return `export default ${JSON.stringify(subset)};`;
        },
    };
}

export default defineConfig(({ command }) => ({
    root: 'app',
    base: command === 'build' ? './' : '/ui/',
    plugins: [vue(), tailwindcss(), icons()],
    // the login footer's "chamvi 0.1"
    define: { __CHAMVI_VERSION__: JSON.stringify(version) },
    build: {
        outDir: '../dist/app',
        emptyOutDir: true,
        assetsDir: 'assets',
        // vuecs, reka-ui and the icon set in one entry chunk
        chunkSizeWarningLimit: 1500,
        // a font subset under 4 KiB would become a data: URI, which font-src 'self' refuses
        assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
    },
    server: { proxy: Object.fromEntries(['/agents', '/runs', '/schedules', '/me'].map((path) => [path, API])) },
}));
