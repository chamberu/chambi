/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_CONVERSATION_LIMITS, MemoryEffectRepository, createMemoryRepositories } from '@chamvi/core';
import type { Repositories, Run } from '@chamvi/core';
import { ControllableClock } from '../../utils/clock.ts';

describe('memory store composition', () => {
    it('shares a replacement capability while other capabilities remain isolated', async () => {
        const original = createMemoryRepositories();
        const effects = new MemoryEffectRepository();
        const first: Repositories = { ...original, effects };
        const second: Repositories = { ...createMemoryRepositories(), effects };

        await first.effects.save('sent', { message: 'hello' });
        await first.state.set('agent', 'preference', 'first');
        await second.state.set('agent', 'preference', 'second');

        expect(await second.effects.findOne('sent')).toEqual({ result: { message: 'hello' } });
        expect(await original.effects.findOne('sent')).toBeUndefined();
        expect(await first.state.findOne('agent', 'preference')).toBe('first');
        expect(await second.state.findOne('agent', 'preference')).toBe('second');
    });

    it('uses the supplied clock for run claims, keys, locks and conversation snapshots', async () => {
        const clock = new ControllableClock(new Date('2026-01-01T00:00:00Z'));
        const repositories = createMemoryRepositories({ clock });
        const run: Run = {
            id: 'run',
            agent: 'agent',
            status: 'queued',
            trigger: {
                id: 'trigger',
                agent: 'agent',
                trigger: 'test',
                channel: 'test',
                payload: {},
                receivedAt: clock.now(),
            },
            usage: {
                inputTokens: 0,
                outputTokens: 0,
            },
            createdAt: clock.now(),
            updatedAt: clock.now(),
        };
        await repositories.runs.insert(run);
        expect(await repositories.runs.claim('run', 'first', 10)).toBe(true);
        expect(await repositories.idempotency.claim('scope', 'key', 'first', 10)).toEqual({ created: true, runId: 'first' });
        expect(await repositories.locks.acquire('lock', 'first', 10)).toBe(true);

        clock.advance(9);
        expect(await repositories.runs.claim('run', 'second', 10)).toBe(false);
        expect(await repositories.idempotency.claim('scope', 'key', 'second', 10)).toEqual({ created: false, runId: 'first' });
        expect(await repositories.locks.acquire('lock', 'second', 10)).toBe(false);

        clock.advance(1);
        expect(await repositories.runs.claim('run', 'second', 10)).toBe(true);
        expect(await repositories.idempotency.claim('scope', 'key', 'second', 10)).toEqual({ created: true, runId: 'second' });
        expect(await repositories.locks.acquire('lock', 'second', 10)).toBe(true);
        expect((await repositories.runs.update('run', { status: 'running' })).updatedAt).toEqual(clock.now());

        const scope = await repositories.conversations.resolve({
            agent: 'agent',
            channel: 'test',
            account: 'account',
            chat: 'chat',
            audience: 'direct',
        });
        expect(await repositories.conversations.beginTurn(scope, 'run', 'hello', DEFAULT_CONVERSATION_LIMITS)).toMatchObject({
            kind: 'ready',
            snapshot: { createdAt: clock.now() },
        });
    });
});
