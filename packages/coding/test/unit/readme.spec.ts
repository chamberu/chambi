/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { Engine, MemoryStore } from '@chamvi/core';
import { createWorkspaceManager } from '@chamvi/sandbox';
import { createLocalSandbox } from '@chamvi/sandbox-local';
import { createCodingAgent } from '../fixtures/readme-example.ts';
import { mockModel } from '../utils/model.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('README example', () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'chamvi-coding-readme-'));
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it('is the code of test/fixtures/readme-example.ts', () => {
        const readme = read('../../README.md');
        const blocks = readme.matchAll(/```typescript\n([\s\S]*?)```/g).map((m) => m[1]).toArray();
        expect(blocks).toContain(read('../fixtures/readme-example.ts'));
    });

    it('gives the agent the workspace and coding tools', async () => {
        const workspaces = createWorkspaceManager({ provider: createLocalSandbox({ root }), gcIntervalMs: 0 });
        const agent = createCodingAgent(mockModel([]), workspaces);

        expect(Object.keys(agent.definition.tools as object).sort()).toEqual([
            'bash',
            'bash_kill',
            'bash_output',
            'create_workspace',
            'dispose_workspace',
            'edit_file',
            'git_diff',
            'grep',
            'list_files',
            'multi_edit',
            'read_file',
            'write_file',
        ]);
        expect(agent.definition.hooks?.beforeToolExecution).toBeTypeOf('function');
        await workspaces.close();
    });

    it('puts every bash command behind an approval through the hook', async () => {
        const workspaces = createWorkspaceManager({ provider: createLocalSandbox({ root }), gcIntervalMs: 0 });
        const agent = createCodingAgent(mockModel([
            {
                parts: [{
                    type: 'tool-call', 
                    toolName: 'bash', 
                    input: { command: 'rm -rf /workspace' }, 
                    toolCallId: 'c1', 
                }], 
            },
            { parts: [{ type: 'text', text: 'Not allowed.' }] },
        ]), workspaces);
        const engine = new Engine({
            store: new MemoryStore(), 
            agents: [agent], 
        });
        await engine.start();

        const { runId } = await engine.dispatch({
            agent: agent.name, 
            trigger: 'manual', 
            channel: 'manual', 
            payload: {},
        });
        await engine.idle();

        const waiting = await engine.getRun(runId);
        expect(waiting?.status).toBe('waiting');
        expect(waiting?.waiting?.toolName).toBe('bash');
        expect(waiting?.waiting?.body).toBe('rm -rf /workspace');

        await engine.approve(runId, {
            approvalId: waiting!.waiting!.approvalId, 
            approved: false, 
            reason: 'no', 
        });
        await engine.idle();

        const run = await engine.getRun(runId);
        expect(run?.status).toBe('completed');
        const steps = await engine.store.listSteps(runId);
        const bash = steps.find((step) => step.kind === 'tool' && step.name === 'bash');
        expect(bash?.error).toMatchObject({ code: 'tool_denied' });

        engine.stop();
        await workspaces.close();
    });
});
