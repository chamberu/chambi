/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import { describe, expect, it } from 'vitest';
import * as pkg from '@chamvi/chat';

describe('public api', () => {
    it('exports exactly the public surface', () => {
        expect(Object.keys(pkg).sort()).toEqual([
            'CHAT_ADDRESS_PREFIX',
            'CHAT_CHANNEL_NAME',
            'CHAT_CHANNEL_TIMEOUT_MS',
            'CHAT_EVENTS',
            'CHAT_STOP_TIMEOUT_ERROR_CODE',
            'CHAT_STOP_TIMEOUT_MS',
            'DEFAULT_CHAT_EVENTS',
            'chat',
            'chatAddress',
            'chatChannel',
            'createChatIngressAdapter',
            'createChatSubscription',
        ]);
    });

    it('exports the factories and the default subscriber', () => {
        expect(pkg.createChatIngressAdapter).toBeTypeOf('function');
        expect(pkg.chatChannel).toBeTypeOf('function');
        expect(pkg.chat.on).toBeTypeOf('function');
        expect(pkg.chat.to).toBeTypeOf('function');
        expect(pkg.CHAT_CHANNEL_NAME).toBe('chat');
        expect(pkg.CHAT_STOP_TIMEOUT_MS).toBe(30_000);
    });

    it.each([
        'bindIngress',
        'isChatIngress',
        'createChatChannel',
        'resolveOptions',
        'encodeChatAddress',
        'decodeChatAddress',
        'hashKey',
        'matchesChatSubscription',
        'CHANNEL_NAME_PATTERN',
    ])('has no %s', (name) => {
        expect(pkg).not.toHaveProperty(name);
    });
});
