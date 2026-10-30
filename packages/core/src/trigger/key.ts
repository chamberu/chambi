/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ValidationError } from '../errors/index.ts';
import { TRIGGER_KEY_MAX_LENGTH } from './constants.ts';

/**
 * A trigger key (`idempotencyKey`, `concurrencyKey`, `address`): absent, or a
 * string of at most TRIGGER_KEY_MAX_LENGTH characters without NUL (Postgres
 * text columns refuse it); a ValidationError otherwise. `dispatch` checks
 * every envelope with it; intakes call it to refuse a key before the run.
 */
export function assertTriggerKey(name: string, value: unknown): asserts value is string | undefined {
    if (value === undefined) {
        return;
    }

    if (typeof value !== 'string' || value.length > TRIGGER_KEY_MAX_LENGTH || value.includes('\0')) {
        throw new ValidationError(`The ${name} must be a string of at most ${TRIGGER_KEY_MAX_LENGTH} characters without NUL.`);
    }
}
