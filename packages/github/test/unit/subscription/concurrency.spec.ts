/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { github } from '@chamvi/github';
import { createGithubSubscription } from '../../../src/subscription/module.ts';

const invalid = [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, true, null, '2'];

const builders = {
    default: (maxConcurrentRuns?: number | false) => github.on('issues.opened', { maxConcurrentRuns }),
    named: (maxConcurrentRuns?: number | false) => createGithubSubscription('github-other', 'issues.opened', { maxConcurrentRuns }),
};

describe.each(Object.entries(builders))('%s GitHub subscription concurrency', (_name, build) => {
    it('adds no cap when omitted', () => {
        expect(build()).not.toHaveProperty('maxConcurrentRuns');
    });

    it.each([false, 1, 4] as const)('keeps cap %s on the subscription', (maxConcurrentRuns) => {
        const subscription = build(maxConcurrentRuns);
        expect(subscription.maxConcurrentRuns).toBe(maxConcurrentRuns);
        expect(subscription.options).not.toHaveProperty('maxConcurrentRuns');
    });

    it.each(invalid)('rejects invalid cap %s', (value) => {
        expect(() => build(value as number)).toThrow(InvalidAgentDefinitionError);
        expect(() => build(value as number)).toThrow(/maxConcurrentRuns/);
    });
});
