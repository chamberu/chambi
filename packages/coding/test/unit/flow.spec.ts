/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { Engine, MemoryStore, defineAgent } from '@chamvi/core';
import { codingTools } from '@chamvi/coding';
import { createWorkspaceManager } from '@chamvi/sandbox';
import type { ExecResult } from '@chamvi/sandbox';
import { createLocalSandbox } from '@chamvi/sandbox-local';
import { mockModel } from '../utils/model.ts';
import type { MockResponse } from '../utils/model.ts';
import { createFixture } from '../utils/setup.ts';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups.length = 0;
});

const call = (toolName: string, input: unknown): MockResponse => ({
    parts: [{
        type: 'tool-call',
        toolName,
        input,
    }],
});

describe('coding flow (local)', () => {
    it('creates a workspace, runs the tests and disposes it with the run', async () => {
        const fixture = await createFixture();
        cleanups.push(() => fixture.cleanup());
        const root = await mkdtemp(join(tmpdir(), 'chamvi-coding-flow-'));
        cleanups.push(() => rm(root, { recursive: true, force: true }));

        const manager = createWorkspaceManager({
            provider: createLocalSandbox({ root }),
            allowFileRepos: true,
            gcIntervalMs: 0,
        });
        cleanups.push(() => manager.close());
        const agent = defineAgent({
            name: 'coder',
            instructions: 'You run the tests of a repository.',
            model: mockModel([
                call('create_workspace', { repo: fixture.url }),
                call('bash', { command: 'npm test' }),
                { parts: [{ type: 'text', text: 'tests failed with exit code 1' }] },
            ]),
            tools: { ...manager.tools(), ...codingTools(manager) },
        });
        const store = new MemoryStore();
        const engine = new Engine({
            store,
            agents: [agent],
            onError: () => {},
        });
        cleanups.push(() => engine.stop());
        manager.attach(engine);
        await engine.start();

        const { runId } = await engine.dispatch({
            agent: 'coder',
            trigger: 'http',
            channel: 'http',
            payload: {},
        });
        await engine.idle();

        const run = await store.getRun(runId);
        expect(run?.status).toBe('completed');
        expect(run?.output).toBe('tests failed with exit code 1');

        const steps = await store.listSteps(runId);
        const create = steps.find((step) => step.kind === 'tool' && step.name === 'create_workspace');
        expect(create?.error).toBeUndefined();
        expect(create?.output).toMatchObject({ repo: fixture.url, commit: fixture.commit });
        const bash = steps.find((step) => step.kind === 'tool' && step.name === 'bash');
        expect(bash?.error).toBeUndefined();
        const result = bash?.output as ExecResult;
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('1 failing');
        expect(result.timedOut).toBe(false);

        await vi.waitFor(async () => {
            // every workspace folder is gone; the shared package cache stays for the next run
            expect((await readdir(root)).filter((name) => name !== '.cache')).toEqual([]);
        }, { timeout: 5_000 });
    });
});
