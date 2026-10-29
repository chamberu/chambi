/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { join } from 'node:path';
import {
    Engine,
    MemoryStore,
    defineAgent,
    hashSkillBundle,
} from '@chamvi/app';
import { ControllableClock, createGitFixture } from '@chamvi/test-kit';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { expect, it } from 'vitest';
import { prepareCatalog } from '../fixtures/readme-example.ts';

it('prepares reviewed bytes for metadata-only initial context and body/reference Engine results', async () => {
    const fixture = await createGitFixture({
        'skills/audit/SKILL.md': '---\nname: audit\ndescription: Review code\n---\nPRIVATE BODY\n',
        'skills/audit/references/checks.md': 'PRIVATE REFERENCE\n',
    });
    const directory = join(fixture.path, 'prepared');
    const sha256 = hashSkillBundle(join(fixture.path, 'skills/audit'));
    const clock = new ControllableClock();
    const store = new MemoryStore({ clock });
    let turn = 0;
    const model = new MockLanguageModelV4({
        doStream: async () => {
            const index = turn++;
            const input = index === 0 ? { name: 'audit' } : { name: 'audit', reference: 'references/checks.md' };
            return {
                stream: simulateReadableStream<LanguageModelV4StreamPart>({
                    chunks: index < 2 ? [
                        {
                            type: 'tool-call',
                            toolCallId: `load-${index}`,
                            toolName: 'load_skill',
                            input: JSON.stringify(input),
                        },
                        {
                            type: 'finish',
                            finishReason: { unified: 'tool-calls', raw: undefined },
                            usage: {
                                inputTokens: {
                                    total: 1,
                                    noCache: undefined,
                                    cacheRead: undefined,
                                    cacheWrite: undefined,
                                },
                                outputTokens: {
                                    total: 1,
                                    text: undefined,
                                    reasoning: undefined,
                                },
                            },
                        },
                    ] : [
                        { type: 'text-start', id: 'done' },
                        {
                            type: 'text-delta',
                            id: 'done',
                            delta: 'done',
                        },
                        { type: 'text-end', id: 'done' },
                        {
                            type: 'finish',
                            finishReason: { unified: 'stop', raw: undefined },
                            usage: {
                                inputTokens: {
                                    total: 1,
                                    noCache: undefined,
                                    cacheRead: undefined,
                                    cacheWrite: undefined,
                                },
                                outputTokens: {
                                    total: 1,
                                    text: undefined,
                                    reasoning: undefined,
                                },
                            },
                        },
                    ],
                }),
            };
        },
    });
    const options = {
        source: fixture.url,
        revision: fixture.commit,
        names: ['audit'],
        directory,
    };
    let engine: Engine | undefined;
    try {
        const catalog = await prepareCatalog(options, { audit: sha256 });
        const agent = defineAgent({
            name: 'reviewer',
            instructions: catalog.instructions,
            tools: catalog.tools,
            model,
        });
        engine = new Engine({
            agents: [agent],
            store,
            clock,
        });
        await engine.start();
        const { runId } = await engine.dispatch({
            agent: 'reviewer',
            channel: 'http',
            trigger: 'http',
            payload: {},
        });
        await engine.idle();
        expect(await store.getRun(runId)).toMatchObject({ status: 'completed', output: 'done' });
        const initial = JSON.stringify(model.doStreamCalls[0]!.prompt);
        expect(initial).toContain(sha256);
        expect(initial).toContain('Review code');
        expect(initial).not.toContain('PRIVATE');
        expect(initial).not.toContain(directory);
        const tools = (await store.listSteps(runId)).filter((step) => step.kind === 'tool');
        expect(tools.map((step) => step.output)).toMatchObject([
            {
                sha256,
                version: fixture.commit,
                reference: null,
                content: 'PRIVATE BODY\n',
            },
            {
                sha256,
                version: fixture.commit,
                reference: 'references/checks.md',
                content: 'PRIVATE REFERENCE\n',
            },
        ]);
        expect(JSON.stringify(await store.latestCheckpoint(runId))).toContain('PRIVATE REFERENCE');
        await expect(prepareCatalog(options, { audit: '0'.repeat(64) })).rejects.toThrow();
        expect(hashSkillBundle(join(directory, 'audit'))).toBe(sha256);
    } finally {
        engine?.stop();
        await engine?.idle();
        await fixture.cleanup();
    }
});
