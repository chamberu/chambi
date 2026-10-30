/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { RunStatus } from '@chamvi/core';
import type { Run } from '@chamvi/core';
import { BadRequestError } from '@ebec/http';

/** The step index a `Last-Event-ID` header names; -1 for none or garbage. */
export function parseLastEventId(header: string | null): number {
    if (header === null || !/^\d+$/.test(header)) {
        return -1;
    }

    const value = Number(header);

    return Number.isSafeInteger(value) ? value : -1;
}

/**
 * The step index of the `after` query (the `Last-Event-ID` of clients that
 * cannot set the header); `undefined` without one. Anything but one
 * non-negative integer is a 400.
 */
export function parseAfter(searchParams: URLSearchParams): number | undefined {
    const values = searchParams.getAll('after');

    if (values.length === 0) {
        return undefined;
    }

    const [value = ''] = values;

    if (values.length > 1 || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new BadRequestError({ message: 'after must be one non-negative integer (a step index).' });
    }

    return Number(value);
}

/**
 * The last step index the client has: a valid `Last-Event-ID` (the client's
 * live progress on a reconnect) wins over `after`; -1 for neither.
 */
export function resolveLastStep(header: string | null, after: number | undefined): number {
    const lastEventId = parseLastEventId(header);

    if (lastEventId >= 0) {
        return lastEventId;
    }

    return after ?? -1;
}

const SETTLED = new Set<string>([RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED]);

export function isSettled(run: Run): boolean {
    return SETTLED.has(run.status);
}

/** True when `run` differs from the last one sent: a later `updatedAt` or another status. */
export function isNewer(run: Run, last: Run | undefined): boolean {
    if (!last) {
        return true;
    }

    return run.updatedAt.getTime() > last.updatedAt.getTime() || run.status !== last.status;
}

/**
 * Whether the run's usage moved since `last`: two steps within one
 * millisecond leave `updatedAt` equal, but an LLM step adds tokens.
 */
export function usageChanged(run: Run, last: Run | undefined): boolean {
    if (!last) {
        return true;
    }

    return run.usage.inputTokens !== last.usage.inputTokens || run.usage.outputTokens !== last.usage.outputTokens;
}
