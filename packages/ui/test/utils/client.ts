/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ApiError } from '../../app/api/error.ts';
import type { IApiClient, MeWire } from '../../app/api/types.ts';

/** A client whose every method throws unless the test overrides it. */
export function fakeClient(overrides: Partial<IApiClient> = {}): IApiClient {
    const missing = (name: string) => () => {
        throw new Error(`${name} not faked`);
    };

    return {
        me: missing('me'),
        listAgents: missing('listAgents'),
        listSchedules: missing('listSchedules'),
        listRuns: missing('listRuns'),
        getRun: missing('getRun'),
        cancelRun: missing('cancelRun'),
        approve: missing('approve'),
        listKv: missing('listKv'),
        listDocs: missing('listDocs'),
        streamRun: missing('streamRun'),
        startRun: missing('startRun'),
        ...overrides,
    };
}

export const ME: MeWire = {
    id: 'admin',
    kind: 'token',
    permissions: ['*'],
};

export function apiError(status: number, code = `http_${status}`): ApiError {
    return new ApiError(status, code, code);
}

/** me() accepting exactly these tokens. */
export function meFor(...tokens: string[]): IApiClient['me'] {
    return async (token) => {
        if (token && tokens.includes(token)) {
            return ME;
        }

        throw apiError(401, 'unauthorized');
    };
}
