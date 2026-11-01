/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import { describe, expect, it } from 'vitest';
import * as module from '@chamvi/chat/module';

describe('@chamvi/chat/module', () => {
    it('exports exactly the module surface', () => {
        expect(Object.keys(module).sort()).toEqual(['ChatModule', 'chatModule']);
    });
});
