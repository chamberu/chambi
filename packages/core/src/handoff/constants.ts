/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { defineContextKey } from '../context/module.ts';
import type { HandoffHost } from './types.ts';

/** The id of the `handoff.on()` subscription (one per agent). */
export const HANDOFF_SUBSCRIPTION_ID = 'handoff';

/** The hand-offs a run may start unless `handoff.on({ maxPerRun })` says otherwise. */
export const DEFAULT_MAX_HANDOFFS_PER_RUN = 100;

/** A handed-off run cannot hand off again. */
export const MAX_HANDOFF_DEPTH = 1;

/** The engine's hand-off host (internal, kept out of the barrel). */
export const HANDOFF_CONTEXT = defineContextKey<HandoffHost>('handoff');
