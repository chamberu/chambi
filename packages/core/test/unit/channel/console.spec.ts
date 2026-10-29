/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError, consoleChannel } from '@chamvi/core';
import type { ChannelMessage, ChannelSendOptions, TriggerEnvelope } from '@chamvi/core';

const trigger: TriggerEnvelope = {
    id: 'e1',
    agent: 'release',
    trigger: 'http',
    channel: 'http',
    payload: {},
    receivedAt: new Date('2026-10-21T09:00:00Z'),
};

const opts: ChannelSendOptions = { signal: new AbortController().signal, trigger };

function collect() {
    const lines: string[] = [];
    return { lines, write: (line: string) => { lines.push(line); } };
}

describe('consoleChannel', () => {
    it('writes a message with its title, then the body lines', async () => {
        const { lines, write } = collect();
        const message: ChannelMessage = {
            kind: 'message',
            key: 'k1',
            runId: 'r1',
            agent: 'release',
            title: 'Deployed',
            body: 'line one\nline two',
        };
        await consoleChannel({ write }).out!(message, 'anywhere', opts);
        expect(lines).toEqual([
            '[chamvi] message: Deployed (agent release, run r1, key k1)',
            'line one',
            'line two',
        ]);
    });

    it('uses the first body line without a title', async () => {
        const { lines, write } = collect();
        await consoleChannel({ write }).out!({
            kind: 'message',
            key: 'k1',
            runId: 'r1',
            agent: 'release',
            body: 'Done.\nmore',
        }, 'x', opts);
        expect(lines[0]).toBe('[chamvi] message: Done. (agent release, run r1, key k1)');
        expect(lines.slice(1)).toEqual(['Done.', 'more']);
    });

    it('writes when an approval waits until', async () => {
        const { lines, write } = collect();
        await consoleChannel({ write }).out!({
            kind: 'approval',
            key: 'r1:a1',
            runId: 'r1',
            agent: 'release',
            title: 'Close #12?',
            body: 'The issue is stale.',
            approvalId: 'a1',
            expiresAt: new Date('2026-10-21T10:00:00Z'),
        }, 'x', opts);
        expect(lines).toEqual([
            '[chamvi] approval: Close #12? (agent release, run r1, key r1:a1)',
            'The issue is stale.',
            'approval a1 waits until 2026-10-21T10:00:00.000Z',
        ]);
    });

    it('lists the options of an approval', async () => {
        const { lines, write } = collect();
        const message = {
            kind: 'approval' as const,
            key: 'r1:a1',
            runId: 'r1',
            agent: 'release',
            title: 'Adopt?',
            body: 'Pick rules.',
            approvalId: 'a1',
            expiresAt: new Date('2026-10-21T10:00:00Z'),
            options: [{
                id: 'a',
                label: 'Alpha',
                detail: 'x',
            }, { id: 'b', label: 'Beta' }],
        };
        await consoleChannel({ write }).out!({ ...message, multiple: true }, 'x', opts);
        expect(lines).toEqual([
            '[chamvi] approval: Adopt? (agent release, run r1, key r1:a1)',
            'Pick rules.',
            'select one or more:',
            'option a: Alpha',
            'option b: Beta',
            'approval a1 waits until 2026-10-21T10:00:00.000Z',
        ]);
        lines.length = 0;
        await consoleChannel({ write }).out!(message, 'x', opts);
        expect(lines[2]).toBe('select one:');
    });

    it('swallows a throwing write', async () => {
        const channel = consoleChannel({
            write: () => {
                throw new Error('closed');
            },
        });
        await expect(channel.out!({
            kind: 'message',
            key: 'k',
            runId: 'r',
            agent: 'a',
            body: 'b',
        }, 'x', opts)).resolves.toBeUndefined();
    });

    it('is out only and named console by default', () => {
        const channel = consoleChannel();
        expect(channel.name).toBe('console');
        expect(channel.in).toBeUndefined();
        expect(channel.start).toBeUndefined();
    });

    it('takes a name and refuses an invalid one', () => {
        expect(consoleChannel({ name: 'dev' }).name).toBe('dev');
        expect(() => consoleChannel({ name: '' })).toThrow(InvalidAgentDefinitionError);
        expect(() => consoleChannel({ name: 'Bad Name' })).toThrow(InvalidAgentDefinitionError);
    });
});
