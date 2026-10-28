/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import * as kit from '@chamvi/test-kit';

describe('public api', () => {
    it.each([
        'ControllableClock',
        'createFakeGithub',
        'createGitFixture',
        'describeConversationStoreContract',
        'describeStoreContract',
        'describeWorkspaceContract',
    ])('exports %s', (name) => {
        expect(kit).toHaveProperty(name);
        expect(kit[name as keyof typeof kit]).toBeTypeOf('function');
    });
});
