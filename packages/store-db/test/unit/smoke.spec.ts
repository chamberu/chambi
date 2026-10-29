/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import * as pkg from '@chamvi/store-db';

describe('@chamvi/store-db', () => {
    it('resolves the package entry', () => {
        expect(typeof pkg).toBe('object');
    });
});
