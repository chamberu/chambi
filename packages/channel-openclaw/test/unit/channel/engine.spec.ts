/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { LanguageModel } from 'ai';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import { z } from 'zod';
import type { ChamviError } from '@chamvi/core';
import {
    Engine,
    createMemoryRepositories,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import { openclawChannel } from '@chamvi/channel-openclaw';
import type { OpenclawChannelOptions } from '@chamvi/channel-openclaw';
import { ControllableClock } from '@chamvi/test-kit';
import { approvalModel, mockModel } from '../../utils/model.ts';
import { createFakeOpenclaw } from '../../utils/openclaw.ts';

const TOKEN = 'hooks-token-0123456789';

const engines: Engine[] = [];

afterEach(async () => {
    await Promise.all(engines.map((engine) => engine.stop()));
    engines.length = 0;
});

function setup(
    model: LanguageModel = approvalModel('deploy', { env: 'prod' }),
    patch: Partial<OpenclawChannelOptions> = {},
) {
    const clock = new ControllableClock(new Date('2026-10-21T09:00:00Z'));
    const fake = createFakeOpenclaw({ token: TOKEN, clock });
    const executed: unknown[] = [];
    const deploy = defineTool({
        inputSchema: z.object({ env: z.string() }),
        execute: async (input, { context }) => {
            const { approved } = await context.channels.findOneOrFail('openclaw').approve({
                title: `Deploy to ${input.env}?`,
                body: 'Release v1.2.0.',
                // the owner's chat; overrides deliver.to
                address: 'owner-chat',
            });
            if (!approved) return 'not deployed';
            executed.push(input);
            return `deployed ${input.env}`;
        },
    });
    const announce = defineTool({
        inputSchema: z.object({ text: z.string(), to: z.string() }),
        execute: async ({ text, to }, { context }) => {
            await context.channels.findOneOrFail('openclaw').emit({ title: 'Release', body: text }, to);
            return 'sent';
        },
    });
    const agent = defineAgent({
        name: 'deployer',
        model,
        instructions: 'Deploy.',
        tools: { deploy, announce },
    });
    const errors: unknown[] = [];
    const engine = new Engine({
        repositories: createMemoryRepositories({ clock }),
        agents: [agent],
        channels: [
            openclawChannel({
                baseUrl: 'http://openclaw:18789',
                hooksToken: TOKEN,
                deliver: { channel: 'telegram', to: '12345' },
                clock,
                fetch: fake.fetch,
                ...patch,
            }),
        ],
        clock,
        claimTtlMs: 30,
        onError: (error) => {
            errors.push(error);
        },
    });
    engines.push(engine);
    return {
        clock,
        fake,
        engine,
        errors,
        executed,
    };
}

type Ctx = ReturnType<typeof setup>;

async function dispatch(ctx: Ctx) {
    await ctx.engine.start();
    const { runId } = await ctx.engine.dispatch({
        agent: 'deployer',
        trigger: 'http',
        channel: 'http',
        payload: {},
    });
    await ctx.engine.idle();
    return runId;
}

async function dispatchToWaiting(ctx: Ctx) {
    const runId = await dispatch(ctx);
    const run = await ctx.engine.getRun(runId);
    expect(run?.status).toBe('waiting');
    return runId;
}

describe('openclawChannel with the engine', () => {
    it('sends one hook per approval', async () => {
        const ctx = setup();
        const runId = await dispatchToWaiting(ctx);
        expect(ctx.fake.requests).toHaveLength(1);
        expect(ctx.fake.dispatched).toHaveLength(1);
        const waiting = (await ctx.engine.getRun(runId))!.waiting!;
        expect(waiting.notifiedAt).toBeInstanceOf(Date);
        expect(ctx.fake.requests[0]!.headers['idempotency-key']).toBe(`${runId}:${waiting.approvalId}`);
        expect(ctx.fake.dispatched[0]).toMatchObject({ channel: 'telegram', to: 'owner-chat' });
        expect(ctx.fake.dispatched[0]!.message).toContain('Deploy to prod?\n\nRelease v1.2.0.');

        await ctx.engine.tick();
        await ctx.engine.tick();
        expect(ctx.fake.requests).toHaveLength(1);
        expect(ctx.errors).toEqual([]);
    });

    it('retries a failed hook with the same key', async () => {
        const ctx = setup();
        ctx.fake.failNext(503);
        const runId = await dispatchToWaiting(ctx);
        expect(ctx.errors).toHaveLength(1);
        expect((ctx.errors[0] as ChamviError).code).toBe('openclaw_request');
        expect((await ctx.engine.getRun(runId))?.waiting?.notifiedAt).toBeUndefined();

        await ctx.engine.tick();
        expect(ctx.fake.requests).toHaveLength(2);
        const [first, second] = ctx.fake.requests;
        expect(second!.headers['idempotency-key']).toBe(first!.headers['idempotency-key']);
        expect(JSON.stringify(second!.body)).toBe(JSON.stringify(first!.body));
        expect(ctx.fake.dispatched).toHaveLength(1);
        expect((await ctx.engine.getRun(runId))?.waiting?.notifiedAt).toBeInstanceOf(Date);
    });

    it('replays a lost response', async () => {
        const ctx = setup();
        ctx.fake.loseNextResponse();
        const runId = await dispatchToWaiting(ctx);
        expect(ctx.errors).toHaveLength(1);
        // OpenClaw admitted the first send, the engine never learned it
        expect(ctx.fake.dispatched).toHaveLength(1);

        await ctx.engine.tick();
        expect(ctx.fake.requests).toHaveLength(2);
        // one admitted OpenClaw run per approval across engine retries
        expect(ctx.fake.dispatched).toHaveLength(1);
        expect((await ctx.engine.getRun(runId))?.waiting?.notifiedAt).toBeInstanceOf(Date);
    });

    it('the approval message links the approval, which the owner answers there', async () => {
        const ctx = setup(undefined, { approvalUrl: (ref) => `https://chamvi.example/ui/approvals?run=${ref.runId}&approval=${ref.approvalId}&agent=${ref.agent}` });
        const runId = await dispatchToWaiting(ctx);
        const waiting = (await ctx.engine.getRun(runId))!.waiting!;
        const [request] = ctx.fake.requests;
        expect((request!.body as { message: string }).message).toContain(`Approve or deny: https://chamvi.example/ui/approvals?run=${runId}&approval=${waiting.approvalId}&agent=deployer`);
        const sent = JSON.stringify({
            url: request!.url,
            headers: request!.headers,
            body: request!.body,
        });
        expect(sent).not.toContain('resume_run');

        await ctx.engine.approve(runId, { approvalId: waiting.approvalId, approved: true });
        await ctx.engine.idle();
        expect((await ctx.engine.getRun(runId))?.status).toBe('completed');
        expect(ctx.executed).toEqual([{ env: 'prod' }]);
        expect(ctx.fake.requests).toHaveLength(1);
    });

    it('emit sends a message to the given address once', async () => {
        const announce = {
            type: 'tool-call' as const,
            toolName: 'announce',
            input: { text: 'v1.2.0 is out.', to: '-100777' },
        };
        const ctx = setup(mockModel([
            { parts: [announce] },
            // the same text again: content-addressed, so not sent twice
            { parts: [announce] },
            { parts: [{ type: 'text', text: 'Announced.' }] },
        ]));
        const runId = await dispatch(ctx);
        expect((await ctx.engine.getRun(runId))?.status).toBe('completed');
        expect(ctx.fake.requests).toHaveLength(1);
        expect(ctx.fake.dispatched[0]).toMatchObject({ channel: 'telegram', to: '-100777' });
        expect(ctx.fake.dispatched[0]!.message).toContain('Release\n\nv1.2.0 is out.');
        expect(ctx.fake.requests[0]!.headers['idempotency-key']).toMatch(new RegExp(`^${runId}:emit:openclaw:`));
        expect(ctx.errors).toEqual([]);
    });
});
