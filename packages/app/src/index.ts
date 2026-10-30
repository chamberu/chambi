/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

export * from './app/index.ts';
export * from './config/index.ts';
// The public facade intentionally aggregates published package APIs for agent repositories.
// eslint-disable-next-line @tada5hi/no-reexport-shims
export * from '@chamvi/core';
// eslint-disable-next-line @tada5hi/no-reexport-shims -- Published cron API belongs in the public facade.
export { cron } from '@chamvi/channel-cron';
// eslint-disable-next-line @tada5hi/no-reexport-shims -- Preserve the published cron types in the public facade.
export type { CronSubscriptionOptions, OverlapPolicy } from '@chamvi/channel-cron';

export {
    Permission,
    agentPermission,
    http,
    webhook,
// eslint-disable-next-line @tada5hi/no-reexport-shims -- Published HTTP API belongs in the public facade.
} from '@chamvi/http';

export type {
    Authenticator,
    HttpRoute,
    HttpRouteContext,
    HttpRouteRequest,
    HttpRouteResult,
    HttpSubscriptionOptions,
    Principal,
    StaticToken,
    WebhookSubscriptionOptions,
// eslint-disable-next-line @tada5hi/no-reexport-shims -- Preserve the published HTTP types in the public facade.
} from '@chamvi/http';
export * from './env/index.ts';
export * from './loader/index.ts';
export * from './logger/index.ts';
export * from './models/index.ts';
export * from './module/index.ts';
export * from './modules/agents/index.ts';
export * from './modules/config/index.ts';
export * from './modules/console-channel/index.ts';
export * from './modules/engine/index.ts';
export * from './modules/http/index.ts';
export * from './modules/scheduler/index.ts';
export * from './modules/static-tokens/index.ts';
export * from './modules/repository/index.ts';
