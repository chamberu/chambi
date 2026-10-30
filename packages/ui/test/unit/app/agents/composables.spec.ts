/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { ACTIVITY_LIMIT, AGENTS_POLL_MS } from '../../../../app/agents/constants.ts';
import { useAgentDetail, useAgentRollups } from '../../../../app/agents/composables.ts';
import { ApiError } from '../../../../app/api/error.ts';
import type {
    AgentWire,
    RunListFilter,
    RunPage,
    RunWire,
} from '../../../../app/api/types.ts';
import { apiError, fakeClient } from '../../../utils/client.ts';
import { wireRun } from '../../../utils/runs.ts';
import { flush } from '../../../utils/timers.ts';

const AGENTS: AgentWire[] = [
    {
        name: 'deploy',
        channels: [{ channel: 'http', id: 'http' }],
        budget: { maxSteps: 20 },
        state: [],
    },
    {
        name: 'digest',
        channels: [{ channel: 'cron', id: 'cron:0 8 * * *' }],
        budget: { maxSteps: 12 },
        state: ['sent'],
    },
];

const page = (data: RunWire[], total = data.length): RunPage => ({
    data,
    meta: {
        total,
        limit: 100,
        offset: 0,
    },
});

/** Runs per agent; a status filter narrows them, `total` counts them. */
function listRunsOver(runs: RunWire[], seen: RunListFilter[] = []) {
    return async (filter: RunListFilter): Promise<RunPage> => {
        seen.push(filter);

        const matching = runs.filter((run) => (!filter.agent || run.agent === filter.agent) &&
            (!filter.status || filter.status.includes(run.status)));

        return page(matching.slice(0, filter.limit), matching.length);
    };
}

const now = new Date().toISOString();

describe('useAgentRollups', () => {
    it('rolls up running, waiting, the last run and the activity per agent', async () => {
        const runs = [
            wireRun({
                id: 'd1',
                agent: 'deploy',
                status: 'waiting',
                createdAt: now,
            }),
            wireRun({
                id: 'd2',
                agent: 'deploy',
                status: 'running',
                createdAt: now,
            }),
            wireRun({
                id: 'd3',
                agent: 'deploy',
                status: 'completed',
                createdAt: now,
            }),
        ];
        const seen: RunListFilter[] = [];
        const client = fakeClient({
            listAgents: async () => ({ data: AGENTS, issues: [] }),
            listSchedules: async () => [{
                agent: 'digest',
                channel: 'cron',
                trigger: 'cron:0 8 * * *',
                expression: '0 8 * * *',
                overlap: 'skip',
                nextAt: now,
            }],
            listRuns: listRunsOver(runs, seen),
        });
        const scope = effectScope();
        const state = scope.run(() => useAgentRollups(client))!;

        await flush();
        expect(state.agents.value.map((a) => a.name)).toEqual(['deploy', 'digest']);

        const deploy = state.rollups.value.deploy!;

        expect(deploy).toMatchObject({ running: 1, waiting: 1 });
        expect(deploy.last?.id).toBe('d1');
        expect(deploy.activity.count).toBe(3);
        expect(state.rollups.value.digest).toMatchObject({ running: 0, waiting: 0 });
        expect(state.rollups.value.digest!.last).toBeUndefined();
        expect(state.rollups.value.digest!.nextFire?.trigger).toBe('cron:0 8 * * *');
        expect(seen.every((f) => f.agent === undefined)).toBe(true);
        expect(seen.find((f) => !f.status)!.limit).toBe(ACTIVITY_LIMIT);
        scope.stop();
    });

    it('exposes the load issues of GET /agents', async () => {
        const issue = {
            agent: 'triage',
            message: 'agent.ts: Unexpected token',
            at: now,
        };
        const client = fakeClient({
            listAgents: async () => ({ data: AGENTS, issues: [issue] }),
            listSchedules: async () => [],
            listRuns: listRunsOver([]),
        });
        const scope = effectScope();
        const state = scope.run(() => useAgentRollups(client))!;

        await flush();
        expect(state.issues.value).toEqual([issue]);
        expect(state.agents.value.map((a) => a.name)).toEqual(['deploy', 'digest']);
        scope.stop();
    });

    it('sends four requests per pass whatever the agent count', async () => {
        const many: AgentWire[] = Array.from({ length: 40 }, (_, i) => ({ ...AGENTS[0]!, name: `agent-${i}` }));
        let requests = 0;
        const client = fakeClient({
            listAgents: async () => {
                requests++;

                return { data: many, issues: [] };
            },
            listSchedules: async () => {
                requests++;

                return [];
            },
            listRuns: async (filter) => {
                requests++;

                return listRunsOver([])(filter);
            },
        });
        const scope = effectScope();
        const state = scope.run(() => useAgentRollups(client))!;

        await flush();
        expect(Object.keys(state.rollups.value)).toHaveLength(40);
        expect(requests).toBe(4);
        scope.stop();
    });

    it('tells an agent without a run among the newest read from one that has none', async () => {
        const runs = Array.from({ length: ACTIVITY_LIMIT + 1 }, (_, i) => wireRun({
            id: `d${i}`,
            agent: i < ACTIVITY_LIMIT ? 'deploy' : 'digest',
            status: 'completed',
            createdAt: now,
        }));
        const client = fakeClient({
            listAgents: async () => ({ data: AGENTS, issues: [] }),
            listSchedules: async () => [],
            listRuns: listRunsOver(runs),
        });
        const scope = effectScope();
        const state = scope.run(() => useAgentRollups(client))!;

        await flush();
        expect(state.rollups.value.digest).toMatchObject({ lastBeyond: true });
        expect(state.rollups.value.deploy!.activity).toMatchObject({ count: ACTIVITY_LIMIT, saturated: true });
        expect(state.rollups.value.deploy!.lastBeyond).toBe(false);
        scope.stop();
    });

    it('waits out a 429 before the next pass', async () => {
        vi.useFakeTimers();

        try {
            let calls = 0;
            const client = fakeClient({
                listAgents: async () => {
                    calls++;

                    throw new ApiError(429, 'too_many_requests', 'slow down', 45);
                },
                listSchedules: async () => [],
                listRuns: listRunsOver([]),
            });
            const scope = effectScope();
            const state = scope.run(() => useAgentRollups(client))!;

            await vi.advanceTimersByTimeAsync(0);
            expect(state.error.value?.status).toBe(429);
            await vi.advanceTimersByTimeAsync(AGENTS_POLL_MS);
            expect(calls).toBe(1);
            await vi.advanceTimersByTimeAsync(45_000 - AGENTS_POLL_MS);
            expect(calls).toBe(2);
            scope.stop();
        } finally {
            vi.useRealTimers();
        }
    });

    it('a 403 sets error without throwing', async () => {
        const client = fakeClient({
            listAgents: async () => {
                throw apiError(403, 'forbidden');
            },
            listSchedules: async () => [],
            listRuns: listRunsOver([]),
        });
        const scope = effectScope();
        const state = scope.run(() => useAgentRollups(client))!;

        await flush();
        expect(state.error.value?.status).toBe(403);
        scope.stop();
    });
});

