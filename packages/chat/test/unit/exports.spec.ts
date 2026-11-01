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
            'CHAT_BODY_LIMIT_BYTES',
            'CHAT_CHANNEL_NAME',
            'CHAT_EVENTS',
            'CHAT_INTAKE_FAILED_ERROR_CODE',
            'CHAT_REQUEST_ERROR_CODE',
            'CHAT_STOP_TIMEOUT_ERROR_CODE',
            'CHAT_STOP_TIMEOUT_MS',
            'CHAT_TEXT_MAX_CHARS',
            'CHAT_TIMEOUT_MS',
            'CHAT_WEBHOOK_TIMEOUT_MS',
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
        expect(pkg.CHAT_INTAKE_FAILED_ERROR_CODE).toBe('chat_intake_failed');
        expect(pkg.CHAT_REQUEST_ERROR_CODE).toBe('chat_request');
        expect(pkg.CHAT_TEXT_MAX_CHARS).toBe(4096);
        expect(pkg.CHAT_TIMEOUT_MS).toBe(30_000);
        expect(pkg.CHAT_BODY_LIMIT_BYTES).toBe(1_048_576);
        expect(pkg.CHAT_WEBHOOK_TIMEOUT_MS).toBe(30_000);
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
        'createChatIntake',
        'chatIdempotencyKey',
        'chatConcurrencyKey',
        'CHANNEL_NAME_PATTERN',
        'TIMER_MAX_MS',
        'createChatSender',
        'renderChatMessage',
        'receiveWebhook',
        'trackIngress',
        'isChatChannel',
        'markChatChannel',
    ])('has no %s', (name) => {
        expect(pkg).not.toHaveProperty(name);
    });
});
