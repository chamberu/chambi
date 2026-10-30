/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { envString, envUrl } from '@chamvi/app';
import type { Env } from '@chamvi/app';
import type { UiRoutesOptions } from '../routes/types.ts';

/** The token login, plus the authup login with `CHAMVI_UI_AUTHUP_CLIENT_ID` (then `AUTHUP_URL` is required). */
export function readAuth(env: Env): NonNullable<UiRoutesOptions['auth']> {
    const clientId = envString(env, 'CHAMVI_UI_AUTHUP_CLIENT_ID');

    if (typeof clientId === 'undefined') {
        return { tokens: true };
    }

    const realmId = envString(env, 'CHAMVI_UI_AUTHUP_REALM_ID');

    return {
        tokens: true,
        authup: {
            url: envUrl(env, 'AUTHUP_URL', { required: true, protocols: ['http:', 'https:'] }),
            clientId,
            ...(typeof realmId === 'string' && { realmId }),
        },
    };
}
