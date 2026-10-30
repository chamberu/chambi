/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { onScopeDispose, shallowRef } from 'vue';
import type { ApiError } from '../api/error.ts';
import type { IApiClient, ScheduleWire } from '../api/types.ts';
import { createPoller } from '../polling/module.ts';
import { asApiError, retryDelayOf } from '../api/helpers.ts';
import { SCHEDULES_POLL_MS } from './constants.ts';

/** `GET /schedules`, refreshed every `SCHEDULES_POLL_MS` while the scope lives. */
export function useSchedules(client: IApiClient) {
    const schedules = shallowRef<ScheduleWire[]>([]);
    const error = shallowRef<ApiError>();
    const poller = createPoller(async () => {
        try {
            schedules.value = await client.listSchedules();
            error.value = undefined;

            return undefined;
        } catch (e) {
            error.value = asApiError(e);

            return retryDelayOf(error.value);
        }
    }, SCHEDULES_POLL_MS);

    poller.start();
    onScopeDispose(() => poller.stop());

    return {
        schedules,
        error,
        refresh: () => poller.refresh(),
    };
}
