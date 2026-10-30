/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    mkdir,
    mkdtemp,
    rm,
    symlink,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    buildCsp,
    defaultRoot,
    loadBuild,
    renderIndex,
    resolveBuildPath,
} from '../../../src/routes/helpers.ts';
import { FIXTURE_BUILD } from '../../utils/app.ts';

describe('resolveBuildPath', () => {
    it('maps a subpath to a build key', () => {
        expect(resolveBuildPath('')).toBe('');
        expect(resolveBuildPath('/')).toBe('');
        expect(resolveBuildPath('/assets/app.js')).toBe('assets/app.js');
        expect(resolveBuildPath('/a%20b.txt')).toBe('a b.txt');
    });

    it('refuses traversal, NUL, empty segments and backslashes', () => {
        for (const path of [
            '/..',
            '/../x',
            '/a/./b',
            '/%2e%2e/x',
            '/%252e%252e/x',
            '/a%2f..%2fb',
            '/a\0b',
            '/a%00b',
            '/a//b',
            '/a\\b',
            '/a%5cb',
            '/%E0%A4%A',
            'relative',
        ]) {
            expect(resolveBuildPath(path), JSON.stringify(path)).toBeUndefined();
        }
    });
});

describe('renderIndex', () => {
    it('replaces the marker with the base and the escaped config', () => {
        const html = renderIndex('<head><!--chamvi-config--></head>', {
            apiBase: '',
            uiBase: '/ui',
            auth: { tokens: true, authup: { url: 'https://a', clientId: '<>&\u2028\u2029' } },
        });

        expect(html).toBe(
            '<head><base href="/ui/"><script type="application/json" id="chamvi-config">' +
            '{"apiBase":"","uiBase":"/ui","auth":{"tokens":true,"authup":{"url":"https://a","clientId":"\\u003c\\u003e\\u0026\\u2028\\u2029"}}}' +
            '</script></head>',
        );
    });
});

describe('buildCsp', () => {
    it('adds the authup origin only when configured', () => {
        expect(buildCsp({
            apiBase: '',
            uiBase: '/ui',
            auth: { tokens: true },
        })).not.toContain('https');
        expect(buildCsp({
            apiBase: '',
            uiBase: '/ui',
            auth: { tokens: true, authup: { url: 'http://localhost:3010/api', clientId: 'c' } },
        })).toContain("connect-src 'self' http://localhost:3010;");
    });
});

describe('loadBuild', () => {
    it('walks the build once and marks assets immutable', async () => {
        const files = await loadBuild(FIXTURE_BUILD);

        expect(files.keys().toArray().sort()).toEqual([
            'assets/app-1a2b3c4d.css',
            'assets/app-1a2b3c4d.js',
            'favicon.svg',
            'index.html',
        ]);
        expect(files.get('assets/app-1a2b3c4d.js')).toMatchObject({ type: 'text/javascript; charset=utf-8', immutable: true });
        expect(files.get('favicon.svg')).toMatchObject({ immutable: false });
    });

    it('follows symbolic links, skips dangling ones and reads a link cycle once', async () => {
        const base = await mkdtemp(join(tmpdir(), 'chamvi-ui-links-'));

        try {
            const shared = join(base, 'shared');
            const root = join(base, 'root');

            await mkdir(join(shared, 'nested'), { recursive: true });
            await mkdir(root);
            await writeFile(join(shared, 'app-1.js'), 'js');
            await writeFile(join(shared, 'nested', 'x.css'), 'css');
            await writeFile(join(base, 'index.html'), '<head></head>');
            await symlink(shared, join(root, 'assets'));
            await symlink(join(base, 'index.html'), join(root, 'index.html'));
            await symlink(join(base, 'missing'), join(root, 'dangling.txt'));
            await symlink(root, join(shared, 'loop'));

            const files = await loadBuild(root);

            expect(files.keys().toArray().sort()).toEqual([
                'assets/app-1.js',
                'assets/nested/x.css',
                'index.html',
            ]);
            expect(files.get('assets/app-1.js')).toMatchObject({ immutable: true });
            expect(new TextDecoder().decode(files.get('index.html')!.bytes)).toBe('<head></head>');
        } finally {
            await rm(base, { recursive: true, force: true });
        }
    });
});

describe('defaultRoot', () => {
    it('is a folder named app', () => {
        expect(defaultRoot()).toMatch(/[/\\]app[/\\]?$/);
    });
});
