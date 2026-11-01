/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import { ValidationError } from '@chamvi/core';
import type { ChannelMessage, IEngine } from '@chamvi/core';
import { CHAT_REQUEST_ERROR_CODE } from '@chamvi/chat';
import {
    ALICE,
    GROUP,
    createWhatsAppFixture,
    settle,
} from '../../utils/whatsapp.ts';
import type { WhatsAppFixture } from '../../utils/whatsapp.ts';

const engines: IEngine[] = [];

afterEach(async () => {
    await Promise.all(engines.map((engine) => engine.stop()));
    engines.length = 0;
});

async function connected(patch: Parameters<typeof createWhatsAppFixture>[0] = {}): Promise<WhatsAppFixture> {
    const value = createWhatsAppFixture(patch);

    engines.push(value.engine);
    await value.engine.start();
    value.sockets.last().open();

    return value;
}

function message(key: string, body = 'hello'): ChannelMessage {
    return {
        kind: 'message',
        key,
        runId: 'run-1',
        agent: 'assistant',
        body,
    };
}

function send(value: WhatsAppFixture, item: ChannelMessage, address: string, signal = new AbortController().signal): Promise<void> {
    return value.channel.out!(item, address, { signal, trigger: {} as never });
}

describe('WhatsApp delivery', () => {
    it('sends raw text to the jid the address names', async () => {
        const value = await connected();
        const direct = value.channel.to({ adapter: 'whatsapp', threadId: `whatsapp:${ALICE}` });
        const group = value.channel.to({ adapter: 'whatsapp', threadId: `whatsapp:${GROUP}` });

        await send(value, message('k1', '**not** rendered'), direct);
        await send(value, message('k2'), group);

        expect(value.sockets.last().sent.map(({ jid, text }) => ({ jid, text }))).toEqual([
            { jid: ALICE, text: '**not** rendered' },
            { jid: GROUP, text: 'hello' },
        ]);
    });

    it('refuses an address of no WhatsApp chat before any send', async () => {
        const value = await connected();
        const bogus = value.channel.to({ adapter: 'whatsapp', threadId: 'whatsapp:not-a-jid' });

        await expect(send(value, message('k1'), bogus)).rejects.toBeInstanceOf(ValidationError);
        expect(value.sockets.last().sent).toEqual([]);
    });

    it('reuses one stable message id per key: a repeated send carries the same id (at least once)', async () => {
        const value = await connected();
        const address = value.channel.to({ adapter: 'whatsapp', threadId: `whatsapp:${ALICE}` });

        await send(value, message('run-1:emit:a'), address);
        await send(value, message('run-1:emit:a'), address);
        await send(value, message('run-1:emit:b'), address);

        const [first, second, third] = value.sockets.last().sent;

        // the transport is asked twice: reusing an id is recorded, not a proven dedupe
        expect(value.sockets.last().sent).toHaveLength(3);
        expect(first?.messageId).toMatch(/^3EB0[0-9A-F]{36}$/);
        expect(second?.messageId).toBe(first?.messageId);
        expect(third?.messageId).not.toBe(first?.messageId);
    });

    it('an ambiguous send times out and its retry goes out again under the same id', async () => {
        const value = await connected({ patch: { timeoutMs: 1000 } });
        const socket = value.sockets.last();
        const address = value.channel.to({ adapter: 'whatsapp', threadId: `whatsapp:${ALICE}` });
        let finish: (() => void) | undefined;

        socket.onSend = () => new Promise((resolve) => {
            finish = () => resolve(undefined);
        });

        const first = send(value, message('k-ambiguous'), address);
        const outcome = first.catch((error: unknown) => error);

        await settle();
        value.clock.advance(1000);

        expect(await outcome).toMatchObject({ code: CHAT_REQUEST_ERROR_CODE, message: expect.stringMatching(/may still be delivered/) });

        // the late completion is reported, never unhandled
        finish?.();
        await settle();
        expect(value.errors).toEqual([expect.objectContaining({ code: CHAT_REQUEST_ERROR_CODE })]);

        socket.onSend = undefined;
        await send(value, message('k-ambiguous'), address);

        expect(socket.sent).toHaveLength(2);
        expect(socket.sent[1]?.messageId).toBe(socket.sent[0]?.messageId);
    });

    it('a transport failure is a chat_request error and is not retried by the channel', async () => {
        const value = await connected();
        const socket = value.sockets.last();
        const address = value.channel.to({ adapter: 'whatsapp', threadId: `whatsapp:${ALICE}` });

        socket.onSend = () => Promise.reject(new Error('stream errored'));

        await expect(send(value, message('k1'), address)).rejects.toMatchObject({ code: CHAT_REQUEST_ERROR_CODE });
        expect(socket.sent).toHaveLength(1);
    });
});
