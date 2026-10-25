/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import type { ToolSet } from 'ai';
import type { WebFetchResult } from '@chamvi/tool-web';
import { callTool, toolContext } from '../utils/context.ts';
import { createFakeWeb, html } from '../utils/web.ts';

// nx builds the package before its tests (dependsOn: build); by hand run `npm run build` first
const DIST = new URL('../../dist/index.mjs', import.meta.url).href;

describe('the build', () => {
    it('converts a page through the built html-worker entry', async () => {
        const { webTools } = await import(/* @vite-ignore */ DIST) as { webTools: (options: object) => ToolSet };
        const web = createFakeWeb();
        web.routes.set('https://example.com/', html('<title>Built</title><main><h1>Hello</h1></main>'));
        const tools = webTools({ fetch: web.fetch, lookup: web.lookup });

        const result = await callTool<WebFetchResult>(tools, 'web_fetch', { url: 'https://example.com/' }, toolContext('run-1'));
        expect(result.title).toBe('Built');
        expect(result.content).toBe('# Hello');
    });
});
