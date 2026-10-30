/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { DEFAULT_MAX_STEPS } from '@chamvi/core';
import type { Agent } from '@chamvi/core';
import { BadRequestError, NotFoundError } from '@ebec/http';
import { defineSchema } from '@rapiq/core';
import { CronExpressionParser } from 'cron-parser';
import { isObject } from 'smob';
import { Container } from 'validup';
import { DEFAULT_PAGE_LIMIT } from '../app/constants.ts';
import { webhookUrl } from '../channels/helpers.ts';
import { decodeQuery } from '../request/helpers.ts';
import { isDefined } from '../request/validators.ts';
import type { HttpAgents } from '../app/types.ts';
import type {
    AgentSummary,
    KvBody,
    ScheduleOverlap,
    ScheduleSummary,
} from './types.ts';

/**
 * Any top-level filter key, no sort; values are coerced by rapiq (`2` ->
 * `2`, `true`, `null`), and `filterValue` makes a double-quoted value a string.
 */
const COLLECTION_QUERY_SCHEMA = defineSchema({ sorts: { allowed: [] }, throwOnFailure: true });

const KV_LIST_QUERY_SCHEMA = defineSchema({
    filters: { allowed: [] },
    sorts: { allowed: [] },
    throwOnFailure: true,
});

/**
 * An agent as `GET /agents` lists it; a subscription to one of `hookChannels`
 * (the webhook channels the app mounts) carries its `hook` URL.
 */
export function summarizeAgent(agent: Agent, basePath: string, hookChannels: ReadonlySet<string> = new Set()): AgentSummary {
    const { definition } = agent;

    return {
        name: agent.name,
        channels: (definition.channels ?? []).map((subscription) => (hookChannels.has(subscription.channel) ?
            {
                channel: subscription.channel,
                id: subscription.id,
                hook: webhookUrl(basePath, subscription.channel, agent.name, String(subscription.options.path)),
            } :
            { channel: subscription.channel, id: subscription.id })),
        // defineAgent applied the defaults; the type keeps them optional
        budget: { maxSteps: DEFAULT_MAX_STEPS, ...definition.budget },
        state: Object.keys(definition.state ?? {}),
    };
}

/** The next fire time after `now`, or `undefined` for an expression or timezone cron-parser refuses. */
function nextFire(expression: string, timezone: string | undefined, now: Date): string | undefined {
    try {
        return CronExpressionParser.parse(expression, {
            currentDate: now,
            ...(timezone ? { tz: timezone } : {}),
        }).next().toDate().toISOString();
    } catch {
        return undefined;
    }
}

/**
 * Every cron subscription (one whose options carry a string `expression`,
 * as `@chamvi/channel-cron` builds them) of every agent, in definition
 * order, with its next fire time after `now`.
 */
export function listSchedules(agents: Iterable<Agent>, now: Date): ScheduleSummary[] {
    const schedules: ScheduleSummary[] = [];

    for (const agent of agents) {
        for (const subscription of agent.definition.channels ?? []) {
            const { expression } = subscription.options;

            if (typeof expression !== 'string') {
                continue;
            }

            const timezone = typeof subscription.options.timezone === 'string' ? subscription.options.timezone : undefined;
            const nextAt = nextFire(expression, timezone, now);

            if (nextAt === undefined) {
                continue;
            }

            schedules.push({
                agent: agent.name,
                channel: subscription.channel,
                trigger: subscription.id,
                expression,
                ...(timezone ? { timezone } : {}),
                overlap: (subscription.options.overlap as ScheduleOverlap | undefined) ?? 'skip',
                nextAt,
            });
        }
    }

    return schedules;
}

/** The agent by name, else 404. */
export function requireAgent(agents: HttpAgents, name: string): Agent {
    const agent = agents.get(name);

    if (!agent) {
        throw new NotFoundError({ message: `Agent "${name}" was not found.` });
    }

    return agent;
}

/** 404 when the agent declares state collections and this is none of them. */
export function assertCollection(agent: Agent, collection: string): void {
    const declared = agent.definition.state;

    if (declared && !Object.hasOwn(declared, collection)) {
        throw new NotFoundError({ message: `Agent "${agent.name}" declares no state collection "${collection}".` });
    }
}

export function createKvContainer(): Container<KvBody> {
    const container = new Container<KvBody>();

    container.mount('value', isDefined());

    return container;
}

/**
 * A collection filter value: rapiq coerces `42`, `007`, `true` and `null`
 * (quoted or not), so one pair of double quotes marks a string that keeps
 * its text (`"42"` -> `'42'`); everything else is rapiq's value.
 */
function filterValue(value: unknown): unknown {
    if (typeof value === 'string' && value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1);
    }

    return value;
}

/** A KV list query: `page[limit]` (default 50, at most 100) and `page[offset]`, no filter, no sort. */
export function parseKvListQuery(searchParams: URLSearchParams): { limit: number; offset: number } {
    const decoded = decodeQuery(searchParams, KV_LIST_QUERY_SCHEMA);

    if (decoded.filters.length > 0) {
        throw new BadRequestError({ message: 'The kv listing takes no filter.' });
    }

    return { limit: decoded.limit ?? DEFAULT_PAGE_LIMIT, offset: decoded.offset ?? 0 };
}

/** A collection list query: top-level `eq` filters as `where`, a limit, no offset, no sort. */
export function parseCollectionQuery(searchParams: URLSearchParams): { where: Record<string, unknown>; limit: number } {
    const decoded = decodeQuery(searchParams, COLLECTION_QUERY_SCHEMA);
    const where: Record<string, unknown> = {};

    for (const filter of decoded.filters) {
        if (filter.operator !== 'eq') {
            throw new BadRequestError({ message: 'Only top-level equality filters are supported.' });
        }

        if (filter.field === 'id') {
            // `id` on the wire is the store id, which `where` cannot match
            throw new BadRequestError({ message: 'filter[id] is not supported: id is the store id, not a document field.' });
        }

        if (Object.hasOwn(where, filter.field)) {
            throw new BadRequestError({ message: `filter[${filter.field}] may be given once.` });
        }

        where[filter.field] = filterValue(filter.value);
    }

    if (decoded.offset !== undefined && decoded.offset > 0) {
        throw new BadRequestError({ message: 'page[offset] is not supported for state collections.' });
    }

    return { where, limit: decoded.limit ?? DEFAULT_PAGE_LIMIT };
}

/** A stored document on the wire: its fields plus the store `id` (which wins over a field named `id`). */
export function serializeDoc(entry: { id: string; doc: unknown }): Record<string, unknown> {
    return isObject(entry.doc) ? { ...entry.doc, id: entry.id } : { id: entry.id, doc: entry.doc };
}
