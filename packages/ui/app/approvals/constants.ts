/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { InjectionKey } from 'vue';
import type { useApprovals } from './composables.ts';

export const INBOX_POLL_MS = 5000;

export const INBOX_PAGE_SIZE = 100;

/** The longest approval body shown as a JSON block; a longer one stays one text node. */
export const JSON_BODY_MAX_LENGTH = 16_384;

/** The shell's inbox, shared with the approvals view (one poller for both). */
export const INBOX: InjectionKey<ReturnType<typeof useApprovals>> = Symbol('chamvi.inbox');
