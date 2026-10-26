/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { TypedToken } from 'eldin';
import type { AppTokens } from './types.ts';

function token<K extends keyof AppTokens>(key: K): TypedToken<AppTokens[K]> {
    return new TypedToken<AppTokens[K]>(`chamvi.${key.toLowerCase().replace(/_/g, '-')}`);
}

/**
 * The container keys modules share. `HTTP_ROUTES`, `AUTHENTICATORS`,
 * `CHANNELS`, `LIFECYCLE_HOOKS`, `AGENT_CHECKS` and `GIT_CREDENTIALS` are collections (`registerMany` in
 * `setup`, `resolveAll` in `onReady`); every other token holds one value.
 */
export const AppToken = {
    CONTEXT: token('CONTEXT'),
    CONFIG: token('CONFIG'),
    LOGGER: token('LOGGER'),
    CLOCK: token('CLOCK'),
    STORE: token('STORE'),
    DATA_SOURCE: token('DATA_SOURCE'),
    ENGINE: token('ENGINE'),
    SHUTDOWN: token('SHUTDOWN'),
    SERVER: token('SERVER'),
    HTTP_ROUTES: token('HTTP_ROUTES'),
    AUTHENTICATORS: token('AUTHENTICATORS'),
    CHANNELS: token('CHANNELS'),
    LIFECYCLE_HOOKS: token('LIFECYCLE_HOOKS'),
    AGENT_ISSUES: token('AGENT_ISSUES'),
    AGENT_CHECKS: token('AGENT_CHECKS'),
    GIT_CREDENTIALS: token('GIT_CREDENTIALS'),
} as const;

/**
 * The built-in modules' names; list a module of the same name to replace one.
 * `CONSOLE` names the optional `consoleChannelModule()`.
 */
export const ModuleName = {
    CONFIG: 'chamvi:config',
    STORE: 'chamvi:store',
    STATIC_TOKENS: 'chamvi:static-tokens',
    ENGINE: 'chamvi:engine',
    AGENTS: 'chamvi:agents',
    SCHEDULER: 'chamvi:scheduler',
    HTTP: 'chamvi:http',
    CONSOLE: 'chamvi:console',
} as const;

/** The order of the authenticator chain (lowest first). */
export const AUTHENTICATOR_ORDER = {
    STATIC_TOKENS: 0,
    AUTHUP: 10,
    OIDC: 20,
} as const;

export const APP_ERROR_CODE = {
    STOPPED: 'app_stopped',
    IN_USE: 'app_in_use',
    STOP_FAILED: 'app_stop_failed',
} as const;
