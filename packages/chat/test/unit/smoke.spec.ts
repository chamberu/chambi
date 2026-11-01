/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import * as chat from '@chamvi/chat';
import * as baileys from '@chamvi/chat/baileys';
import * as module from '@chamvi/chat/module';

describe('package entries', () => {
    it('resolve', () => {
        expect(chat.createChatIngressAdapter).toBeTypeOf('function');
        expect(baileys.createWhatsAppChat).toBeTypeOf('function');
        expect(module.chatModule).toBeTypeOf('function');
    });
});
