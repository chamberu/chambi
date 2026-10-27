/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { ChamviError } from '@chamvi/core';
import type { ChannelMessage, ChannelSendOptions, TriggerEnvelope } from '@chamvi/core';
import { MESSAGE_BODY_MAX_LENGTH, OPENCLAW_TIMEOUT_MS, openclawChannel } from '@chamvi/channel-openclaw';
import type { OpenclawChannelOptions } from '@chamvi/channel-openclaw';
import { ControllableClock } from '@chamvi/test-kit';
import { createFakeOpenclaw } from '../../utils/openclaw.ts';

const TOKEN = 'hooks-token-0123456789';

const trigger: TriggerEnvelope = {
    id: 'e1',
    agent: 'release',
    trigger: 'http',
    channel: 'http',
    payload: {},
    receivedAt: new Date('2026-10-21T09:00:00Z'),
};

const approval: ChannelMessage = {
    kind: 'approval',
    key: 'r1:a1',
    agent: 'release',
    runId: 'r1',
    title: 'Deploy to prod?',
    body: 'Release v1.2.0 goes to:\n{\n  "env": "prod"\n}',
    approvalId: 'a1',
    expiresAt: new Date('2026-10-21T10:00:00Z'),
};

const message: ChannelMessage = {
    kind: 'message',
    key: 'r1:emit:openclaw:abc',
    agent: 'release',
    runId: 'r1',
    title: 'Done',
    body: 'Deployed.',
};

const opts: ChannelSendOptions = { signal: new AbortController().signal, trigger };

const approvalUrl: OpenclawChannelOptions['approvalUrl'] = (ref) => `https://app.example/ui/approvals?run=${ref.runId}&approval=${ref.approvalId}`;

const RELAY = 'chamvi message. Relay it to the user; keep every link and id exactly as written.';

function setup(patch: Partial<OpenclawChannelOptions> = {}) {
    const clock = new ControllableClock(new Date('2026-10-21T09:00:00Z'));
    const fake = createFakeOpenclaw({ token: TOKEN, clock });
    const channel = openclawChannel({
        baseUrl: 'http://openclaw:18789',
        hooksToken: TOKEN,
        agentId: 'main',
        deliver: { channel: 'telegram', to: '12345' },
        clock,
        fetch: fake.fetch,
        ...patch,
    });
    const send = (m: ChannelMessage, address = '', o: ChannelSendOptions = opts) => channel.out!(m, address, o);
    return {
        clock,
        fake,
        channel,
        send,
    };
}

const messageOf = (body: unknown) => (body as { message: string }).message;

async function rejection(promise: Promise<unknown>): Promise<ChamviError> {
    const error = await promise.then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(ChamviError);
    return error as ChamviError;
}

