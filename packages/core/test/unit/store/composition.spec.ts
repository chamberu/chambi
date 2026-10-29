/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_CONVERSATION_LIMITS, MemoryEffectStore, createMemoryStores } from '@chamvi/core';
import type { Run, Stores } from '@chamvi/core';
import { ControllableClock } from '../../utils/clock.ts';

describe('memory store composition', () => {
    it('shares a replacement capability while other capabilities remain isolated', async () => {
        const original = createMemoryStores();
        const effects = new MemoryEffectStore();
        const first: Stores = { ...original, effects };
        const second: Stores = { ...createMemoryStores(), effects };

        await first.effects.putEffect('sent', { message: 'hello' });
        await first.state.kvSet('agent', 'preference', 'first');
        await second.state.kvSet('agent', 'preference', 'second');

        expect(await second.effects.getEffect('sent')).toEqual({ result: { message: 'hello' } });
        expect(await original.effects.getEffect('sent')).toBeUndefined();
        expect(await first.state.kvGet('agent', 'preference')).toBe('first');
        expect(await second.state.kvGet('agent', 'preference')).toBe('second');
    });

    it('uses the supplied clock for run claims, keys, locks and conversation snapshots', async () => {
        const clock = new ControllableClock(new Date('2026-01-01T00:00:00Z'));
        const stores = createMemoryStores({ clock });
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
        await stores.runs.createRun(run);
        expect(await stores.runs.claimRun('run', 'first', 10)).toBe(true);
        expect(await stores.idempotency.claimKey('scope', 'key', 'first', 10)).toEqual({ created: true, runId: 'first' });
        expect(await stores.locks.acquire('lock', 'first', 10)).toBe(true);

        clock.advance(9);
        expect(await stores.runs.claimRun('run', 'second', 10)).toBe(false);
        expect(await stores.idempotency.claimKey('scope', 'key', 'second', 10)).toEqual({ created: false, runId: 'first' });
        expect(await stores.locks.acquire('lock', 'second', 10)).toBe(false);

        clock.advance(1);
        expect(await stores.runs.claimRun('run', 'second', 10)).toBe(true);
        expect(await stores.idempotency.claimKey('scope', 'key', 'second', 10)).toEqual({ created: true, runId: 'second' });
        expect(await stores.locks.acquire('lock', 'second', 10)).toBe(true);
        expect((await stores.runs.updateRun('run', { status: 'running' })).updatedAt).toEqual(clock.now());

        const scope = await stores.conversations.resolve({
            agent: 'agent',
            channel: 'test',
            account: 'account',
            chat: 'chat',
            audience: 'direct',
        });
        expect(await stores.conversations.beginTurn(scope, 'run', 'hello', DEFAULT_CONVERSATION_LIMITS)).toMatchObject({
            kind: 'ready',
            snapshot: { createdAt: clock.now() },
        });
    });
});
