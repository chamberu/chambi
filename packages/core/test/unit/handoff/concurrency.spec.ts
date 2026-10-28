/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError, handoff } from '@chamvi/core';

const invalid = [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, true, null, '2'];

describe('handoff subscription concurrency', () => {
    it('adds no cap when omitted', () => {
        expect(handoff.on()).not.toHaveProperty('concurrencyMaxRuns');
    });

    it.each([false, 1, 4] as const)('keeps cap %s on the subscription', (concurrencyMaxRuns) => {
        const subscription = handoff.on({ concurrencyMaxRuns });
        expect(subscription.concurrencyMaxRuns).toBe(concurrencyMaxRuns);
        expect(subscription.options).not.toHaveProperty('concurrencyMaxRuns');
    });

    it.each(invalid)('rejects invalid cap %s', (value) => {
        const create = () => handoff.on({ concurrencyMaxRuns: value as number });
        expect(create).toThrow(InvalidAgentDefinitionError);
        expect(create).toThrow(/concurrencyMaxRuns/);
    });
});
