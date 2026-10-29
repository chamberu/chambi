/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { defineCoreHandler } from 'routup';
import type { App } from 'routup';
import type { HttpContext } from '../app/types.ts';
import { READINESS_PROBE_RUN_ID } from './constants.ts';

async function storeReachable(ctx: HttpContext): Promise<boolean> {
    let timer: { clear(): void } | undefined;
    const timeout = new Promise<boolean>((resolve) => {
        timer = ctx.clock.setTimeout(() => resolve(false), ctx.readyTimeoutMs);
    });
    const probe = ctx.stores.runs.getRun(READINESS_PROBE_RUN_ID).then(() => true, () => false);
    try {
        return await Promise.race([probe, timeout]);
    } finally {
        timer?.clear();
    }
}

function unavailable(reason: string): Response {
    return Response.json({ status: 'unavailable', reason }, { status: 503 });
}

/** `/healthz` (process alive) and `/readyz` (store, engine, shutdown); unauthenticated. */
export function registerHealthRoutes(app: App, ctx: HttpContext): void {
    app.get('/healthz', defineCoreHandler(() => ({ status: 'ok' })));

    app.get('/readyz', defineCoreHandler(async () => {
        if (ctx.shutdown?.shuttingDown) return unavailable('shutting-down');
        if (ctx.engine.isDraining) return unavailable('draining');
        if (!await storeReachable(ctx)) return unavailable('store-unreachable');
        return { status: 'ok' };
    }));
}
