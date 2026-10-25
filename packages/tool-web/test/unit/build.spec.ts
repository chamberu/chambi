/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

    it('converts a page under node --watch, as chamvi dev runs the app', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'chamvi-tool-web-'));
        const script = path.join(dir, 'watched.mjs');
        await writeFile(script, [
            `import { webTools } from ${JSON.stringify(DIST)};`,
            'const tools = webTools({',
            "    fetch: async () => new Response('<main><p>hi</p></main>', { headers: { 'content-type': 'text/html' } }),",
            "    lookup: async () => [{ address: '93.184.215.14', family: 4 }],",
            '});',
            "const context = { run: { runId: 'run-1', agent: 'researcher', signal: new AbortController().signal } };",
            'let line;',
            'try {',
            "    const result = await tools.web_fetch.execute({ url: 'https://example.com/' }, { toolCallId: 'call-1', messages: [], context });",
            '    line = { content: result.content };',
            '} catch (error) {',
            '    line = { error: error.message };',
            '}',
            'console.log(`result ${JSON.stringify(line)}`);',
        ].join('\n'));

        const child = spawn(process.execPath, ['--watch', script], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
        try {
            const line = await new Promise<string>((resolve, reject) => {
                let out = '';
                child.stdout.setEncoding('utf8');
                child.stdout.on('data', (chunk: string) => {
                    out += chunk;
                    const match = /^result (.*)$/m.exec(out);
                    if (match) resolve(match[1]!);
                });
                child.once('error', reject);
                child.once('exit', (code) => reject(new Error(`node --watch exited with ${code}: ${out}`)));
            });
            expect(JSON.parse(line)).toEqual({ content: 'hi' });
        } finally {
            child.kill();
            await rm(dir, { recursive: true, force: true });
        }
    }, 20_000);
});
