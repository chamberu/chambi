/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    computed,
    onScopeDispose,
    shallowRef,
    watch,
} from 'vue';
import type { Ref } from 'vue';
import type { ApiError } from '../api/error.ts';
import { asApiError, retryDelayOf } from '../api/helpers.ts';
import type {
    AgentIssueWire,
    AgentWire,
    IApiClient,
    RunWire,
    ScheduleWire,
    StartRunResult,
} from '../api/types.ts';
import { createPoller } from '../polling/module.ts';
import {
    ACTIVE_LIMIT,
    ACTIVITY_LIMIT,
    AGENTS_POLL_MS,
    AGENT_WAITING_LIMIT,
    RECENT_RUNS,
} from './constants.ts';
import { buildRollups, summarizeActivity } from './helpers.ts';
import type { Activity, AgentRollup } from './types.ts';

/** The registered agents (`GET /agents`, needs `run:read`), loaded once per call site. */
export function useAgents(client: IApiClient) {
    const agents = shallowRef<AgentWire[]>([]);
    const error = shallowRef<ApiError>();
    const loaded = (async () => {
        try {
            agents.value = (await client.listAgents()).data;
        } catch (e) {
            error.value = asApiError(e);
        }
    })();

    return {
        agents,
        error,
        loaded,
    };
}

async function totalOf(client: IApiClient, agent: string, status: 'running' | 'waiting'): Promise<number> {
    return (await client.listRuns({
        agent,
        status: [status],
        limit: 1,
        offset: 0,
    })).meta.total;
}

/**
 * The agents overview: per agent the running and waiting counts, the newest run,
 * the next cron fire and the activity of the last 24 h, from four requests per
 * pass whatever the agent count (`buildRollups`). Polls every `AGENTS_POLL_MS`,
 * and waits out a 429's or 503's `Retry-After`.
 */
export function useAgentRollups(client: IApiClient) {
    const agents = shallowRef<AgentWire[]>([]);
    const issues = shallowRef<AgentIssueWire[]>([]);
    const schedules = shallowRef<ScheduleWire[]>([]);
    const rollups = shallowRef<Record<string, AgentRollup>>({});
    const error = shallowRef<ApiError>();
    const loaded = shallowRef(false);

    const poller = createPoller(async () => {
        try {
            const [list, crons, recent, active] = await Promise.all([
                client.listAgents(),
                client.listSchedules(),
                client.listRuns({ limit: ACTIVITY_LIMIT, offset: 0 }),
                client.listRuns({
                    status: ['running', 'waiting'],
                    limit: ACTIVE_LIMIT,
                    offset: 0,
                }),
            ]);

            agents.value = list.data;
            issues.value = list.issues;
            schedules.value = crons;
            rollups.value = buildRollups(list.data, crons, recent, active, Date.now());
            error.value = undefined;

            return undefined;
        } catch (e) {
            error.value = asApiError(e);

            return retryDelayOf(error.value);
        } finally {
            loaded.value = true;
        }
    }, AGENTS_POLL_MS);

    poller.start();
    onScopeDispose(() => poller.stop());

    return {
        agents,
        issues,
        schedules,
        rollups,
        error,
        loaded,
        refresh: () => poller.refresh(),
    };
}

/**
 * One agent's page: its summary and schedules, its newest runs (the 24 h
 * activity, the recent list, the run total), the running total and its waiting
 * runs. `start()` dispatches through the agent's `http.on()` subscription and refreshes.
 */
export function useAgentDetail(client: IApiClient, name: Ref<string>) {
    const agent = shallowRef<AgentWire>();
    const schedules = shallowRef<ScheduleWire[]>([]);
    const runs = shallowRef<RunWire[]>([]);
    const totalRuns = shallowRef(0);
    const running = shallowRef(0);
    const waitingRuns = shallowRef<RunWire[]>([]);
    const waitingTotal = shallowRef(0);
    const activity = shallowRef<Activity>(summarizeActivity([], Date.now(), ACTIVITY_LIMIT));
    const error = shallowRef<ApiError>();
    const loaded = shallowRef(false);
    let generation = 0;

    const poller = createPoller(async () => {
        const current = generation;
        const agentName = name.value;

        try {
            const [list, crons, recent, runningTotal, waiting] = await Promise.all([
                client.listAgents(),
                client.listSchedules(),
                client.listRuns({
                    agent: agentName,
                    limit: ACTIVITY_LIMIT,
                    offset: 0,
                }),
                totalOf(client, agentName, 'running'),
                client.listRuns({
                    agent: agentName,
                    status: ['waiting'],
                    limit: AGENT_WAITING_LIMIT,
                    offset: 0,
                }),
            ]);

            if (current !== generation) {
                return undefined;
            }

            agent.value = list.data.find((a) => a.name === agentName);
            schedules.value = crons.filter((s) => s.agent === agentName);
            runs.value = recent.data;
            totalRuns.value = recent.meta.total;
            running.value = runningTotal;
            waitingRuns.value = waiting.data.filter((run) => run.waiting);
            waitingTotal.value = waiting.meta.total;
            activity.value = summarizeActivity(recent.data, Date.now(), ACTIVITY_LIMIT);
            error.value = undefined;

            return undefined;
        } catch (e) {
            if (current !== generation) {
                return undefined;
            }

            error.value = asApiError(e);

            return retryDelayOf(error.value);
        } finally {
            if (current === generation) {
                loaded.value = true;
            }
        }
    }, AGENTS_POLL_MS);

    watch(name, () => {
        generation++;
        agent.value = undefined;
        schedules.value = [];
        runs.value = [];
        totalRuns.value = 0;
        running.value = 0;
        waitingRuns.value = [];
        waitingTotal.value = 0;
        activity.value = summarizeActivity([], Date.now(), ACTIVITY_LIMIT);
        error.value = undefined;
        loaded.value = false;
        void poller.refresh();
    });
    poller.start();
    onScopeDispose(() => poller.stop());

    return {
        agent,
        schedules,
        runs,
        recent: computed(() => runs.value.slice(0, RECENT_RUNS)),
        totalRuns,
        running,
        waitingRuns,
        waitingTotal,
        activity,
        error,
        loaded,
        notFound: computed(() => loaded.value && !error.value && !agent.value),
        refresh: () => poller.refresh(),
        async start(payload: unknown, idempotencyKey?: string): Promise<StartRunResult> {
            const result = await client.startRun(name.value, idempotencyKey === undefined ? { payload } : { payload, idempotencyKey });

            await poller.refresh();

            return result;
        },
    };
}