describe('openclawChannel out', () => {
    it('posts the hook', async () => {
        const { fake, send } = setup();
        await send(approval);
        expect(fake.requests).toHaveLength(1);
        const [request] = fake.requests;
        expect(request!.url).toBe('http://openclaw:18789/hooks/agent');
        expect(request!.method).toBe('POST');
        expect(request!.headers).toMatchObject({
            'authorization': `Bearer ${TOKEN}`,
            'idempotency-key': 'r1:a1',
            'content-type': 'application/json',
        });
        expect(request!.body).toEqual({
            message: expect.any(String),
            name: 'chamvi',
            agentId: 'main',
            deliver: true,
            channel: 'telegram',
            to: '12345',
        });
        expect(fake.dispatched).toHaveLength(1);
    });

    it('address overrides deliver.to', async () => {
        const { fake, send } = setup();
        await send(message, '-100777');
        await send({ ...message, key: 'r1:emit:openclaw:def' }, '');
        expect(fake.requests.map((r) => (r.body as { to: string }).to)).toEqual(['-100777', '12345']);
        expect(fake.requests.map((r) => (r.body as { channel: string }).channel)).toEqual(['telegram', 'telegram']);
    });

    it('sends the accountId and omits a missing agentId', async () => {
        const { fake, send } = setup({
            agentId: undefined,
            deliver: {
                channel: 'telegram',
                to: '12345',
                accountId: 'bot-2',
            },
        });
        await send(approval);
        const body = fake.requests[0]!.body as Record<string, unknown>;
        expect(body.accountId).toBe('bot-2');
        expect(body).not.toHaveProperty('agentId');
    });

    it('posts under a custom hooks path', async () => {
        const clock = new ControllableClock();
        // a reverse proxy serving the gateway under /base
        const fake = createFakeOpenclaw({ token: TOKEN, hooksPath: '/base/oc-hooks' });
        const channel = openclawChannel({
            baseUrl: 'https://gw.example/base/',
            hooksToken: TOKEN,
            hooksPath: '/oc-hooks',
            deliver: { channel: 'telegram', to: '12345' },
            clock,
            fetch: fake.fetch,
        });
        await channel.out!(approval, '', opts);
        expect(fake.requests[0]!.url).toBe('https://gw.example/base/oc-hooks/agent');
    });

    it('drops a trailing slash of the hooks path', async () => {
        const fake = createFakeOpenclaw({ token: TOKEN });
        const channel = openclawChannel({
            baseUrl: 'http://openclaw:18789',
            hooksToken: TOKEN,
            hooksPath: '/hooks/',
            deliver: { channel: 'telegram', to: '12345' },
            clock: new ControllableClock(),
            fetch: fake.fetch,
        });
        await channel.out!(approval, '', opts);
        expect(fake.requests[0]!.url).toBe('http://openclaw:18789/hooks/agent');
    });

    it('renders an approval with the hint when no link is configured', async () => {
        const { fake, send } = setup();
        await send(approval);
        expect(messageOf(fake.requests[0]!.body)).toBe([
            RELAY,
            '',
            'Deploy to prod?',
            '',
            approval.body,
            '',
            'Agent: release',
            'Run: r1',
            '',
            'Expires: 2026-10-21T10:00:00.000Z',
            'Answer it in the chamvi UI or through POST /runs/:id/approve.',
        ].join('\n'));
        // the hint names no path that needs the token (MCP resume_run)
        expect(messageOf(fake.requests[0]!.body)).not.toMatch(/MCP|resume_run/);
    });

    it.each<[string, Partial<OpenclawChannelOptions>]>([
        ['without options', {}],
        ['with approvalUrl', { approvalUrl }],
        // the former notifier option is gone: nothing puts a token in again
        ['with a leftover resumeTool', { resumeTool: true } as Partial<OpenclawChannelOptions>],
    ])('the message holds no token %s', async (_label, patch) => {
        const { fake, send } = setup(patch);
        await send(approval);
        const sent = JSON.stringify(fake.requests);
        expect(sent).not.toContain('resume_run');
        expect(sent).not.toContain('"token"');
        expect(sent).not.toMatch(/token=/);
        expect(messageOf(fake.requests[0]!.body).split('\n')[0]).toBe(RELAY);
    });

    it('renders only the approval link when configured', async () => {
        const refs: unknown[] = [];
        const { fake, send } = setup({
            approvalUrl: (ref) => {
                refs.push(ref);
                return approvalUrl(ref);
            },
        });
        await send(approval);
        expect(refs).toEqual([{
            runId: 'r1',
            approvalId: 'a1',
            agent: 'release',
        }]);
        const text = messageOf(fake.requests[0]!.body);
        expect(text.endsWith('Expires: 2026-10-21T10:00:00.000Z\nApprove or deny: https://app.example/ui/approvals?run=r1&approval=a1')).toBe(true);
        expect(text).not.toContain('Answer it in the chamvi UI');
    });

    it('renders the hint instead of a link for an approval without an approvalId', async () => {
        const refs: unknown[] = [];
        const { fake, send } = setup({
            approvalUrl: (ref) => {
                refs.push(ref);
                return approvalUrl(ref);
            },
        });
        const withoutId: ChannelMessage = { ...approval };
        delete withoutId.approvalId;
        await send(withoutId);
        expect(refs).toEqual([]);
        const text = messageOf(fake.requests[0]!.body);
        expect(text).not.toContain('Approve or deny');
        expect(text).toContain('Answer it in the chamvi UI or through POST /runs/:id/approve.');
    });

    it('lists the options of a choice approval', async () => {
        const { fake, send } = setup({ approvalUrl });
        const choice: ChannelMessage = {
            ...approval,
            options: [{
                id: 'a', 
                label: 'A', 
                detail: 'secret detail', 
            }, { id: 'b', label: 'B' }],
        };
        await send(choice);
        await send(choice);
        const text = messageOf(fake.requests[0]!.body);
        expect(text).toBe([
            RELAY,
            '',
            'Deploy to prod?',
            '',
            approval.body,
            '',
            'Options (choose one):\n- a: A\n- b: B',
            '',
            'Agent: release',
            'Run: r1',
            '',
            'Expires: 2026-10-21T10:00:00.000Z',
            'Choose and approve or deny: https://app.example/ui/approvals?run=r1&approval=a1',
        ].join('\n'));
        expect(text).not.toContain('secret detail');
        expect(messageOf(fake.requests[1]!.body)).toBe(text);
    });

    it('names where to choose without a link', async () => {
        const { fake, send } = setup();
        await send({
            ...approval, 
            options: [{ id: 'a', label: 'A' }], 
            multiple: true, 
        });
        const text = messageOf(fake.requests[0]!.body);
        expect(text).toContain('Options (choose one or more):\n- a: A');
        expect(text.endsWith('Choose in the chamvi UI or through POST /runs/:id/approve with selected.')).toBe(true);
    });

    it('renders a message without approval lines', async () => {
        const { fake, send } = setup({ approvalUrl });
        await send(message, 'C1');
        expect(messageOf(fake.requests[0]!.body)).toBe([
            RELAY,
            '',
            'Done',
            '',
            'Deployed.',
            '',
            'Agent: release',
            'Run: r1',
        ].join('\n'));
        expect(fake.requests[0]!.headers['idempotency-key']).toBe(message.key);
    });

    it('renders a message without a title', async () => {
        const { fake, send } = setup();
        const untitled: ChannelMessage = { ...message };
        delete untitled.title;
        await send(untitled, 'C1');
        expect(messageOf(fake.requests[0]!.body)).toBe([
            RELAY,
            '',
            'Deployed.',
            '',
            'Agent: release',
            'Run: r1',
        ].join('\n'));
    });

    it('renders an approval asked without a body', async () => {
        const { fake, send } = setup({ approvalUrl });
        await send({ ...approval, body: '' });
        expect(messageOf(fake.requests[0]!.body)).toBe([
            RELAY,
            '',
            'Deploy to prod?',
            '',
            'Agent: release',
            'Run: r1',
            '',
            'Expires: 2026-10-21T10:00:00.000Z',
            'Approve or deny: https://app.example/ui/approvals?run=r1&approval=a1',
        ].join('\n'));
    });

    it('is deterministic', async () => {
        const {
            fake,
            send,
            clock,
        } = setup({ approvalUrl });
        await send(approval);
        clock.advance(60_000);
        await send(approval);
        expect(JSON.stringify(fake.requests[1]!.body)).toBe(JSON.stringify(fake.requests[0]!.body));
        expect(fake.requests[1]!.headers['idempotency-key']).toBe(fake.requests[0]!.headers['idempotency-key']);
        // OpenClaw replays the second request instead of starting another run
        expect(fake.dispatched).toHaveLength(1);
    });

    it('cuts a huge body', async () => {
        const { fake, send } = setup();
        await send({ ...approval, body: 'x'.repeat(1024 * 1024) });
        const text = messageOf(fake.requests[0]!.body);
        expect(text.length).toBeLessThan(MESSAGE_BODY_MAX_LENGTH + 500);
        expect(text).toContain('more characters)\n\nAgent: release');
        expect(text).toContain(`(cut, ${1024 * 1024 - MESSAGE_BODY_MAX_LENGTH} more characters)`);
    });

    it('never splits a surrogate pair', async () => {
        const { fake, send } = setup();
        // the cut point falls between the two halves of an emoji
        const body = `${'x'.repeat(MESSAGE_BODY_MAX_LENGTH - 1)}😀${'y'.repeat(100)}`;
        await send({ ...approval, body });
        const text = messageOf(fake.requests[0]!.body);
        expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
        expect(text).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    });

    it('hashes a long key', async () => {
        const { fake, send } = setup();
        const long = 'k'.repeat(300);
        await send({ ...approval, key: long });
        await send({ ...approval, key: long });
        const sent = fake.requests.map((r) => r.headers['idempotency-key']);
        expect(sent[0]).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(sent[1]).toBe(sent[0]);
        expect(fake.dispatched).toHaveLength(1);

        const exact = 'k'.repeat(256);
        await send({ ...approval, key: exact });
        expect(fake.requests[2]!.headers['idempotency-key']).toBe(exact);
    });

    it('hashes a key with whitespace', async () => {
        const { fake, send } = setup();
        await send({ ...approval, key: ' r1 a1 ' });
        expect(fake.requests[0]!.headers['idempotency-key']).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it.each([
        [400, {}, '{"error":"bad channel"}'],
        [401, {}, undefined],
        [404, {}, undefined],
        [409, {}, undefined],
        [413, {}, undefined],
        [429, { 'retry-after': '30' }, undefined],
        [503, {}, undefined],
    ])('throws on a refused hook (%i)', async (status, headers, body) => {
        const { fake, send } = setup();
        fake.failNext(status, headers, body);
        const error = await rejection(send(approval));
        expect(error.code).toBe('openclaw_request');
        expect(error.message.startsWith(`OpenClaw ${status}:`)).toBe(true);
        expect(error.message).toContain(body ?? '{"error":"injected"}');
        if (status === 429) expect(error.message).toContain('retry after 30');
        expect(error.message).not.toContain(TOKEN);
        expect(fake.dispatched).toHaveLength(0);
    });

    it('cuts the response text', async () => {
        const { fake, send } = setup();
        fake.failNext(400, {}, 'e'.repeat(10_000));
        const error = await rejection(send(approval));
        expect(error.message.length).toBeLessThan(700);
    });

    it('redacts an echoed hooks token', async () => {
        const { fake, send } = setup();
        fake.failNext(400, {}, `{"error":"rejected: $MESSAGE","auth":"${TOKEN}"}`);
        const error = await rejection(send(approval));
        expect(error.message).toContain('[redacted]');
        expect(error.message).not.toContain(TOKEN);
    });

    it('throws on a network failure', async () => {
        const { fake, send } = setup();
        fake.loseNextResponse();
        const error = await rejection(send(approval));
        expect(error.code).toBe('openclaw_request');
        expect(error.message).toBe('OpenClaw request failed: fetch failed (other side closed)');
    });

    it('redacts the hooks token in a fetch failure and its cause', async () => {
        const { send } = setup({
            fetch: async () => {
                throw new TypeError(`Headers.append: "Bearer ${TOKEN}" is an invalid header value.`, { cause: new Error(`${TOKEN} seen`) });
            },
        });
        const error = await rejection(send(approval));
        expect(error.code).toBe('openclaw_request');
        expect(error.message).toBe('OpenClaw request failed: Headers.append: "Bearer [redacted]" is an invalid header value. ([redacted] seen)');
    });

    it('times out', async () => {
        const {
            fake,
            send,
            clock,
        } = setup();
        fake.hangNext();
        const pending = send(approval);
        await vi.waitFor(() => expect(fake.requests).toHaveLength(1));
        clock.advance(OPENCLAW_TIMEOUT_MS);
        const error = await rejection(pending);
        expect(error.code).toBe('openclaw_request');
        expect(error.message).toBe('OpenClaw did not answer within 30000ms.');
    });

    it('rejects with the caller\'s abort reason', async () => {
        const { fake, send } = setup();
        fake.hangNext();
        const controller = new AbortController();
        const pending = send(approval, '', { ...opts, signal: controller.signal });
        await vi.waitFor(() => expect(fake.requests).toHaveLength(1));
        const reason = new Error('cancelled');
        controller.abort(reason);
        await expect(pending).rejects.toBe(reason);
    });

    it('sends nothing for an aborted signal', async () => {
        const { fake, send } = setup();
        const controller = new AbortController();
        const reason = new Error('gone');
        controller.abort(reason);
        await expect(send(approval, '', { ...opts, signal: controller.signal })).rejects.toBe(reason);
        expect(fake.requests).toHaveLength(0);
    });

    it('clears its timer after a send', async () => {
        const clock = new ControllableClock(new Date('2026-10-21T09:00:00Z'));
        const fake = createFakeOpenclaw({ token: TOKEN, clock });
        const signals: AbortSignal[] = [];
        const channel = openclawChannel({
            baseUrl: 'http://openclaw:18789',
            hooksToken: TOKEN,
            deliver: { channel: 'telegram', to: '12345' },
            timeoutMs: 1000,
            clock,
            fetch: (resource, init) => {
                if (init?.signal) signals.push(init.signal);
                return fake.fetch(resource, init);
            },
        });
        await channel.out!(approval, '', opts);
        clock.advance(1000);
        expect(signals).toHaveLength(1);
        expect(signals[0]!.aborted).toBe(false);
    });

    it('resolves on any 2xx', async () => {
        const { send, clock } = setup();
        await expect(send(approval)).resolves.toBeUndefined();
        const accepted = openclawChannel({
            baseUrl: 'http://openclaw:18789',
            hooksToken: TOKEN,
            deliver: { channel: 'telegram', to: '12345' },
            clock,
            fetch: async () => new Response(null, { status: 202 }),
        });
        await expect(accepted.out!(approval, '', opts)).resolves.toBeUndefined();
    });
});
