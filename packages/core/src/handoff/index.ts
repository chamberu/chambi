/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

export { DEFAULT_MAX_HANDOFFS_PER_RUN, HANDOFF_SUBSCRIPTION_ID, MAX_HANDOFF_DEPTH } from './constants.ts';
export * from './subscription.ts';
export type {
    HandoffInput,
    HandoffResult,
    HandoffSubscriber,
    HandoffSubscriptionOptions,
} from './types.ts';
