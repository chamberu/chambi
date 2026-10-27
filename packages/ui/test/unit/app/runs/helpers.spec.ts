/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { hasPermission } from '../../../../app/auth/helpers.ts';
import {
    canCancel,
    formatDuration,
    formatTokens,
    lastStepIndex,
    mergeRunEvent,
    parentOf,
} from '../../../../app/runs/helpers.ts';
import type { RunDetailState } from '../../../../app/runs/helpers.ts';
import { wireRun, wireStep } from '../../../utils/runs.ts';

function state(steps = [wireStep(0), wireStep(1, 'tool')]): RunDetailState {
    return {
        run: wireRun(),
        steps,
        live: {},
    };
}

describe('mergeRunEvent', () => {
    it('replaces the run', () => {
        const next = mergeRunEvent(state(), { type: 'run', run: wireRun({ status: 'completed' }) });
        expect(next.run.status).toBe('completed');
    });

    it('inserts a step by index and ignores a step it already has', () => {
        const base = state([wireStep(0), wireStep(2, 'tool')]);
        const inserted = mergeRunEvent(base, { type: 'step', step: wireStep(1, 'tool') });
        expect(inserted.steps.map((s) => s.index)).toEqual([0, 1, 2]);
        const again = mergeRunEvent(inserted, { type: 'step', step: wireStep(1, 'tool', { name: 'other' }) });
        expect(again).toBe(inserted);
    });

    it('appends deltas and drops them when their step lands', () => {
        // two llm steps landed (model steps 0 and 1), model step 2 is live
        let s = state([wireStep(0), wireStep(1, 'tool'), wireStep(2)]);
        s = mergeRunEvent(s, {
            type: 'delta',
            step: 2,
            kind: 'text',
            text: 'Hel',
        });
        s = mergeRunEvent(s, {
            type: 'delta',
            step: 2,
            kind: 'reasoning',
            text: 'think',
        });
        s = mergeRunEvent(s, {
            type: 'delta',
            step: 2,
            kind: 'text',
            text: 'lo',
        });
        expect(s.live).toEqual({ 2: { text: 'Hello', reasoning: 'think' } });
        s = mergeRunEvent(s, { type: 'step', step: wireStep(3) });
        expect(s.live).toEqual({});
    });

    it('ignores a delta for a finished step', () => {
        const s = mergeRunEvent(state(), {
            type: 'delta',
            step: 0,
            kind: 'text',
            text: 'late',
        });
        expect(s.live).toEqual({});
    });

    it('drops the live text once the run settled', () => {
        let s = mergeRunEvent(state(), {
            type: 'delta',
            step: 1,
            kind: 'text',
            text: 'x',
        });
        s = mergeRunEvent(s, { type: 'run', run: wireRun({ status: 'failed' }) });
        expect(s.live).toEqual({});
    });
});

describe('lastStepIndex', () => {
    it('is the highest index, undefined without steps', () => {
        expect(lastStepIndex([])).toBeUndefined();
        expect(lastStepIndex([wireStep(0), wireStep(3), wireStep(2)])).toBe(3);
    });
});

describe('canCancel', () => {
    it('follows status and run:cancel', () => {
        for (const status of ['queued', 'running', 'waiting', 'interrupted'] as const) {
            expect(canCancel(wireRun({ status }), ['run:cancel']), status).toBe(true);
            expect(canCancel(wireRun({ status }), ['run:read']), status).toBe(false);
        }
        for (const status of ['completed', 'failed', 'cancelled'] as const) {
            expect(canCancel(wireRun({ status }), ['*']), status).toBe(false);
        }
    });
});

describe('hasPermission', () => {
    it.each([
        [['*'], 'run:read', true],
        [['agent:*:run'], 'agent:a:run', true],
        [['agent:*:run'], 'agent:a:b:run', false],
        [['agent:a:*'], 'agent:a:approve', true],
        [['agent:a:run'], 'agent:b:run', false],
        [['run:*'], 'run:read', true],
        [['*:*'], 'run:read', true],
        [['*:*'], 'agent:a:run', false],
        [[], 'run:read', false],
    ] as const)('%j grants %s: %s', (granted, wanted, expected) => {
        expect(hasPermission(granted, wanted)).toBe(expected);
    });
});

describe('format', () => {
    it('formats tokens and durations', () => {
        expect(formatTokens(950)).toBe('950');
        expect(formatTokens(14_210)).toBe('14.2k');
        expect(formatTokens(2_500_000)).toBe('2.5M');
        expect(formatTokens(200_000)).toBe('200k');
        expect(formatTokens(1_000_000)).toBe('1M');
        expect(formatDuration(48_000)).toBe('0:48');
        expect(formatDuration(134_000)).toBe('2:14');
        expect(formatDuration(3_725_000)).toBe('1:02:05');
    });
});

describe('parentOf', () => {
    it('names the run a hand-off came from', () => {
        const base = wireRun();
        const run = wireRun({
            trigger: {
                ...base.trigger,
                channel: 'agent',
                trigger: 'handoff',
                parent: {
                    kind: 'handoff',
                    runId: 'p1',
                    agent: 'deploy',
                    depth: 1,
                },
            },
        });
        expect(parentOf(run)).toEqual({ runId: 'p1', label: 'handed off from' });
    });

    it('is undefined without a parent', () => {
        expect(parentOf(wireRun())).toBeUndefined();
    });

    it('is undefined for a kind it does not know', () => {
        const base = wireRun();
        const run = wireRun({ trigger: { ...base.trigger, parent: { kind: 'other', runId: 'p1' } as never } });
        expect(parentOf(run)).toBeUndefined();
    });
});
