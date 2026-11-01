/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { makeWASocket } from 'baileys';
import type { Adapter } from 'chat';
import {
    describe,
    expect,
    expectTypeOf,
    it,
} from 'vitest';
import * as baileys from '@chamvi/chat/baileys';
import type { WhatsAppSocketFactory } from '@chamvi/chat/baileys';
import * as pkg from '@chamvi/chat';
import { createWhatsAppAdapter } from '../../../src/baileys/adapter.ts';
import { createFileAuthProvider } from '../../utils/auth.ts';
import { createWhatsAppFixture } from '../../utils/whatsapp.ts';

describe('@chamvi/chat/baileys', () => {
    it('exports exactly the WhatsApp surface', () => {
        expect(Object.keys(baileys).sort()).toEqual([
            'WHATSAPP_ADAPTER_NAME',
            'WHATSAPP_AUTH_ERROR_CODE',
            'WHATSAPP_CONNECTION_ERROR_CODE',
            'WHATSAPP_LOGGED_OUT_ERROR_CODE',
            'WHATSAPP_RECONNECT',
            'WHATSAPP_SHUTDOWN_TIMEOUT_MS',
            'createWhatsAppChat',
        ]);
        expect(baileys.WHATSAPP_ADAPTER_NAME).toBe('whatsapp');
    });

    it('keeps the main entry free of it', () => {
        expect(Object.keys(pkg).filter((key) => /whatsapp/i.test(key))).toEqual([]);
    });

    it('builds a chat 4.43.0 Adapter without a cast, and takes Baileys\' makeWASocket as the default factory', () => {
        expectTypeOf(createWhatsAppAdapter).returns.toMatchTypeOf<Adapter>();
        expectTypeOf(makeWASocket).toMatchTypeOf<WhatsAppSocketFactory>();
    });

    it('wires the Chat, the ingress and the channel without touching auth or a socket', () => {
        const {
            setup,
            auth,
            sockets,
        } = createWhatsAppFixture();

        expect(setup.chat.getAdapter('whatsapp')).toBe(setup.ingress);
        expect(setup.channel.name).toBe('chat');
        expect(setup.channel.untrusted).toBe(true);
        expect(setup.channel.in).toBeUndefined();
        expect(auth.signals).toEqual([]);
        expect(sockets.sockets).toEqual([]);
        expect(setup.status()).toBe('stopped');
    });
});

describe('test-only filesystem auth provider', () => {
    it('keeps creds and keys across a restart and refuses a second holder', async () => {
        const {
            mkdtemp,
            rm,
            stat,
        } = await import('node:fs/promises');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const folder = await mkdtemp(join(tmpdir(), 'chamvi-wa-'));
        const auth = join(folder, 'auth');

        try {
            const provider = createFileAuthProvider(auth);
            const first = await provider.acquire(new AbortController().signal);

            await expect(provider.acquire(new AbortController().signal)).rejects.toThrow(/in use/);

            first.auth.creds.registered = true;
            await first.saveCreds();
            await first.auth.keys.set({ session: { 'a.0': new Uint8Array([7]) } });
            await first.flush();
            await first.release();

            expect((await stat(auth)).mode & 0o777).toBe(0o700);
            expect((await stat(join(auth, 'creds.json'))).mode & 0o777).toBe(0o600);
            expect((await stat(join(auth, 'keys.json'))).mode & 0o777).toBe(0o600);

            const second = await provider.acquire(new AbortController().signal);

            expect(second.auth.creds.registered).toBe(true);
            expect(await second.auth.keys.get('session', ['a.0'])).toEqual({ 'a.0': Buffer.from([7]) });
            await second.release();
        } finally {
            await rm(folder, { recursive: true, force: true });
        }
    });
});
