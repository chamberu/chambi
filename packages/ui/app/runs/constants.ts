/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { RunStatusLiteral } from '@chamvi/core';

export const RUN_LIST_POLL_MS = 5000;

export const RUN_LIST_PAGE_SIZE = 25;

/** The runs page's status counters refresh slower than the list: three requests per pass. */
export const RUN_COUNTS_POLL_MS = 15_000;

export const RUN_STATUSES: readonly RunStatusLiteral[] = ['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'interrupted'];

export const SETTLED_STATUSES: readonly RunStatusLiteral[] = ['completed', 'failed', 'cancelled'];

export const CANCELABLE_STATUSES: readonly RunStatusLiteral[] = ['queued', 'running', 'waiting', 'interrupted'];

/** The agent filter's "all agents" option (a select option may not be empty). */
export const ALL_AGENTS = '*';

/** How the run page names a run's parent, by `trigger.parent.kind`. */
export const PARENT_LABELS: Readonly<Record<string, string>> = { handoff: 'handed off from' };
