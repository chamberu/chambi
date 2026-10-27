/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { buildIssuesForStandardSchemaIssues } from '@validup/standard-schema';
import type { Agent } from '../agent/types.ts';
import { AGENT_CHANNEL_NAME } from '../channel/constants.ts';
import type { ChannelSubscription } from '../channel/types.ts';
import { ValidationError } from '../errors/index.ts';
import { describeIssues } from '../state/helpers.ts';
import { TRIGGER_KEY_MAX_LENGTH } from '../trigger/constants.ts';
import { HANDOFF_SUBSCRIPTION_ID } from './constants.ts';

/** The agent's `handoff.on()` subscription (channel `agent`, id `handoff`), if any. */
export function findHandoffSubscription(agent: Agent): ChannelSubscription | undefined {
    return agent.definition.channels?.find((s) => s.channel === AGENT_CHANNEL_NAME && s.id === HANDOFF_SUBSCRIPTION_ID);
}

/** `payload` parsed by `schema` (the parsed value); without one unchanged. */
export async function validatePayload(agent: string, schema: StandardSchemaV1 | undefined, payload: unknown): Promise<unknown> {
    if (!schema) return payload;
    const result = await schema['~standard'].validate(payload);
    if (result.issues) {
        const issues = buildIssuesForStandardSchemaIssues(result.issues);
        throw new ValidationError(`Invalid hand-off payload for agent "${agent}": ${describeIssues(issues)}`, issues);
    }
    return result.value;
}

/** The idempotency key a hand-off claims: `handoff:<key>`, or `sha256:<hex>` of it above 255 characters. */
export function claimKey(key: string): string {
    const prefixed = `handoff:${key}`;
    if (prefixed.length <= TRIGGER_KEY_MAX_LENGTH) return prefixed;
    return `sha256:${createHash('sha256').update(prefixed).digest('hex')}`;
}

/** A given key: a non-empty string without NUL (the idempotency key may be long, it is hashed). */
export function assertHandoffKey(name: string, value: unknown, bounded: boolean): asserts value is string | undefined {
    if (value === undefined) return;
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.includes('\u0000') ||
        (bounded && value.length > TRIGGER_KEY_MAX_LENGTH)
    ) {
        const bound = bounded ? ` of at most ${TRIGGER_KEY_MAX_LENGTH} characters` : '';
        throw new ValidationError(`The hand-off ${name} must be a non-empty string${bound} without NUL.`);
    }
}
