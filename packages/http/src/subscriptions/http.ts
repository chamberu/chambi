/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { assertConcurrencyMaxRuns } from '@chamvi/core';
import { HTTP_CHANNEL_NAME } from '../channels/constants.ts';
import type { HttpSubscriber } from './types.ts';

/**
 * The control-plane subscription: REST `POST /agents/:name/runs` and the UI
 * start runs through it (channel `http`), MCP `run_<agent>` too (channel
 * `mcp`). Its id is `http`, so an agent declares it at most once (the
 * duplicate id check of `defineAgent`). Pure data: agent folders use it
 * without a channel instance.
 */
export const http: HttpSubscriber = {
    on: (options = {}) => {
        assertConcurrencyMaxRuns(options.concurrencyMaxRuns, 'http.on() concurrencyMaxRuns');
        return {
            channel: HTTP_CHANNEL_NAME,
            id: 'http',
            ...(options.concurrencyMaxRuns !== undefined ? { concurrencyMaxRuns: options.concurrencyMaxRuns } : {}),
            options: { schema: options.schema },
        };
    },
};
