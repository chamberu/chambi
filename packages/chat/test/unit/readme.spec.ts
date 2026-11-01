/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { IEngine } from '@chamvi/core';
import type { WhatsAppPairing } from '@chamvi/chat/baileys';
import { ControllableClock, mockModel, textModel } from '@chamvi/test-kit';
import { createWhatsAppEngine } from '../fixtures/readme-example.ts';
import { createRecordingAuth } from '../utils/auth.ts';
import { createMemoryState } from '../utils/chat.ts';
import {
    ALICE,
    MALLORY,
    createFakeSockets,
    settle,
    waMessage,
} from '../utils/whatsapp.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const engines: IEngine[] = [];

afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(engines.map((engine) => engine.stop()));
    engines.length = 0;
});

function stubEnv() {
    vi.stubEnv('WHATSAPP_SENDERS', ALICE);
    vi.stubEnv('APP_URL', 'https://chamvi.example');
}

describe('README example', () => {
    it('is the code of test/fixtures/readme-example.ts', () => {
        const readme = read('../../README.md');
        const blocks = readme.matchAll(/```typescript\n([\s\S]*?)```/g).map((m) => m[1]).toArray();

        expect(blocks).toContain(read('../fixtures/readme-example.ts'));
    });

    it('imports only the public entries and never a test helper', () => {
        const imports = read('../fixtures/readme-example.ts').matchAll(/from '([^']+)'/g).map((m) => m[1]).toArray();

        expect(imports.sort()).toEqual(['@chamvi/chat/baileys', '@chamvi/chat/baileys', '@chamvi/core', '@chamvi/core', 'ai', 'zod']);
    });

    it('acquires nothing and builds no socket before the engine starts', () => {
        stubEnv();

        const auth = createRecordingAuth();
        const sockets = createFakeSockets();

        createWhatsAppEngine(textModel(), {
            auth: auth.provider,
            state: createMemoryState(),
            onPairing: () => undefined,
            socketFactory: sockets.factory,
        });

        expect(auth.signals).toEqual([]);
        expect(sockets.sockets).toEqual([]);
    });

    it('answers an allowed sender in the same chat, with one memory per chat, and ignores a stranger', async () => {
        stubEnv();

        const clock = new ControllableClock(new Date('2026-11-01T09:00:00Z'));
        const auth = createRecordingAuth();
        const sockets = createFakeSockets();
        const pairings: WhatsAppPairing[] = [];
        const engine = createWhatsAppEngine(mockModel([
            {
                parts: [{
                    type: 'tool-call',
                    toolName: 'reply',
                    input: { text: 'Hello Alice.' },
                }],
            },
            { parts: [{ type: 'text', text: 'done' }] },
        ]), {
            auth: auth.provider,
            state: createMemoryState(),
            onPairing: (pairing) => {
                pairings.push(pairing);
            },
            socketFactory: sockets.factory,
            clock,
        });

        engines.push(engine);
        await engine.start();

        const socket = sockets.last();

        socket.emit('connection.update', { qr: 'QR-REF' });
        socket.open();
        socket.deliver(
            waMessage({ chat: MALLORY, text: 'let me in' }),
            waMessage({ chat: ALICE, text: 'hi there' }),
        );
        await settle();
        await engine.idle();

        const { data: runs } = await engine.store.runs.find({});

        expect(pairings).toEqual([{ qr: 'QR-REF' }]);
        expect(runs).toHaveLength(1);
        expect(runs[0]?.status).toBe('completed');
        expect(runs[0]?.taint?.source).toBe('channel:chat');
        expect(runs[0]?.conversation?.scope.identity).toEqual(expect.objectContaining({
            account: 'assistant',
            chat: ALICE,
            audience: `direct:${ALICE}`,
        }));
        expect(socket.sent.map(({ jid, text }) => ({ jid, text }))).toEqual([{ jid: ALICE, text: 'Hello Alice.' }]);
    });

    it('needs the sender list and the app URL', () => {
        stubEnv();
        vi.stubEnv('WHATSAPP_SENDERS', '');

        expect(() => createWhatsAppEngine(textModel(), {
            auth: createRecordingAuth().provider,
            state: createMemoryState(),
            onPairing: () => undefined,
        })).toThrow('WHATSAPP_SENDERS');
    });
});
