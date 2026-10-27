/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { RunWire, StepWire } from '../api/types.ts';
import { hasPermission } from '../auth/helpers.ts';
import type { RunStreamEvent } from '../sse/types.ts';
import { CANCELABLE_STATUSES, PARENT_LABELS, SETTLED_STATUSES } from './constants.ts';

/** Live model output per model step (the checkpoint index a delta names). */
export type LiveText = { text: string; reasoning: string };

export type RunDetailState = {
    run: RunWire;
    steps: StepWire[];
    live: Record<number, LiveText>;
};

/** Model steps that landed: each one ends in exactly one `llm` step, in order. */
export function landedModelSteps(steps: readonly StepWire[]): number {
    return steps.filter((step) => step.kind === 'llm').length;
}

function pruneLive(live: Record<number, LiveText>, landed: number): Record<number, LiveText> {
    const next: Record<number, LiveText> = {};
    for (const [key, value] of Object.entries(live)) {
        if (Number(key) >= landed) next[Number(key)] = value;
    }
    return next;
}

/**
 * Folds one stream event into the run view: a run replaces (a settled one
 * drops the live text); a step is inserted by `index` (a known index is
 * ignored, so a reconnect never duplicates) and drops the live text of the
 * model steps that landed; a delta appends to its model step unless that
 * step landed already.
 */
export function mergeRunEvent(state: RunDetailState, event: RunStreamEvent): RunDetailState {
    if (event.type === 'run') {
        return {
            ...state,
            run: event.run,
            live: SETTLED_STATUSES.includes(event.run.status) ? {} : state.live,
        };
    }
    if (event.type === 'step') {
        if (state.steps.some((step) => step.index === event.step.index)) return state;
        const steps = [...state.steps, event.step].sort((a, b) => a.index - b.index);
        return {
            ...state,
            steps,
            live: pruneLive(state.live, landedModelSteps(steps)),
        };
    }
    if (event.step < landedModelSteps(state.steps)) return state;
    const current = state.live[event.step] ?? { text: '', reasoning: '' };
    return {
        ...state,
        live: {
            ...state.live,
            [event.step]: {
                text: event.kind === 'text' ? current.text + event.text : current.text,
                reasoning: event.kind === 'reasoning' ? current.reasoning + event.text : current.reasoning,
            },
        },
    };
}

export function lastStepIndex(steps: readonly StepWire[]): number | undefined {
    if (steps.length === 0) return undefined;
    return Math.max(...steps.map((step) => step.index));
}

export function canCancel(run: RunWire, permissions: readonly string[]): boolean {
    return CANCELABLE_STATUSES.includes(run.status) && hasPermission(permissions, 'run:cancel');
}

/** The run this one was started from (a hand-off), with the run page's label; undefined for none or an unknown kind. */
export function parentOf(run: RunWire): { runId: string; label: string } | undefined {
    const { parent } = run.trigger;
    if (!parent || typeof parent.runId !== 'string') return undefined;
    const label = Object.hasOwn(PARENT_LABELS, parent.kind) ? PARENT_LABELS[parent.kind] : undefined;
    return label ? { runId: parent.runId, label } : undefined;
}

export function isSettled(run: RunWire): boolean {
    return SETTLED_STATUSES.includes(run.status);
}

export function formatTokens(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return String(count);
}

export function formatDuration(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const pad = (value: number) => String(value).padStart(2, '0');
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** How long a run took, or runs so far. */
export function runDuration(run: RunWire, now: number): number | undefined {
    if (!run.startedAt) return undefined;
    const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
    return end - Date.parse(run.startedAt);
}

/** A short form of a run id for headings. */
export function shortId(id: string): string {
    return id.slice(0, 8);
}

/** The JSON of a value, pretty, for a code block; `undefined` reads as `—`. */
export function toJson(value: unknown): string {
    if (value === undefined) return '—';
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}
