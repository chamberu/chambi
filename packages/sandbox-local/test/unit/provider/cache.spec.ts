/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    mkdtemp,
    readdir,
    rm,
    stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { CACHE_ENV, cacheEnv } from '@chamvi/sandbox';
import { createLocalSandbox } from '@chamvi/sandbox-local';
import { ControllableClock } from '@chamvi/test-kit';

/** The value of every variable in `env` output. */
function parseEnv(stdout: string): Record<string, string> {
    return Object.fromEntries(stdout.split('\n').filter(Boolean).map((line) => {
        const at = line.indexOf('=');
        return [line.slice(0, at), line.slice(at + 1)];
    }));
}

describe('local sandbox cache', () => {
    let tmp: string;
    let root: string;

    beforeEach(async () => {
        tmp = await mkdtemp(join(tmpdir(), 'chamvi-local-cache-'));
        root = join(tmp, 'workspaces');
    });

    afterEach(async () => {
        await rm(tmp, { recursive: true, force: true });
    });

    it('points the package caches into <root>/.cache, shared by the workspaces', async () => {
        const provider = createLocalSandbox({ root });
        const first = await provider.create({ runId: 'r1' });
        const second = await provider.create({ runId: 'r2' });
        try {
            const env = parseEnv((await first.exec(['env'])).stdout);
            const expected = cacheEnv(join(root, '.cache'));
            for (const key of Object.keys(CACHE_ENV)) expect(env[key]).toBe(expected[key]);

            await first.exec(['sh', '-c', 'mkdir -p "$npm_config_cache" && echo shared > "$npm_config_cache/probe"']);
            expect((await second.exec(['sh', '-c', 'cat "$npm_config_cache/probe"'])).stdout).toBe('shared\n');
            expect((await stat(join(root, '.cache', 'npm'))).isDirectory()).toBe(true);
        } finally {
            await first.dispose();
            await second.dispose();
        }
    });

    it('sets no cache variable with cache false', async () => {
        const workspace = await createLocalSandbox({ root, cache: false }).create({ runId: 'r1' });
        try {
            const env = parseEnv((await workspace.exec(['env'])).stdout);
            for (const key of Object.keys(CACHE_ENV)) expect(env).not.toHaveProperty(key);
        } finally {
            await workspace.dispose();
        }
    });

    it('lets the configured env win over a cache variable', async () => {
        const workspace = await createLocalSandbox({ root, env: { PIP_CACHE_DIR: '/elsewhere' } }).create({ runId: 'r1' });
        try {
            expect(parseEnv((await workspace.exec(['env'])).stdout).PIP_CACHE_DIR).toBe('/elsewhere');
        } finally {
            await workspace.dispose();
        }
    });

    it('never collects the cache folder', async () => {
        const clock = new ControllableClock(new Date());
        const provider = createLocalSandbox({
            root, 
            clock, 
            limits: { maxLifetimeMs: 1_000 }, 
        });
        const workspace = await provider.create({ runId: 'r1' });
        await workspace.exec(['sh', '-c', 'mkdir -p "$npm_config_cache"']);
        clock.advance(1_000);
        expect(await provider.collectGarbage()).toBe(1);
        expect(await readdir(root)).toEqual(['.cache']);
    });

    it('refuses a cache that is no boolean', () => {
        expect(() => createLocalSandbox({ root, cache: 'yes' as never })).toThrow(InvalidAgentDefinitionError);
    });
});
