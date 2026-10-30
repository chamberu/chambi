/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type {
    AgentWire,
    RunPage,
    RunWire,
    ScheduleWire,
} from '../api/types.ts';
import { ACTIVITY_WINDOW_MS } from './constants.ts';
import type {
    Activity,
    AgentRollup,
    ChannelChip,
    PayloadResult,
} from './types.ts';

/** The part of a subscription id after its first `:` (`github:issues.opened` -> `issues.opened`), if any. */
function idDetail(id: string): string | undefined {
    const at = id.indexOf(':');

    return at >= 0 && at < id.length - 1 ? id.slice(at + 1) : undefined;
}

/**
 * One chip per subscription (`AgentSummary.channels`): the channel and what
 * it listens to. A cron subscription shows its expression from
 * `GET /schedules` (else its id's detail), a webhook its path, GitHub its
 * events; any other channel the part of the id after the first `:`.
 */
export function channelChips(agent: AgentWire, schedules: readonly ScheduleWire[]): ChannelChip[] {
    return agent.channels.map((subscription): ChannelChip => {
        const chip: ChannelChip = { channel: subscription.channel, id: subscription.id };
        const schedule = schedules.find((s) => s.agent === agent.name &&
            s.channel === subscription.channel &&
            s.trigger === subscription.id);
        const detail = schedule?.expression ?? idDetail(subscription.id);

        if (detail) {
            chip.detail = detail;
        }

        if (subscription.hook) {
            chip.hook = subscription.hook;
        }

        return chip;
    });
}

const tokensOf = (run: RunWire) => run.usage.inputTokens + run.usage.outputTokens;

/**
 * The runs of the last 24 h among `runs` (newest first, at most `limit` read).
 * When the read hit the limit inside the window, `saturated` says the count is a floor.
 */
export function summarizeActivity(runs: readonly RunWire[], now: number, limit: number): Activity {
    const start = now - ACTIVITY_WINDOW_MS;
    const inside = runs.filter((run) => Date.parse(run.createdAt) >= start);
    const failed = inside.filter((run) => run.status === 'failed');
    const activity: Activity = {
        count: inside.length,
        saturated: runs.length >= limit && inside.length === runs.length,
        marks: inside.map((run) => ({
            id: run.id,
            status: run.status,
            left: Math.min(99.4, Math.max(0.6, (Date.parse(run.createdAt) - start) / ACTIVITY_WINDOW_MS * 100)),
        })),
        failed: failed.length,
        tokens: inside.reduce((sum, run) => sum + tokensOf(run), 0),
        runs: inside,
    };

    if (failed[0]) {
        activity.lastFailed = failed[0];
    }

    return activity;
}

/**
 * The overview's rollups from two app-wide pages, so a pass costs the same
 * requests whatever the agent count: `recent` (the newest runs of every agent)
 * gives the last run and the 24 h activity, `active` (running and waiting runs)
 * the counters. A full `recent` page inside the window marks every activity a floor.
 */
export function buildRollups(
    agents: readonly AgentWire[],
    schedules: readonly ScheduleWire[],
    recent: RunPage,
    active: RunPage,
    now: number,
): Record<string, AgentRollup> {
    const { saturated } = summarizeActivity(recent.data, now, recent.data.length > 0 ? recent.meta.limit : Infinity);
    const older = recent.meta.total > recent.data.length;

    return Object.fromEntries(agents.map((agent): [string, AgentRollup] => {
        const runs = recent.data.filter((run) => run.agent === agent.name);
        const mine = active.data.filter((run) => run.agent === agent.name);
        const activity = summarizeActivity(runs, now, Infinity);

        activity.saturated = saturated;

        const rollup: AgentRollup = {
            running: mine.filter((run) => run.status === 'running').length,
            waiting: mine.filter((run) => run.status === 'waiting').length,
            lastBeyond: !runs[0] && older,
            activity,
        };

        if (runs[0]) {
            rollup.last = runs[0];
        }

        const next = nextFireOf(agent.name, schedules);

        if (next) {
            rollup.nextFire = next;
        }

        return [agent.name, rollup];
    }));
}

