/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { envString } from '@chamvi/app';
import type { Env } from '@chamvi/app';
import type { OpenclawDelivery } from '../channel/types.ts';
import { VARIABLES } from './constants.ts';

/** The delivery target from `OPENCLAW_CHANNEL`, `OPENCLAW_TO` (required) and `OPENCLAW_ACCOUNT_ID`. */
export function readDelivery(env: Env): OpenclawDelivery {
    const accountId = envString(env, VARIABLES['deliver.accountId']);

    return {
        channel: envString(env, VARIABLES['deliver.channel'], { required: true }),
        to: envString(env, VARIABLES['deliver.to'], { required: true }),
        ...(typeof accountId === 'string' && { accountId }),
    };
}
