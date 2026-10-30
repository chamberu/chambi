/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import fs from 'node:fs/promises';
import { join } from 'node:path';
import {
    Engine,
    InvalidAgentDefinitionError,
    approve,
    createMemoryStore,
    defineAgent,
} from '@chamvi/core';
import { gitSkills, hashSkillBundle } from '@chamvi/skills';
import { createGitFixture, mockModel } from '@chamvi/test-kit';
import type { MockResponse } from '@chamvi/test-kit';
import { expect, it, vi } from 'vitest';

const load = (name: string, reference?: string): MockResponse => ({
    parts: [{
        type: 'tool-call',
        toolName: 'load_skill',
        toolCallId: reference ? 'reference' : name,
        input: { name, ...(reference ? { reference } : {}) },
    }],
});
const done: MockResponse = { parts: [{ type: 'text', text: 'done' }] };

it('installs Git defaults and agent extras at startup and scopes real load_skill results', async () => {
    const fixture = await createGitFixture({
        'skills/common/SKILL.md': '---\nname: common\ndescription: Shared review guidance\n---\nCOMMON BODY\n',
        'skills/private/SKILL.md': '---\nname: private\ndescription: Maintainer guidance\n---\nPRIVATE BODY\n',
    });
    const engines: Engine[] = [];
    const store = createMemoryStore();
    const pin = (name: string) => ({
        name,
        version: '1.0.0',
        hash: hashSkillBundle(join(fixture.path, 'skills', name)),
    });
    const source = (name: string) => gitSkills({
        source: fixture.url,
        revision: fixture.commit,
        directory: join(fixture.path, 'prepared', name),
        approved: [pin(name)],
    });
    const reader = mockModel([load('private'), load('common'), done]);
    const maintainer = mockModel([load('private'), done]);
    const start = vi.fn(async () => {
        expect(await fs.readFile(join(fixture.path, 'prepared/common/common/SKILL.md'), 'utf8')).toContain('COMMON BODY');
        expect(await fs.readFile(join(fixture.path, 'prepared/private/private/SKILL.md'), 'utf8')).toContain('PRIVATE BODY');
    });

    try {
        const engine = new Engine({
            store,
            skills: [source('common')],
            agents: [defineAgent({
                name: 'reader',
                instructions: '',
                model: reader,
            }), defineAgent({
                name: 'maintainer',
                instructions: '',
                model: maintainer,
                skills: [source('private')],
            })],
            channels: [{ name: 'fixture', start }],
        });

        engines.push(engine);
        await expect(fs.stat(join(fixture.path, 'prepared'))).rejects.toMatchObject({ code: 'ENOENT' });

        const queued = await engine.dispatch({
            agent: 'reader',
            channel: 'fixture',
            trigger: 'fixture',
            payload: {},
        });

        expect(reader.doStreamCalls).toHaveLength(0);
        await engine.start();
        await engine.idle();
        expect(start).toHaveBeenCalledOnce();
        expect((await store.runs.findOne(queued.runId))?.status).toBe('completed');

        const readerSteps = (await store.steps.find(queued.runId)).filter((step) => step.kind === 'tool');

        expect(readerSteps).toMatchObject([
            { error: { message: 'Unknown approved skill.' } },
            { output: { ...pin('common'), content: 'COMMON BODY\n' } },
        ]);

        const initial = JSON.stringify(reader.doStreamCalls[0]!.prompt);

        expect(initial).toContain('Shared review guidance');
        expect(initial).not.toContain('Maintainer guidance');
        expect(initial).not.toContain('BODY');

        const run = await engine.dispatch({
            agent: 'maintainer',
            channel: 'fixture',
            trigger: 'fixture',
            payload: {},
        });

        await engine.idle();
        expect((await store.steps.find(run.runId)).find((step) => step.kind === 'tool')?.output).toMatchObject({ ...pin('private'), content: 'PRIVATE BODY\n' });
    } finally {
        for (const engine of engines) {
            await engine.stop();
            await engine.idle();
        }

        await fixture.cleanup();
    }
});