describe('useAgentDetail', () => {
    it('loads the agent, its runs, its waiting runs and its schedules', async () => {
        const runs = [
            wireRun({
                id: 'w1',
                agent: 'deploy',
                status: 'waiting',
                createdAt: now,
                waiting: {
                    kind: 'approval',
                    approvalId: 'a1',
                    toolName: 'deploy',
                    toolCallId: 'call-1',
                    title: 'Deploy prod?',
                    expiresAt: now,
                },
            }),
            wireRun({
                id: 'x',
                agent: 'digest',
                status: 'waiting',
                createdAt: now,
            }),
            wireRun({
                id: 'c1',
                agent: 'deploy',
                status: 'completed',
                createdAt: now,
            }),
        ];
        const client = fakeClient({
            listAgents: async () => ({ data: AGENTS, issues: [] }),
            listSchedules: async () => [],
            listRuns: listRunsOver(runs),
        });
        const scope = effectScope();
        const detail = scope.run(() => useAgentDetail(client, ref('deploy')))!;

        await flush();
        expect(detail.agent.value?.name).toBe('deploy');
        expect(detail.totalRuns.value).toBe(2);
        expect(detail.recent.value.map((r) => r.id)).toEqual(['w1', 'c1']);
        expect(detail.waitingRuns.value.map((r) => r.id)).toEqual(['w1']);
        expect(detail.activity.value.count).toBe(2);
        expect(detail.notFound.value).toBe(false);
        scope.stop();
    });

    it('drops the previous agent\'s error and data on a switch', async () => {
        let fail = true;
        const runs = [wireRun({
            id: 'c1',
            agent: 'deploy',
            status: 'completed',
            createdAt: now,
        })];
        const gate = Promise.withResolvers<void>();
        const client = fakeClient({
            listAgents: async () => {
                if (fail) {
                    throw apiError(0, 'network_error');
                }

                await gate.promise;

                return { data: AGENTS, issues: [] };
            },
            listSchedules: async () => [],
            listRuns: listRunsOver(runs),
        });
        const name = ref('digest');
        const scope = effectScope();
        const detail = scope.run(() => useAgentDetail(client, name))!;

        await flush();
        expect(detail.error.value?.code).toBe('network_error');
        fail = false;
        name.value = 'deploy';
        await nextTick();
        expect(detail.error.value).toBeUndefined(); // the pass for deploy is still in flight
        expect(detail.runs.value).toEqual([]);
        gate.resolve();
        await flush();
        expect(detail.agent.value?.name).toBe('deploy');
        scope.stop();
    });

    it('reports an unknown agent', async () => {
        const client = fakeClient({
            listAgents: async () => ({ data: AGENTS, issues: [] }),
            listSchedules: async () => [],
            listRuns: listRunsOver([]),
        });
        const scope = effectScope();
        const detail = scope.run(() => useAgentDetail(client, ref('nope')))!;

        await flush();
        expect(detail.notFound.value).toBe(true);
        scope.stop();
    });

    it('starts a run and refreshes', async () => {
        const runs: RunWire[] = [];
        const started: Array<[string, unknown, string | undefined]> = [];
        const client = fakeClient({
            listAgents: async () => ({ data: AGENTS, issues: [] }),
            listSchedules: async () => [],
            listRuns: listRunsOver(runs),
            startRun: async (name, body) => {
                started.push([name, body.payload, body.idempotencyKey]);
                runs.unshift(wireRun({
                    id: 'new',
                    agent: name,
                    status: 'queued',
                    createdAt: now,
                }));

                return { runId: 'new', deduplicated: false };
            },
        });
        const scope = effectScope();
        const detail = scope.run(() => useAgentDetail(client, ref('deploy')))!;

        await flush();
        expect(await detail.start({ env: 'prod' }, 'key-1')).toEqual({ runId: 'new', deduplicated: false });
        await flush();
        expect(started).toEqual([['deploy', { env: 'prod' }, 'key-1']]);
        expect(detail.recent.value.map((r) => r.id)).toEqual(['new']);
        scope.stop();
    });
});
