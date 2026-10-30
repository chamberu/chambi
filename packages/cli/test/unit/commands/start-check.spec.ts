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
import { startEnv } from '../../utils/env.ts';
import { closeServer, freePort, listenOn } from '../../utils/port.ts';
import { createFakeProcess } from '../../utils/process.ts';
import type { FakeProcess } from '../../utils/process.ts';

const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/${name}/src/index.ts`, import.meta.url));

describe('start --check', () => {
    let fake: FakeProcess;
    let port: number;
    let dir: string;

    beforeEach(async () => {
        vi.resetModules();
        fake = createFakeProcess();
        port = await freePort();
        dir = await mkdtemp(path.join(tmpdir(), 'chamvi-cli-check-'));
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await rm(dir, { recursive: true, force: true });
    });

    async function check(entry: string, env: Env) {
        await runCli(['start', '--check', '--entry', fixture(entry)], fake.context({ env }));
    }

    const exitCode = () => fake.exitCodes.at(-1) ?? 0;

    it('exits 0 and listens on nothing', async () => {
        await check('app', startEnv(port));

        expect(exitCode()).toBe(0);
        expect(fake.exits).toEqual([]);
        expect(fake.stdout.join('')).toContain('chamvi: start check passed');

        const server = await listenOn(port);

        await closeServer(server);
        expect(fake.signals.listenerCount('SIGTERM')).toBe(0);
    });

    it('exits 2 for a folder issue, one line each', async () => {
        for (const name of ['alpha', 'beta']) {
            await mkdir(path.join(dir, name), { recursive: true });
            await writeFile(path.join(dir, name, 'agent.ts'), 'export default 42;\n');
        }

        await check('app', startEnv(port, { CHAMVI_AGENTS_DIR: dir }));

        expect(exitCode()).toBe(2);
        expect(fake.stdout.join('')).not.toContain('passed');

        const lines = fake.stderr.join('').split('\n').filter((line) => line.length > 0);

        expect(lines).toHaveLength(2);
        expect(lines[0]).toMatch(/^alpha\//);
        expect(lines[1]).toMatch(/^beta\//);
    });

    it('exits 2 without CHAMVI_TOKENS', async () => {
        const env = startEnv(port);

        delete env.CHAMVI_TOKENS;
        await check('app', env);

        expect(exitCode()).toBe(2);
        expect(fake.stderr.join('')).toContain('No authenticator');
    });

    it('exits 2 for a missing provider key, never echoing a value', async () => {
        await check('keyless', startEnv(port, { OPENAI_API_KEY: 'sk-unrelated-secret-value' }));

        expect(exitCode()).toBe(2);
        expect(fake.stderr.join('')).toContain('anthropic');
        expect(fake.stderr.join('')).not.toContain('sk-unrelated-secret-value');
    });

    it('exits 1 for an unreachable DATABASE_URL', async () => {
        const closed = await freePort();

        await check('app', startEnv(port, { DATABASE_URL: `postgres://u:secret@127.0.0.1:${closed}/db` }));

        expect(exitCode()).toBe(1);
        expect(fake.stderr.join('')).not.toContain('secret');
    });
});
