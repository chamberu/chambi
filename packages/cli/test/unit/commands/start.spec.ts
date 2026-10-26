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
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Env } from '@chamvi/app';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { runCli } from '../../../src/run/module.ts';
import { TOKEN, startEnv } from '../../utils/env.ts';
import { closeServer, freePort, listenOn } from '../../utils/port.ts';
import { createFakeProcess } from '../../utils/process.ts';
import type { FakeProcess } from '../../utils/process.ts';

const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/${name}/src/index.ts`, import.meta.url));

describe('start', () => {
    let fake: FakeProcess;
    let port: number;

    beforeEach(async () => {
        // every test imports a fresh entry, so a fresh App
        vi.resetModules();
        fake = createFakeProcess();
        port = await freePort();
    });

    afterEach(async () => {
        // stop whatever a test left running
        fake.signals.emit('SIGTERM');
        await vi.waitFor(() => expect(fake.exitCodes.length + fake.exits.length).toBeGreaterThan(0));
        vi.restoreAllMocks();
    });

    async function start(args: string[], env: Env, cwd?: string) {
        await runCli(['start', ...args], fake.context({ env, cwd }));
    }

    async function isListening(): Promise<boolean> {
        try {
            const server = await listenOn(port);
            await closeServer(server);
            return false;
        } catch {
            return true;
        }
    }

    it('serves /readyz', async () => {
        await start(['--entry', fixture('app')], startEnv(port));
        const response = await fetch(`http://127.0.0.1:${port}/readyz`);
        expect(response.status).toBe(200);
        expect(fake.exitCodes).toEqual([]);
    });

    it('SIGTERM stops and sets exit code 0', async () => {
        await start(['--entry', fixture('app')], startEnv(port));
        expect(await isListening()).toBe(true);

        fake.signals.emit('SIGTERM');
        await vi.waitFor(() => expect(fake.exitCodes).toEqual([0]));
        expect(fake.exits).toEqual([]);
        expect(await isListening()).toBe(false);
        expect(fake.signals.listenerCount('SIGTERM')).toBe(0);
    });

    it('SIGTERM during start exits', async () => {
        globalThis.chamviSlowStoreWaiting = undefined;
        const started = start(['--entry', fixture('slow')], startEnv(port));
        await vi.waitFor(() => expect(globalThis.chamviSlowStoreWaiting).toBe(true));

        fake.signals.emit('SIGTERM');
        await started;
        await vi.waitFor(() => expect(fake.exitCodes).toEqual([0]));
        expect(fake.exits).toEqual([]);
        expect(await isListening()).toBe(false);
        expect(fake.stderr.join('')).not.toContain('app_stopped');
    });

    it('without any entry file runs the default app and says so', async () => {
        const cwd = await mkdtemp(path.join(tmpdir(), 'chamvi-cli-start-'));
        try {
            await start([], startEnv(port), cwd);
            expect(fake.exitCodes).toEqual([]);
            expect(await isListening()).toBe(true);
            expect(fake.stderr.join('')).toContain('no entry file: running the default app');
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    });

    it('missing dist/index.mjs beside src/index.ts exits 2 with the hint', async () => {
        const cwd = await mkdtemp(path.join(tmpdir(), 'chamvi-cli-start-'));
        try {
            await mkdir(path.join(cwd, 'src'));
            await writeFile(path.join(cwd, 'src/index.ts'), 'export default {};\n');
            await start([], startEnv(port), cwd);
            expect(fake.exitCodes).toEqual([2]);
            expect(fake.stderr.join('')).toContain('run `chamvi build` or pass --entry src/index.ts');
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    });

    it('a model string without its key exits 2 naming ANTHROPIC_API_KEY', async () => {
        await start(['--entry', fixture('keyless')], startEnv(port));
        expect(fake.exitCodes).toEqual([2]);
        expect(fake.stderr.join('')).toContain('ANTHROPIC_API_KEY');
        expect(await isListening()).toBe(false);
    });

    it('a malformed CHAMVI_FORCE_EXIT_MS exits 2 naming it', async () => {
        await start(['--entry', fixture('app')], startEnv(port, { CHAMVI_FORCE_EXIT_MS: 'soon' }));
        expect(fake.exitCodes).toEqual([2]);
        expect(fake.stderr.join('')).toContain('CHAMVI_FORCE_EXIT_MS');
        expect(fake.stderr.join('')).not.toContain('soon');
    });

    it('a CHAMVI_FORCE_EXIT_MS above the timer limit exits 2', async () => {
        await start(['--entry', fixture('app')], startEnv(port, { CHAMVI_FORCE_EXIT_MS: '2147483648' }));
        expect(fake.exitCodes).toEqual([2]);
        expect(fake.stderr.join('')).toContain('CHAMVI_FORCE_EXIT_MS must be at most 2147483647.');
    });

    it('unknown flag exits 2', async () => {
        await start(['--entry', fixture('app'), '--colour'], startEnv(port));
        expect(fake.exitCodes).toEqual([2]);
        expect(fake.stderr.join('')).toContain('--colour');
    });

    describe('--dev', () => {
        let cwd: string;

        beforeEach(async () => {
            cwd = await mkdtemp(path.join(tmpdir(), 'chamvi-cli-dev-'));
        });

        afterEach(async () => {
            await rm(cwd, { recursive: true, force: true });
        });

        it('loads .env without overriding', async () => {
            const devToken = 'a-dev-token-from-the-env-file';
            await writeFile(path.join(cwd, '.env'), [
                'CHAMVI_LOG_LEVEL=warn',
                `CHAMVI_TOKENS='[{"value":"${devToken}","id":"dev","permissions":["*"]}]'`,
                'PORT=1',
                '',
            ].join('\n'));
            const env: Env = { PORT: String(port), HOST: '127.0.0.1' };

            await start(['--dev', '--entry', fixture('app')], env, cwd);
            expect(env.PORT).toBe(String(port));
            expect(env.CHAMVI_LOG_LEVEL).toBe('warn');

            const response = await fetch(`http://127.0.0.1:${port}/agents`, { headers: { authorization: `Bearer ${devToken}` } });
            expect(response.status).toBe(200);
        });

        it('starts without .env', async () => {
            await start(['--dev', '--entry', fixture('app')], startEnv(port), cwd);
            const response = await fetch(`http://127.0.0.1:${port}/agents`, { headers: { authorization: `Bearer ${TOKEN}` } });
            expect(response.status).toBe(200);
        });

        it('links to the chamvi dev parent only when spawned by chamvi dev', async () => {
            await start(['--dev', '--entry', fixture('app')], startEnv(port), cwd);
            expect(fake.links).toBe(0);
            fake.signals.emit('SIGTERM');
            await vi.waitFor(() => expect(fake.exitCodes).toEqual([0]));

            // a fresh entry import, so a fresh App
            vi.resetModules();
            const linked = createFakeProcess();
            const other = await freePort();
            await runCli(['start', '--dev', '--entry', fixture('app')], linked.context({ env: startEnv(other, { CHAMVI_DEV_LINK: '1' }), cwd }));
            expect(linked.links).toBe(1);
            linked.signals.emit('SIGTERM');
            await vi.waitFor(() => expect(linked.exitCodes).toEqual([0]));
        });

        it('a start without --dev never links', async () => {
            await start(['--entry', fixture('app')], startEnv(port, { CHAMVI_DEV_LINK: '1' }), cwd);
            expect(fake.links).toBe(0);
        });

        it('warns about the random token', async () => {
            const lines: string[] = [];
            vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
                lines.push(String(chunk));
                return true;
            });

            await start(['--dev', '--entry', fixture('app')], { PORT: String(port), HOST: '127.0.0.1' }, cwd);
            const log = lines.join('');
            expect(log).toContain('CHAMVI_TOKENS unset');
        });
    });
});
