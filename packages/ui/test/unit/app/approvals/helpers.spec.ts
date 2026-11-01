/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import type { RunWire } from '../../../../app/api/types.ts';
import {
    canApprove,
    detailLines,
    isDiffDetail,
    jsonBody,
    notifiedLine,
    pendingApprovals,
} from '../../../../app/approvals/helpers.ts';
import { wireRun } from '../../../utils/runs.ts';

describe('pendingApprovals', () => {
    const waitingOn = (id: string, approvalId: string) => ({
        id,
        agent: 'deploy',
        status: 'waiting',
        waiting: { approvalId, toolName: 'deploy' },
    }) as unknown as RunWire;

    it('hides a run whose current approval was answered here', () => {
        const run = waitingOn('r1', 'a1');
        const other = waitingOn('r2', 'a1');

        expect(pendingApprovals([run, other], [{
            run,
            result: 'answered',
            approved: true,
        }])).toEqual([other]);
    });

    it('shows the run again once it waits on its next approval', () => {
        const answered = waitingOn('r1', 'a1');
        const next = waitingOn('r1', 'a2');

        expect(pendingApprovals([next], [{
            run: answered,
            result: 'answered',
            approved: true,
        }])).toEqual([next]);
    });

    it('keeps a run whose answer did not land and drops the linked run', () => {
        const run = waitingOn('r1', 'a1');
        const linked = waitingOn('r3', 'a9');

        expect(pendingApprovals([run, linked], [{
            run,
            result: 'forbidden',
            approved: true,
        }], 'r3')).toEqual([run]);
    });
});

describe('notifiedLine', () => {
    const waiting = {
        kind: 'approval' as const,
        approvalId: 'call-1:0',
        toolName: 'deploy',
        toolCallId: 'call-1',
        title: 'Deploy prod?',
        expiresAt: '2026-10-22T10:00:00.000Z',
    };

    it('names the channel (and address) once sent', () => {
        expect(notifiedLine(wireRun({
            waiting: {
                ...waiting,
                channel: 'capture',
                notifiedAt: '2026-10-21T10:00:00.000Z',
            },
        }))).toEqual({ text: 'capture', warn: false });
        expect(notifiedLine(wireRun({
            waiting: {
                ...waiting,
                channel: 'github',
                address: 'acme/api#12',
                notifiedAt: '2026-10-21T10:00:00.000Z',
            },
        }))).toEqual({ text: 'github · acme/api#12', warn: false });
    });

    it('says inbox only without a channel, else that it retries', () => {
        expect(notifiedLine(wireRun({ waiting }))).toEqual({ text: 'inbox only', warn: false });
        expect(notifiedLine(wireRun({ waiting: { ...waiting, channel: 'capture' } }))).toEqual({ text: 'not sent (retrying)', warn: true });
    });
});

describe('choice approvals', () => {
    const options = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];

    it('allows an approval once the selection fits', () => {
        expect(canApprove({}, [])).toBe(true);
        expect(canApprove({ options }, [])).toBe(false);
        expect(canApprove({ options }, ['a'])).toBe(true);
        expect(canApprove({ options }, ['a', 'b'])).toBe(false);
        expect(canApprove({ options, multiple: true }, [])).toBe(false);
        expect(canApprove({ options, multiple: true }, ['a', 'b'])).toBe(true);
    });

    it('recognizes a diff', () => {
        expect(isDiffDetail('@@ -1 +1 @@\n-a\n+b')).toBe(true);
        expect(isDiffDetail('--- a\n+++ b')).toBe(true);
        expect(isDiffDetail('- item\n- item')).toBe(false);
        expect(isDiffDetail('+1 vote')).toBe(false);
    });

    it('marks the lines of a diff', () => {
        expect(detailLines('--- a\n+++ b\n@@ -1 +1 @@\n-y\n+x\n same')).toEqual([
            { text: '--- a' },
            { text: '+++ b' },
            { text: '@@ -1 +1 @@', kind: 'hunk' },
            { text: '-y', kind: 'del' },
            { text: '+x', kind: 'add' },
            { text: ' same' },
        ]);
        expect(detailLines('- item\n+1 vote')).toEqual([{ text: '- item' }, { text: '+1 vote' }]);
    });
});

describe('jsonBody', () => {
    it('parses a JSON object or array body', () => {
        expect(jsonBody('{"tool":"git_push","input":{"force":false}}')).toEqual({ tool: 'git_push', input: { force: false } });
        expect(jsonBody('  [1, 2]\n')).toEqual([1, 2]);
    });

    it.each(['', 'Rolls out v2.', '{ not json', '42', '"text"', 'null', '{} trailing'])('answers undefined for %j', (body) => {
        expect(jsonBody(body)).toBeUndefined();
    });

    it('keeps a body above the size cap as text', () => {
        expect(jsonBody(JSON.stringify({ input: 'x'.repeat(20_000) }))).toBeUndefined();
    });
});
