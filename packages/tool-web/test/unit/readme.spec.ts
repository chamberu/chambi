/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Engine, MemoryStore } from '@chamvi/core';
import { createResearchAgent } from '../fixtures/readme-example.ts';
import { mockModel } from '../utils/model.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('README example', () => {
    it('is the code of test/fixtures/readme-example.ts', () => {
        const readme = read('../../README.md');
        const blocks = readme.matchAll(/```typescript\n([\s\S]*?)```/g).map((m) => m[1]).toArray();
        expect(blocks).toContain(read('../fixtures/readme-example.ts'));
    });

    it('gives the agent web_fetch and package_info, and web_search with a provider', () => {
        const plain = createResearchAgent(mockModel([]));
        expect(Object.keys(plain.definition.tools as object).sort()).toEqual(['package_info', 'web_fetch']);

        const searching = createResearchAgent(mockModel([]), { search: async () => [] });
        expect(Object.keys(searching.definition.tools as object).sort()).toEqual(['package_info', 'web_fetch', 'web_search']);
    });

    it('answers a refused URL as a tool error the model reads', async () => {
        const agent = createResearchAgent(mockModel([
            {
                parts: [{
                    type: 'tool-call',
                    toolName: 'web_fetch',
                    input: { url: 'http://169.254.169.254/latest/meta-data/' },
                    toolCallId: 'c1',
                }],
            },
            { parts: [{ type: 'text', text: 'That address is not reachable.' }] },
        ]));
        const engine = new Engine({ store: new MemoryStore(), agents: [agent] });
        await engine.start();

        const { runId } = await engine.dispatch({
            agent: agent.name,
            trigger: 'manual',
            channel: 'manual',
            payload: {},
        });
        await engine.idle();

        expect((await engine.getRun(runId))?.status).toBe('completed');
        const steps = await engine.store.listSteps(runId);
        const fetch = steps.find((step) => step.kind === 'tool' && step.name === 'web_fetch');
        expect(fetch?.error).toMatchObject({ code: 'validation_error' });
        engine.stop();
    });
});
