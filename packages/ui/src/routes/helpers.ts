/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { existsSync } from 'node:fs';
import {
    readFile,
    readdir,
    realpath,
    stat,
} from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_ELEMENT_ID, CONFIG_MARKER } from '../config/constants.ts';
import type { UiConfig } from '../config/types.ts';
import { DEFAULT_MEDIA_TYPE, MEDIA_TYPES } from './constants.ts';
import type { BuildFile } from './types.ts';

/**
 * The build key of a route subpath (`/assets/app.js` -> `assets/app.js`,
 * `''` and `/` -> `''`), or `undefined` for anything that could leave the
 * build. The subpath is the raw, percent-encoded URL path (the URL parser
 * already folded `.`, `..`, `%2e%2e` and `\`); it is decoded once and every
 * check runs on the decoded form: a decode failure, a NUL, a backslash, a
 * `.` or `..` segment, an empty segment (one trailing `/` is allowed) or a
 * `%` left after decoding (double encoding, `%252e%252e`) is refused.
 */
export function resolveBuildPath(subpath: string): string | undefined {
    if (subpath === '' || subpath === '/') {
        return '';
    }

    if (!subpath.startsWith('/')) {
        return undefined;
    }

    let decoded: string;

    try {
        decoded = decodeURIComponent(subpath);
    } catch {
        return undefined;
    }

    if (/[\0\\%]/.test(decoded)) {
        return undefined;
    }

    const segments = decoded.slice(1).split('/');

    if (segments.length > 1 && segments.at(-1) === '') {
        segments.pop();
    }

    const hasInvalidSegment = segments.some((segment) => segment === '' || segment === '.' || segment === '..');

    if (hasInvalidSegment) {
        return undefined;
    }

    return segments.join('/');
}

/**
 * Every file below `root`, keyed by its `/`-joined relative path, read
 * once. Symbolic links are followed (a mounted `assets/` or a linked
 * `index.html` is served); a dangling link is skipped and a directory
 * reached twice (a link cycle) is read once.
 */
export async function loadBuild(root: string): Promise<Map<string, BuildFile>> {
    const files = new Map<string, BuildFile>();
    const visited = new Set<string>();
    const walk = async (dir: string, prefix: string): Promise<void> => {
        const real = await realpath(dir);

        if (visited.has(real)) {
            return;
        }

        visited.add(real);

        for (const entry of await readdir(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            const key = prefix ? `${prefix}/${entry.name}` : entry.name;
            let kind: { isFile(): boolean; isDirectory(): boolean } = entry;

            if (entry.isSymbolicLink()) {
                try {
                    kind = await stat(path);
                } catch {
                    continue;
                }
            }

            if (kind.isDirectory()) {
                await walk(path, key);
            } else if (kind.isFile()) {
                files.set(key, {
                    bytes: new Uint8Array(await readFile(path)),
                    type: MEDIA_TYPES[extname(key).toLowerCase()] ?? DEFAULT_MEDIA_TYPE,
                    immutable: key.startsWith('assets/'),
                });
            }
        }
    };

    await walk(root, '');

    return files;
}

const JSON_ESCAPES: Record<string, string> = {
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
};

/**
 * `index.html` with `CONFIG_MARKER` replaced by `<base href="<uiBase>/">`
 * and the config as a JSON script block (`<`, `>`, `&`, U+2028 and U+2029
 * escaped, so no value can end the block).
 */
export function renderIndex(html: string, config: UiConfig): string {
    const json = JSON.stringify(config).replace(/[<>&\u2028\u2029]/g, (char) => JSON_ESCAPES[char] ?? char);
    const block = `<base href="${config.uiBase}/"><script type="application/json" id="${CONFIG_ELEMENT_ID}">${json}</script>`;

    return html.replace(CONFIG_MARKER, () => block);
}

/** The dashboard's Content-Security-Policy; the authup origin joins `connect-src` and `form-action`. */
export function buildCsp(config: UiConfig): string {
    const authup = config.auth.authup ? ` ${new URL(config.auth.authup.url).origin}` : '';

    return [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        `connect-src 'self'${authup}`,
        `form-action 'self'${authup}`,
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
    ].join('; ');
}

/**
 * The package's build: `dist/app` next to the built entry (`dist/index.mjs`),
 * else seen from the sources (`src/routes`); the first that holds an
 * `index.html`, else the built entry's.
 */
export function defaultRoot(): string {
    const candidates = [
        fileURLToPath(new URL('./app/', import.meta.url)),
        fileURLToPath(new URL('../../dist/app/', import.meta.url)),
    ];

    return candidates.find((candidate) => existsSync(join(candidate, 'index.html'))) ?? candidates[0]!;
}

/** The last path segment names a file (has an extension): never answered with `index.html`. */
export function isFileLike(key: string): boolean {
    return (key.split('/').at(-1) ?? '').includes('.');
}
