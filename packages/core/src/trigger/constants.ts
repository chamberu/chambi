/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/**
 * Longest `idempotencyKey`, `concurrencyKey` and `address` of an envelope:
 * the width of `@chamvi/store-db`'s `runs.thread` and
 * `runs.concurrency_key` columns.
 */
export const TRIGGER_KEY_MAX_LENGTH = 255;
