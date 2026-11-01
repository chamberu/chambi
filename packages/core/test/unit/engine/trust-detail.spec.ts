/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { afterEach, expect, it } from 'vitest';
import { z } from 'zod';
import {
    Engine,
    InvalidAgentDefinitionError,
    approve,
    createMemoryStore,
    defineAgent,
    defineTool,
    outboundApproved,
} from '@chamvi/core';
import type { ChannelMessage, IChannel, ToolContext } from '@chamvi/core';
import { mockModel } from '../../utils/mock-model.ts';

const engines: Engine[] = [];

afterEach(() => engines.splice(0).forEach((engine) => engine.stop()));

const call = (toolName: string, input = {}) => ({
    parts: [{
        type: 'tool-call' as const,
        toolName,
        toolCallId: toolName,
        input,
    }],
});
const done = { parts: [{ type: 'text' as const, text: 'done' }] };

function setup(untrusted: boolean) {
    const sent: ChannelMessage[] = [];
    const seen: boolean[] = [];
    let detail = 'abc1234 Fix the build';
    const source: IChannel = {
        name: 'source',
        untrusted,
        out: async (message) => {
            sent.push(message);
        },
    };
    const push = defineTool({
        inputSchema: z.object({ branch: z.string() }),
        trust: {
            guardWhenTainted: true,
            approvalDetail: () => detail,
        },
        execute: async (_input, { context }: { context: ToolContext }) => {
            seen.push(outboundApproved(context));

            if (!outboundApproved(context)) {
                const decision = await approve(context, { title: 'Push?', body: detail });

                return decision.approved ? 'pushed' : 'denied';
            }

            return 'pushed';
        },
    });
    const store = createMemoryStore();
    const engine = new Engine({
        store,
        channels: [source],
        agents: [defineAgent({
            name: 'test',
            instructions: 'test',
            model: mockModel([call('push', { branch: 'fix' }), done]),
            tools: { push },
        })],
    });

    engines.push(engine);

    return {
        engine,
        store,
        sent,
        seen,
        setDetail: (value: string) => {
            detail = value;
        },
        dispatch: async () => {
            await engine.start();

            const { runId } = await engine.dispatch({
                agent: 'test',
                channel: 'source',
                address: 'origin',
                trigger: 'test',
                payload: {},
            });

            await engine.idle();

            return runId;
        },
    };
}

it('carries approvalDetail in the private gate body and tells the tool the gate approved it', async () => {
    const ctx = setup(true);
    const runId = await ctx.dispatch();
    const gate = await ctx.store.runs.findOne(runId);

    expect(gate?.status).toBe('waiting');
    expect(gate?.waiting?.approvalId).toMatch(/^bound:/);
    expect(JSON.parse(gate!.waiting!.body!)).toMatchObject({ tool: 'push', detail: 'abc1234 Fix the build' });
    // the source channel gets the generic notification only
    expect(JSON.stringify(ctx.sent)).not.toContain('Fix the build');

    await ctx.engine.approve(runId, { approvalId: gate!.waiting!.approvalId, approved: true });
    await ctx.engine.idle();

    const run = await ctx.store.runs.findOne(runId);

    // one approval: the tool saw the gate's decision and asked nothing more
    expect(run?.status).toBe('completed');
    expect(ctx.seen).toEqual([true]);
});

it('binds the gate decision to the detail: a changed detail on replay asks again', async () => {
    const ctx = setup(true);
    const runId = await ctx.dispatch();
    const first = await ctx.store.runs.findOne(runId);

    ctx.setDetail('def5678 Something else');
    await ctx.engine.approve(runId, { approvalId: first!.waiting!.approvalId, approved: true });
    await ctx.engine.idle();

    const second = await ctx.store.runs.findOne(runId);

    expect(second?.status).toBe('waiting');
    expect(second?.waiting?.approvalId).not.toBe(first!.waiting!.approvalId);
    expect(JSON.parse(second!.waiting!.body!)).toMatchObject({ detail: 'def5678 Something else' });
});

it('answers false without a gate (untainted run), so the tool asks itself', async () => {
    const ctx = setup(false);
    const runId = await ctx.dispatch();
    const run = await ctx.store.runs.findOne(runId);

    expect(run?.status).toBe('waiting');
    expect(run?.waiting?.title).toBe('Push?');
    expect(ctx.seen).toEqual([false]);
});

it('answers false outside a tool call and refuses a non-function approvalDetail', () => {
    expect(outboundApproved({} as ToolContext)).toBe(false);
    expect(() => defineTool({
        inputSchema: z.object({}),
        trust: { approvalDetail: 'log' as never },
        execute: async () => 'x',
    })).toThrow(InvalidAgentDefinitionError);
});
