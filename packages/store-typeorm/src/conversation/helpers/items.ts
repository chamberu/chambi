/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ConversationItem } from '@chamvi/core';

/** The id of a run's accepted input item: one per run and generation. */
export function userItemId(runId: string): string {
    return `user:${runId}`;
}

/** Whether a prepared emit repeats the stored one: same run, text, effect key and target. */
export function isSameEmit(stored: ConversationItem, item: ConversationItem): boolean {
    return stored.role === item.role &&
        stored.runId === item.runId &&
        stored.text === item.text &&
        stored.effectKey === item.effectKey &&
        stored.target?.channel === item.target?.channel &&
        stored.target?.address === item.target?.address;
}
