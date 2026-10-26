/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError, systemClock } from '@chamvi/core';
import { createClient, isClient } from 'hapic';
import { isObject } from 'smob';
import { WEB_FETCH_MAX_BYTES, WEB_TIMEOUT_MS } from '../request/constants.ts';
import { systemLookup } from '../url/lookup.ts';
import { TIMER_MAX_MS } from './constants.ts';
import type { ResolvedWebOptions, WebToolsOptions } from './types.ts';

function positiveInteger(value: unknown, name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
        throw new InvalidAgentDefinitionError(`webTools() ${name} must be an integer from 1 to ${max}.`);
    }
    return value;
}

/** The options checked, with their defaults (InvalidAgentDefinitionError). */
export function resolveOptions(options: WebToolsOptions): ResolvedWebOptions {
    if (!isObject(options)) {
        throw new InvalidAgentDefinitionError('webTools() options must be an object.');
    }
    if (options.client !== undefined && !isClient(options.client)) {
        throw new InvalidAgentDefinitionError('webTools() client must be a hapic client.');
    }
    for (const name of ['lookup', 'allowUrl'] as const) {
        if (options[name] !== undefined && typeof options[name] !== 'function') {
            throw new InvalidAgentDefinitionError(`webTools() ${name} must be a function.`);
        }
    }
    const clock = options.clock ?? systemClock;
    if (!isObject(clock) || typeof clock.now !== 'function' || typeof clock.setTimeout !== 'function') {
        throw new InvalidAgentDefinitionError('webTools() clock must have now() and setTimeout().');
    }
    return {
        client: options.client ?? createClient(),
        lookup: options.lookup ?? systemLookup,
        allowUrl: options.allowUrl,
        maxBytes: positiveInteger(options.maxBytes, 'maxBytes', WEB_FETCH_MAX_BYTES),
        timeoutMs: positiveInteger(options.timeoutMs, 'timeoutMs', WEB_TIMEOUT_MS, TIMER_MAX_MS),
        clock,
    };
}
