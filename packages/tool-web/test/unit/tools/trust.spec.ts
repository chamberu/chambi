/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import type { AgentTrust } from '@chamvi/core';
import { Engine, createMemoryStore, defineAgent } from '@chamvi/core';
import { httpChannel } from '@chamvi/http';
import { webTools } from '@chamvi/tool-web';
import { mockModel } from '../../utils/model.ts';
import { createFakeWeb, text } from '../../utils/web.ts';

/** Two fetches in one run: the first result taints the run, the second runs on a tainted run. */
async function twoFetches(trust?: AgentTrust) {
    const web = createFakeWeb();

    web.routes.set('https://example.com/a', text('first'));
    web.routes.set('https://example.com/b', text('second'));

    const call = (url: string, id: string) => ({
        parts: [{
            type: 'tool-call' as const,
            toolName: 'web_fetch',
            input: { url },
            toolCallId: id,
        }],
    });
    const agent = defineAgent({
        name: 'research',
        instructions: 'Research.',
        model: mockModel([
            call('https://example.com/a', 'c1'),
            call('https://example.com/b', 'c2'),
            { parts: [{ type: 'text', text: 'Done.' }] },
        ]),
        tools: webTools({ client: web.client, lookup: web.lookup }),
        ...(trust ? { trust } : {}),
    });
    const engine = new Engine({
        store: createMemoryStore(),
        agents: [agent],
        channels: [httpChannel()],
    });

    await engine.start();

    const { runId } = await engine.dispatch({
        agent: agent.name,
        trigger: 'http',
        channel: 'http',
        payload: {},
    });

    await engine.idle();

    const run = await engine.getRun(runId);

    engine.stop();

    return { run, web };
}

describe('web_fetch trust', () => {
    it('taints the run but needs no approval for a later fetch', async () => {
        const { run, web } = await twoFetches();

        expect(run?.status).toBe('completed');
        expect(run?.taint?.source).toBe('tool:web_fetch');
        expect(web.calls).toEqual(['https://example.com/a', 'https://example.com/b']);
    });

    it('asks before a fetch on a tainted run with the trust.tools opt-in', async () => {
        const { run, web } = await twoFetches({ tools: { web_fetch: { guardWhenTainted: true } } });

        expect(run?.status).toBe('waiting');
        expect(run?.waiting?.toolName).toBe('web_fetch');
        expect(web.calls).toHaveLength(1);
    });
});
