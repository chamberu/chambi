/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ChatEvent } from '../channel/types.ts';

/** Every event a chat subscription can name. */
export const CHAT_EVENTS: readonly ChatEvent[] = ['direct', 'mention', 'message'];

/**
 * The events of a subscription that names none: direct messages and
 * mentions. Regular group messages need `events: ['message']` explicitly.
 */
export const DEFAULT_CHAT_EVENTS: readonly ChatEvent[] = ['direct', 'mention'];