it('rejects changed Git bytes under an old content pin before recovery and preserves saved loads across a reviewed upgrade', async () => {
    const fixture = await createGitFixture({
        'skills/audit/SKILL.md': '---\nname: audit\ndescription: Review code\n---\nORIGINAL BODY\n',
        'skills/audit/references/checks.md': 'ORIGINAL REFERENCE\n',
    });
    const engines: Engine[] = [];
    const store = createMemoryStore();
    const directory = join(fixture.path, 'prepared');
    const oldPin = {
        name: 'audit',
        version: '1.0.0',
        hash: hashSkillBundle(join(fixture.path, 'skills/audit')),
    };
    const firstModel = mockModel([load('audit'), load('audit', 'references/checks.md')]);
    const resumedModel = mockModel([done]);
    const agent = (model: typeof firstModel) => defineAgent({
        name: 'reviewer',
        instructions: '',
        model,
        hooks: {
            async beforeToolExecution(call, context) {
                if ((call.input as { reference?: string }).reference) {
                    await approve(context, { title: 'Disclose the reference?' });
                }
            },
        },
    });

    try {
        const first = new Engine({
            store,
            agents: [agent(firstModel)],
            skills: [gitSkills({
                source: fixture.url,
                revision: fixture.commit,
                directory,
                approved: [oldPin],
            })],
        });

        engines.push(first);
        await first.start();

        const { runId } = await first.dispatch({
            agent: 'reviewer',
            channel: 'fixture',
            trigger: 'fixture',
            payload: {},
        });

        await first.idle();

        const paused = await store.runs.findOne(runId);

        expect(paused?.status).toBe('waiting');

        const checkpoint = await store.checkpoints.findOne(runId);
        const steps = await store.steps.find(runId);

        expect(steps.filter((step) => step.kind === 'tool').map((step) => step.output)).toMatchObject([
            {
                ...oldPin,
                content: 'ORIGINAL BODY\n',
                reference: null,
            },
        ]);
        await first.stop();
        await fs.writeFile(join(fixture.path, 'skills/audit/SKILL.md'), '---\nname: audit\ndescription: Review code\n---\nUPGRADED BODY\n');
        await fs.writeFile(join(fixture.path, 'skills/audit/references/checks.md'), 'UPGRADED REFERENCE\n');
        await fixture.git('add', '--all', 'skills');
        await fixture.git('commit', '-qm', 'reviewed upgrade');

        const revision = (await fixture.git('rev-parse', 'HEAD')).trim();
        const start = vi.fn();
        const failed = new Engine({
            store,
            agents: [agent(resumedModel)],
            skills: [gitSkills({
                source: fixture.url,
                revision,
                directory,
                approved: [oldPin],
            })],
            channels: [{ name: 'fixture', start }],
        });

        engines.push(failed);
        await expect(failed.start()).rejects.toThrow(InvalidAgentDefinitionError);
        expect(start).not.toHaveBeenCalled();
        expect(resumedModel.doStreamCalls).toHaveLength(0);
        expect(await store.checkpoints.findOne(runId)).toEqual(checkpoint);
        expect(await store.steps.find(runId)).toEqual(steps);
        expect((await store.runs.findOne(runId))?.status).toBe('waiting');
        expect(await fs.readFile(join(directory, 'audit/SKILL.md'), 'utf8')).toContain('ORIGINAL BODY');
        await failed.stop();

        const newPin = {
            ...oldPin,
            version: '2.0.0',
            hash: hashSkillBundle(join(fixture.path, 'skills/audit')),
        };
        const restarted = new Engine({
            store,
            agents: [agent(resumedModel)],
            skills: [gitSkills({
                source: fixture.url,
                revision,
                directory,
                approved: [newPin],
            })],
        });

        engines.push(restarted);
        await restarted.start();
        expect(resumedModel.doStreamCalls).toHaveLength(0);
        await restarted.approve(runId, { approvalId: paused!.waiting!.approvalId, approved: true });
        await restarted.idle();
        expect((await store.runs.findOne(runId))?.status).toBe('completed');

        const outputs = (await store.steps.find(runId)).filter((step) => step.kind === 'tool').map((step) => step.output);

        expect(outputs).toMatchObject([
            {
                ...oldPin,
                content: 'ORIGINAL BODY\n',
                reference: null,
            },
            {
                ...newPin,
                content: 'UPGRADED REFERENCE\n',
                reference: 'references/checks.md',
            },
        ]);

        const prompt = JSON.stringify(resumedModel.doStreamCalls[0]!.prompt);
        const saved = JSON.stringify(await store.checkpoints.findOne(runId));

        for (const output of outputs) {
            expect(prompt).toContain(JSON.stringify(output));
            expect(saved).toContain(JSON.stringify(output));
        }

        expect(prompt).not.toContain('UPGRADED BODY');
    } finally {
        for (const engine of engines) {
            await engine.stop();
            await engine.idle();
        }

        await fixture.cleanup();
    }
});
