/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import {
    ASSET_CACHE_CONTROL,
    CONFIG_ELEMENT_ID,
    DOCUMENT_CACHE_CONTROL,
    uiRoutes,
} from '@chamvi/ui';
import type { UiConfig } from '@chamvi/ui';
import {
    FIXTURE_BUILD,
    createUiTestApp,
    get,
} from '../../utils/app.ts';

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'";

function fixture(path: string): Uint8Array {
    return new Uint8Array(readFileSync(join(FIXTURE_BUILD, path)));
}

function readConfig(html: string): UiConfig {
    const match = new RegExp(`<script type="application/json" id="${CONFIG_ELEMENT_ID}">([^<]*)</script>`).exec(html);

    if (!match?.[1]) {
        throw new Error('no config block');
    }

    return JSON.parse(match[1]) as UiConfig;
}

describe('uiRoutes', () => {
    it('serves index.html with the config and base injected', async () => {
        const { app } = createUiTestApp({ routes: uiRoutes({ root: FIXTURE_BUILD }) });
        const response = await get(app, '/ui/');

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect(response.headers.get('cache-control')).toBe(DOCUMENT_CACHE_CONTROL);

        const html = await response.text();

        expect(html).toContain('<base href="/ui/">');
        expect(html).not.toContain('<!--chamvi-config-->');
        expect(readConfig(html)).toEqual({
            apiBase: '',
            uiBase: '/ui',
            auth: { tokens: true },
        });
    });

    it('serves index.html for the mount path itself', async () => {
        const { app } = createUiTestApp({ routes: uiRoutes({ root: FIXTURE_BUILD }) });
        const response = await get(app, '/ui');

        expect(response.status).toBe(200);
        expect(await response.text()).toContain('<base href="/ui/">');
    });

    it('falls back to index.html for a client route', async () => {
        const { app } = createUiTestApp({ routes: uiRoutes({ root: FIXTURE_BUILD }) });

        for (const path of ['/ui/runs/abc', '/ui/approvals?run=x', '/ui/state/triage']) {
            const response = await get(app, path);

            expect(response.status, path).toBe(200);
            expect(response.headers.get('content-type'), path).toBe('text/html; charset=utf-8');
            expect(await response.text(), path).toContain(CONFIG_ELEMENT_ID);
        }
    });

    it('serves hashed assets immutable', async () => {
        const { app } = createUiTestApp({ routes: uiRoutes({ root: FIXTURE_BUILD }) });
        const response = await get(app, '/ui/assets/app-1a2b3c4d.js');

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
        expect(response.headers.get('cache-control')).toBe(ASSET_CACHE_CONTROL);
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(fixture('assets/app-1a2b3c4d.js'));

        const css = await get(app, '/ui/assets/app-1a2b3c4d.css');

        expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
    });

    it('serves other files no-cache', async () => {
        const { app } = createUiTestApp({ routes: uiRoutes({ root: FIXTURE_BUILD }) });
        const response = await get(app, '/ui/favicon.svg');

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/svg+xml');
        expect(response.headers.get('cache-control')).toBe(DOCUMENT_CACHE_CONTROL);
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(fixture('favicon.svg'));
    });

    it('answers index.html rendered, never raw, by its own name', async () => {
        const { app } = createUiTestApp({ routes: uiRoutes({ root: FIXTURE_BUILD }) });
        const html = await (await get(app, '/ui/index.html')).text();

        expect(html).toContain('<base href="/ui/">');
    });

    it('answers 404, not index.html, for a missing asset', async () => {
        const { app } = createUiTestApp({ routes: uiRoutes({ root: FIXTURE_BUILD }) });

        for (const path of ['/ui/assets/nope.js', '/ui/x.png', '/ui/runs/a.json']) {
            const response = await get(app, path);

            expect(response.status, path).toBe(404);
            expect(await response.json(), path).toMatchObject({ status: 404, code: 'not_found' });
        }
    });

    it('serves only files of the build', async () => {
        const { app } = createUiTestApp({ routes: uiRoutes({ root: FIXTURE_BUILD }) });

        for (const path of [
            '/ui/../package.json',
            '/ui/%2e%2e/package.json',
            '/ui/%252e%252e/package.json',
            '/ui/assets%2f..%2f..%2fpackage.json',
            '/ui/assets/%2e%2e%2f%2e%2e%2fpackage.json',
            '/ui/%E0%A4%A',
            '/ui/assets\\..\\x.js',
            '/ui/assets//app-1a2b3c4d.js',
        ]) {
            const response = await get(app, path);

            expect(response.status, path).toBe(404);
        }

        expect((await get(app, '/ui/a%00b')).status).toBe(400);
    });

    it('sets the security headers on every response', async () => {
        const { app } = createUiTestApp({ routes: uiRoutes({ root: FIXTURE_BUILD }) });

        for (const [path, status] of [['/ui/', 200], ['/ui/assets/app-1a2b3c4d.js', 200], ['/ui/nope.js', 404]] as const) {
            const response = await get(app, path);

            expect(response.status, path).toBe(status);
            expect(response.headers.get('content-security-policy'), path).toBe(CSP);
            expect(response.headers.get('referrer-policy'), path).toBe('no-referrer');
            expect(response.headers.get('x-content-type-options'), path).toBe('nosniff');
            expect(response.headers.get('x-frame-options'), path).toBe('DENY');
        }
    });

    it('adds the authup origin to the CSP and the config', async () => {
        const { app } = createUiTestApp({
            routes: uiRoutes({
                root: FIXTURE_BUILD,
                auth: { authup: { url: 'https://auth.example.com/api', clientId: 'chamvi' } },
            }),
        });
        const response = await get(app, '/ui/');
        const csp = response.headers.get('content-security-policy');

        expect(csp).toContain("connect-src 'self' https://auth.example.com;");
        expect(csp).toContain("form-action 'self' https://auth.example.com;");
        expect(readConfig(await response.text())).toEqual({
            apiBase: '',
            uiBase: '/ui',
            auth: { tokens: true, authup: { url: 'https://auth.example.com/api', clientId: 'chamvi' } },
        });
    });

    it('escapes the config JSON', async () => {
        const { app } = createUiTestApp({
            routes: uiRoutes({
                root: FIXTURE_BUILD,
                auth: { authup: { url: 'https://auth.example.com', clientId: '</script><script>x\u2028&' } },
            }),
        });
        const html = await (await get(app, '/ui/')).text();

        expect(html.match(/<script/g)).toHaveLength(2); // the config block and the fixture's module script
        expect(html).not.toContain('\u2028');
        expect(readConfig(html).auth.authup?.clientId).toBe('</script><script>x\u2028&');
    });

    it('mounts under the app basePath and its own basePath', async () => {
        const { app } = createUiTestApp({ basePath: '/api', routes: uiRoutes({ root: FIXTURE_BUILD, basePath: '/console' }) });
        const response = await get(app, '/api/console/runs');

        expect(response.status).toBe(200);

        const html = await response.text();

        expect(html).toContain('<base href="/api/console/">');
        expect(readConfig(html)).toMatchObject({ apiBase: '/api', uiBase: '/api/console' });
        expect((await get(app, '/api/console/assets/app-1a2b3c4d.js')).status).toBe(200);
        expect((await get(app, '/ui/')).status).toBe(404);
    });

    it('is not rate limited', async () => {
        const { app } = createUiTestApp({ rateLimit: { max: 5 }, routes: uiRoutes({ root: FIXTURE_BUILD }) });

        for (let i = 0; i < 20; i++) {
            expect((await get(app, '/ui/assets/app-1a2b3c4d.css')).status).toBe(200);
        }
    });

    it('answers 500 and reports a missing build, then serves it once it exists', async () => {
        const root = await mkdtemp(join(tmpdir(), 'chamvi-ui-'));

        try {
            const {
                app,
                errors,
                clock,
            } = createUiTestApp({ routes: uiRoutes({ root }) });

            expect((await get(app, '/ui/')).status).toBe(500);
            expect(errors).toHaveLength(1);
            expect(errors[0]).toBeInstanceOf(InvalidAgentDefinitionError);
            expect((errors[0] as Error).message).toMatch(/build @chamvi\/ui first/);

            // within the retry window: answered from memory, the folder is not read, nothing reported
            await writeFile(join(root, 'index.html'), '<head><!--chamvi-config--></head>');

            const again = await get(app, '/ui/x');

            expect(again.status).toBe(500);
            expect(await again.json()).toEqual({
                status: 500,
                code: 'internal_error',
                message: 'Internal Server Error',
            });
            expect(errors).toHaveLength(1);

            clock.advance(5000);
            expect((await get(app, '/ui/')).status).toBe(200);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('refuses invalid options', () => {
        for (const options of [
            { basePath: '' },
            { basePath: '/' },
            { basePath: 'ui' },
            { basePath: '/UI' },
            { basePath: '/ui/' },
            { basePath: '/ui//x' },
            { basePath: '/ui/:id' },
            { auth: { authup: { url: 'not a url', clientId: 'c' } } },
            { auth: { authup: { url: 'ftp://auth.example.com', clientId: 'c' } } },
            { auth: { authup: { url: 'https://auth.example.com', clientId: '' } } },
            { auth: { tokens: false } },
            { root: '' },
        ]) {
            expect(() => uiRoutes(options as never), JSON.stringify(options)).toThrow(InvalidAgentDefinitionError);
        }
    });

    it('builds one unlimited GET prefix route', () => {
        const routes = uiRoutes({ root: FIXTURE_BUILD });

        expect(routes).toHaveLength(1);
        expect(routes[0]).toMatchObject({
            method: 'GET',
            path: '/ui',
            prefix: true,
            rateLimit: false,
        });
    });
});
