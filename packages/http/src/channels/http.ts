/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import type { IChannel } from '@chamvi/core';
import { isObject } from 'smob';
import { HTTP_CHANNEL_NAME, MCP_CHANNEL_NAME } from './constants.ts';
import type { HttpChannelOptions } from './types.ts';

function buildChannel(name: string, options: HttpChannelOptions): IChannel {
    if (!isObject(options)) {
        throw new InvalidAgentDefinitionError(`${name}Channel() takes an options object.`);
    }

    // a misspelled key (`untrustd`) would leave the channel trusted
    const unknown = Object.keys(options).find((key) => key !== 'untrusted');

    if (unknown !== undefined) {
        throw new InvalidAgentDefinitionError(`${name}Channel() has an unknown option "${unknown}" (allowed: untrusted).`);
    }

    const { untrusted } = options;

    if (untrusted !== undefined && typeof untrusted !== 'boolean') {
        throw new InvalidAgentDefinitionError(`${name}Channel({ untrusted }) must be a boolean.`);
    }

    return untrusted ? { name, untrusted } : { name };
}

/**
 * The `http` channel: REST `POST /agents/:name/runs` (and the UI) dispatch
 * as it, with the authenticated principal as invoker. No `in` (the REST
 * route is the intake) and no `out`; registered on the engine so that
 * `http.on()` subscriptions validate. `untrusted: true` taints every run
 * it starts (default trusted).
 */
export function httpChannel(options: HttpChannelOptions = {}): IChannel {
    return buildChannel(HTTP_CHANNEL_NAME, options);
}

/**
 * The `mcp` channel: MCP `run_<agent>` dispatches as it (offered for an
 * agent with an `http.on()` subscription), so MCP and REST starts keep
 * separate idempotency scopes. No `in`, no `out`. `untrusted: true` taints
 * every run it starts (default trusted).
 */
export function mcpChannel(options: HttpChannelOptions = {}): IChannel {
    return buildChannel(MCP_CHANNEL_NAME, options);
}
