/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { HttpAppOptions } from '@chamvi/http';

/**
 * Which of the built-in intake channels taint every run they start
 * (`httpChannel({ untrusted })`, `mcpChannel({ untrusted })`), for callers
 * that relay text written by others (an OpenClaw MCP principal). Both default
 * to trusted.
 */
export type HttpModuleUntrustedOptions = {
    http?: boolean;
    mcp?: boolean;
};

/**
 * `createHttpApp` options the module passes through (`bodyLimit` also bounds
 * the webhook channel's deliveries), plus `untrusted` for the `http` and `mcp`
 * channels; `engine`, `auth`, `shutdown`, `routes`, `channels`, `basePath`
 * and `onError` come from the app.
 */
export type HttpModuleOptions = Omit<HttpAppOptions, 'engine' | 'auth' | 'shutdown' | 'routes' | 'channels' | 'basePath' | 'onError'> & {
    untrusted?: HttpModuleUntrustedOptions;
};
