/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '../errors/index.ts';

/** A concurrency cap is optional, explicitly disabled, or a positive safe integer. */
export function assertConcurrencyMaxRuns(value: unknown, label: string): asserts value is number | false | undefined {
    if (value === undefined || value === false) return;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new InvalidAgentDefinitionError(`${label} must be a positive safe integer or false.`);
    }
}
