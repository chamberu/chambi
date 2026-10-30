/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { expect, it } from 'vitest';
import {
    AppToken,
    ModuleName,
    createApp,
    createMemoryStore,
    defineAgent,
    storeModule,
} from '@chamvi/app';
import type { IEngine } from '@chamvi/core';
import { defineSkillSource, loadSkillBundle } from '@chamvi/skills';
import { mockModel } from '@chamvi/test-kit';
import { approvedSkill, cleanupSkills } from '../../utils/skills.ts';

it('prepares real app defaults before engineCreated and combines factory extras in ordinary execution', async () => {
    const common = loadSkillBundle(approvedSkill('common', { body: 'DEFAULT BODY' }));
    const extra = loadSkillBundle(approvedSkill('extra', { body: 'EXTRA BODY' }));
    const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
    let loaded = false; let engine: IEngine | undefined;
    const model = mockModel([
        {
            parts: [{
                type: 'tool-call',
                toolName: 'load_skill',
                input: { name: 'common' },
            }],
        },
        {
            parts: [{
                type: 'tool-call',
                toolName: 'load_skill',
                input: { name: 'extra' },
            }],
        },
        { parts: [{ type: 'text', text: 'done' }] },
    ]);
    const store = createMemoryStore();
    const app = createApp({
        agents: [defineAgent({
            name: 'reviewer',
            model,
            instructions: '',
            skills: [extra],
        })],
        skills: [defineSkillSource({
            skills: [common],
            async load() {
                entered.resolve(); await release.promise; loaded = true;

                return [common];
            },
        })],
        modules: [storeModule({ store }), { name: ModuleName.HTTP, setup: () => Promise.resolve() }, {
            name: 'observe',
            async setup(container) {
                container.registerMany(AppToken.LIFECYCLE_HOOKS, {
                    useValue: {
                        name: 'observe',
                        engineCreated(value) {
                            expect(loaded).toBe(true); engine = value;
                        },
                    },
                });
            },
        }],
    });

    try {
        const starting = app.start({ env: {} });

        await entered.promise;
        expect(engine).toBeUndefined(); expect(model.doStreamCalls).toHaveLength(0);
        release.resolve(); await starting;

        const run = await engine!.dispatch({
            agent: 'reviewer',
            channel: 'test',
            trigger: 'test',
            payload: {},
        });

        await engine!.idle();
        expect((await store.runs.findOne(run.runId))?.status).toBe('completed');

        const tools = (await store.steps.find(run.runId)).filter((step) => step.kind === 'tool');

        expect(tools.map((step) => step.output)).toMatchObject([{ content: 'DEFAULT BODY' }, { content: 'EXTRA BODY' }]);

        const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);

        expect(prompt).toContain('common'); expect(prompt).toContain('extra'); expect(prompt).not.toContain('BODY');
    } finally {
        release.resolve(); await app.stop(); cleanupSkills();
    }
});