/** The activity strip's accessible name: "12 runs in the last 24 h: 10 completed, 2 failed". */
export function activityLabel(activity: Activity): string {
    if (activity.count === 0) {
        return 'No runs in the last 24 h';
    }

    const counts = new Map<string, number>();

    for (const mark of activity.marks) {
        counts.set(mark.status, (counts.get(mark.status) ?? 0) + 1);
    }

    const parts = Array.from(counts, ([status, n]) => `${n} ${status}`).join(', ');

    return `${activity.count}${activity.saturated ? '+' : ''} runs in the last 24 h: ${parts}`;
}

/** "triage 71% · digest 29%": the two largest token shares by agent. */
export function tokenShares(runs: readonly RunWire[]): string {
    const total = runs.reduce((sum, run) => sum + tokensOf(run), 0);

    if (total === 0) {
        return '';
    }

    const byAgent = new Map<string, number>();

    for (const run of runs) {
        byAgent.set(run.agent, (byAgent.get(run.agent) ?? 0) + tokensOf(run));
    }

    return Array.from(byAgent)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([name, tokens]) => `${name} ${Math.round(tokens / total * 100)}%`)
        .join(' · ');
}

/** The agent subscribes to the `http` channel, so REST (and the UI) can start it. */
export function hasHttpSubscription(agent: AgentWire): boolean {
    return agent.channels.some((subscription) => subscription.channel === 'http');
}

export function matchesName(agent: AgentWire, query: string): boolean {
    const needle = query.trim().toLowerCase();

    return !needle || agent.name.toLowerCase().includes(needle);
}

export function nextFireOf(agent: string, schedules: readonly ScheduleWire[]): ScheduleWire | undefined {
    return schedules.filter((s) => s.agent === agent)
        .sort((a, b) => Date.parse(a.nextAt) - Date.parse(b.nextAt))[0];
}

/** The newest run of a trigger among `runs` (newest first); `null` when none is among them. */
export function lastRunOf(runs: readonly RunWire[], trigger: string): RunWire | null {
    return runs.find((run) => run.trigger.trigger === trigger) ?? null;
}

export function oldestWaiting(runs: readonly RunWire[]): RunWire | undefined {
    return [...runs].sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))[0];
}

/** The start-run payload: JSON, an empty text being `{}`. */
export function parsePayload(text: string): PayloadResult {
    if (!text.trim()) {
        return { ok: true, value: {} };
    }

    try {
        return { ok: true, value: JSON.parse(text) };
    } catch (e) {
        return { ok: false, message: `The payload is not valid JSON (${e instanceof Error ? e.message : String(e)}). Fix it, or send {} for an empty payload.` };
    }
}

/** A budget timeout as "15 min", "45 s" or "2 h". */
export function formatBudgetTime(ms: number | undefined): string {
    if (ms === undefined) {
        return 'none';
    }

    if (ms % 3_600_000 === 0) {
        return `${ms / 3_600_000} h`;
    }

    if (ms % 60_000 === 0) {
        return `${ms / 60_000} min`;
    }

    return `${Math.round(ms / 1000)} s`;
}

/** The failed tile's line: the newest failed run and its error code. */
export function failedSummary(activity: Activity): string {
    const run = activity.lastFailed;

    return run ? `${run.id.slice(0, 8)} · ${run.error?.code ?? 'failed'}` : 'no failures';
}

/** 32 random hex characters; `crypto.getRandomValues` works outside a secure context too, unlike `randomUUID`. */
export function newIdempotencyKey(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The idempotency keys of one start-run form: a retry of the same payload text
 * after a failure keeps its key (so a start whose answer was lost dedupes to
 * that run), a changed payload or a start after a success gets a fresh one.
 */
export function createStartKeys(mint: () => string = newIdempotencyKey) {
    let attempt: { text: string; key: string } | undefined;

    return {
        keyFor(text: string): string {
            if (!attempt || attempt.text !== text) {
                attempt = { text, key: mint() };
            }

            return attempt.key;
        },
        succeeded(): void {
            attempt = undefined;
        },
    };
}
