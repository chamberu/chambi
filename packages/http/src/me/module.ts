/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { defineCoreHandler } from 'routup';
import type { App } from 'routup';
import type { HttpContext } from '../app/types.ts';
import { authenticate, toInvoker } from '../auth/helpers.ts';
import type { MeView } from './types.ts';

/** `GET /me`: any authenticated principal, its own identity and permissions only. */
export function registerMeRoutes(app: App, ctx: HttpContext): void {
    app.get('/me', defineCoreHandler(async (event): Promise<MeView> => {
        const invoker = toInvoker(await authenticate(event, ctx));

        return { ...invoker, permissions: [...invoker.permissions] };
    }));
}
