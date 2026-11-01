/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import { describe, expect, it } from 'vitest';
import * as pkg from '@chamvi/chat';

describe('public api', () => {
    it('exports createChatIngressAdapter', () => {
        expect(pkg.createChatIngressAdapter).toBeTypeOf('function');
    });

    it.each([
        'bindIngress',
    ])('has no %s', (name) => {
        expect(pkg).not.toHaveProperty(name);
    });
});
