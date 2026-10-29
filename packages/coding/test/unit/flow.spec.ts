/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
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
import {
    Engine,
    approve,
    createMemoryStores,
    defineAgent,
} from '@chamvi/core';
import { codingTools } from '@chamvi/coding';
import { createWorkspaceManager } from '@chamvi/sandbox';
import type { ExecResult, IWorkspaceManager, RepositoryInstructions } from '@chamvi/sandbox';
import { createGitFixture } from '@chamvi/test-kit';
import { createLocalSandbox } from '@chamvi/sandbox-local';
import { mockModel } from '../utils/model.ts';
import type { MockResponse } from '../utils/model.ts';
import { FIXTURE_FILES, createFixture } from '../utils/setup.ts';

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
        const store = createMemoryStores();
        const engine = new Engine({
            stores: store,
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

        const run = await store.runs.getRun(runId);
        expect(run?.status).toBe('completed');
        expect(run?.output).toBe('tests failed with exit code 1');

        const steps = await store.steps.listSteps(runId);
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

describe('repository guidance through Engine checkpoints', () => {
    it('delivers scoped context, retains it after restart, then refreshes a new read', async () => {
        const rootContent = 'root guidance\n@missing-guide.md\n';
        const nestedContent = 'nested guidance\n';
        const updatedContent = 'updated nested guidance\n';
        const fixture = await createGitFixture({
            ...FIXTURE_FILES,
            'AGENTS.md': rootContent,
            'src/CLAUDE.md': nestedContent,
            'other/AGENTS.md': 'unrelated guidance\n',
        });
        cleanups.push(() => fixture.cleanup());
        const root = await mkdtemp(join(tmpdir(), 'chamvi-instruction-flow-'));
        cleanups.push(() => rm(root, { recursive: true, force: true }));
        const makeManager = () => createWorkspaceManager({
            provider: createLocalSandbox({ root }),
            allowFileRepos: true,
            gcIntervalMs: 0,
        });
        const firstManager = makeManager();
        cleanups.push(() => firstManager.close());
        const model = mockModel([
            call('create_workspace', { repo: fixture.url }),
            call('read_file', { path: 'src/a.ts' }),
            call('bash', { command: 'true' }),
            call('read_file', { path: 'src/a.ts' }),
            { parts: [{ type: 'text', text: 'guidance received' }] },
        ]);
        const agentFor = (manager: IWorkspaceManager) => defineAgent({
            name: 'instruction-coder',
            instructions: 'Read the repository guidance.',
            model,
            tools: { ...manager.tools(), ...codingTools(manager) },
            hooks: {
                async beforeToolExecution(info, context) {
                    if (info.toolName === 'bash') await approve(context, { title: 'Continue after review?' });
                    return info.input;
                },
            },
        });
        const store = createMemoryStores();
        const first = new Engine({ stores: store, agents: [agentFor(firstManager)] });
        cleanups.push(() => first.stop());
        firstManager.attach(first);
        await first.start();
        const { runId } = await first.dispatch({
            agent: 'instruction-coder',
            trigger: 'http',
            channel: 'http',
            payload: {},
        });
        await first.idle();
        const paused = await store.runs.getRun(runId);
        expect(paused?.status).toBe('waiting');

        const beforeRestart = await store.steps.listSteps(runId);
        const created = beforeRestart.find((step) => step.kind === 'tool' && step.name === 'create_workspace');
        const initialRead = beforeRestart.find((step) => step.kind === 'tool' && step.name === 'read_file');
        const rootInstructions = (created?.output as { instructions: RepositoryInstructions }).instructions;
        const nestedInstructions = (initialRead?.output as { instructions: RepositoryInstructions }).instructions;
        const rootSource = {
            path: 'AGENTS.md',
            content: rootContent,
            sha256: createHash('sha256').update(rootContent).digest('hex'),
            scopes: ['.'],
            includedBy: [],
        };
        const nestedSource = {
            path: 'src/CLAUDE.md',
            content: nestedContent,
            sha256: createHash('sha256').update(nestedContent).digest('hex'),
            scopes: ['src'],
            includedBy: [],
        };
        expect(rootInstructions.sources).toEqual([rootSource]);
        expect(nestedInstructions.sources).toEqual([rootSource, nestedSource]);
        expect(nestedInstructions.diagnostics).toEqual([
            expect.objectContaining({ path: 'missing-guide.md', code: 'missing-include' }),
        ]);
        expect(nestedInstructions.complete).toBe(false);

        const resultsAt = (turn: number) => model.doStreamCalls[turn]!.prompt
            .filter((message) => message.role === 'tool')
            .flatMap((message) => message.content)
            .filter((part) => part.type === 'tool-result')
            .map((part) => ({ name: part.toolName, output: part.output }));
        expect(resultsAt(2)).toEqual(expect.arrayContaining([
            { name: 'create_workspace', output: { type: 'json', value: created!.output } },
            { name: 'read_file', output: { type: 'json', value: initialRead!.output } },
        ]));

        await first.stop();
        const workspace = await firstManager.get(runId);
        await workspace.writeFile('src/CLAUDE.md', updatedContent);
        await firstManager.close();
        const secondManager = makeManager();
        cleanups.push(() => secondManager.close());
        const second = new Engine({ stores: store, agents: [agentFor(secondManager)] });
        cleanups.push(() => second.stop());
        secondManager.attach(second);
        await second.start();
        await second.approve(runId, { approvalId: paused!.waiting!.approvalId, approved: true });
        await second.idle();

        expect(await store.runs.getRun(runId)).toMatchObject({ status: 'completed', output: 'guidance received' });
        expect(resultsAt(3)).toEqual(expect.arrayContaining([
            { name: 'create_workspace', output: { type: 'json', value: created!.output } },
            { name: 'read_file', output: { type: 'json', value: initialRead!.output } },
        ]));
        const steps = await store.steps.listSteps(runId);
        const reads = steps.filter((step) => step.kind === 'tool' && step.name === 'read_file');
        expect(reads).toHaveLength(2);
        expect(reads[0]!.output).toEqual(initialRead!.output);
        const refreshed = (reads[1]!.output as { instructions: RepositoryInstructions }).instructions;
        expect(refreshed.sources).toEqual([
            rootSource,
            {
                ...nestedSource,
                content: updatedContent,
                sha256: createHash('sha256').update(updatedContent).digest('hex'),
            },
        ]);
        expect(refreshed.diagnostics).toEqual(nestedInstructions.diagnostics);
        expect(resultsAt(4)).toContainEqual({ name: 'read_file', output: { type: 'json', value: reads[1]!.output } });
    });
});
