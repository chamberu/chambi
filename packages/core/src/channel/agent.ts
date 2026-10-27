/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { AGENT_CHANNEL_NAME } from './constants.ts';
import type { IChannel } from './types.ts';

/**
 * The channel runs started by another run come in on (channel `agent`):
 * no `start`, no `in`, no `out`. It is registered so a `handoff.on()`
 * subscription validates; `startHandoff()` dispatches its runs. `@chamvi/app`
 * contributes it; a bare `Engine` lists it in `channels`.
 */
export function agentChannel(): IChannel {
    return { name: AGENT_CHANNEL_NAME };
}
