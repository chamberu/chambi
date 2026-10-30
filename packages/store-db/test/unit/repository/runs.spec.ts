/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { DataSource } from 'typeorm';
import {
    afterAll,
    beforeAll,
    beforeEach,
    expect,
    it,
} from 'vitest';
import { InvalidRunStateError, RunNotFoundError } from '@chamvi/core';
import type { Run } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import { DatabaseRunRepository } from '@chamvi/store-db';
import { createTestDataSource, describePostgres, truncateRepository } from '../../utils/database.ts';

function makeRun(id: string, overrides: Partial<Run> = {}): Run {
    const createdAt = new Date(1_000);

    return {
        id,
        agent: 'a',
        status: 'queued',
        trigger: {
            id: `t-${id}`,
            agent: 'a',
            trigger: 'http',
            channel: 'http',
            payload: { n: 1 },
            receivedAt: new Date(1_234_567),
        },
        usage: { inputTokens: 1, outputTokens: 2 },
        createdAt,
        updatedAt: createdAt,
        ...overrides,
    };
}

describePostgres('DatabaseRunRepository runs', () => {
    let dataSource: DataSource;
    let clock: ControllableClock;
    let store: DatabaseRunRepository;

    beforeAll(async () => {
        dataSource = await createTestDataSource();
    });

    beforeEach(async () => {
        await truncateRepository(dataSource);
        clock = new ControllableClock(new Date(10_000));
        store = new DatabaseRunRepository({ dataSource, clock });
    });

    afterAll(async () => {
        await dataSource.destroy();
    });

    it('roundtrips every Run field with Date instances', async () => {
        const run = makeRun('r1', {
            concurrencyKey: 'ck',
            address: 'th',
            output: { ok: true },
            error: { code: 'X', message: 'm' },
            waiting: {
                kind: 'approval',
                approvalId: 'ap1',
                toolName: 'tool',
                toolCallId: 'call-1',
                title: 'Approve tool',
                body: 'details',
                options: [{
                    id: 'a',
                    label: 'A',
                    detail: '--- a\n+++ b',
                }],
                multiple: true,
                channel: 'github',
                address: 'o/r#1',
                slot: ' maintainer-状态-🚀 ',
                expiresAt: new Date('2026-03-08T07:15:00.456Z'),
                notifiedAt: new Date(2_000_001),
            },
            cancelRequested: true,
            startedAt: new Date('2026-03-08T07:30:00.123Z'),
            finishedAt: new Date('2026-11-01T05:30:00.123Z'),
        });

        await expect(store.insert(run)).resolves.toBe(true);

        const got = await store.findOne('r1');

        expect(got).toEqual(run);
        expect(got!.trigger.receivedAt).toBeInstanceOf(Date);
        expect(got!.waiting!.expiresAt).toBeInstanceOf(Date);
        expect(got!.waiting!.notifiedAt).toBeInstanceOf(Date);
        expect(got!.createdAt).toBeInstanceOf(Date);
        expect(got!.trigger.receivedAt.getTime()).toBe(run.trigger.receivedAt.getTime());
        expect(got!.waiting!.expiresAt.getTime()).toBe(run.waiting!.expiresAt.getTime());
        expect(got!.waiting!.notifiedAt!.getTime()).toBe(run.waiting!.notifiedAt!.getTime());
        expect(got!.createdAt.getTime()).toBe(run.createdAt.getTime());
        expect(got!.updatedAt.getTime()).toBe(run.updatedAt.getTime());
        expect(got!.startedAt!.getTime()).toBe(run.startedAt!.getTime());
        expect(got!.finishedAt!.getTime()).toBe(run.finishedAt!.getTime());

        await expect(store.claim('r1', 'o1', 3_000)).resolves.toBe(true);

        const claimed = await store.findOne('r1');

        expect(claimed!.claim).toEqual({ owner: 'o1', expiresAt: new Date(13_000) });
        expect(claimed!.claim!.expiresAt).toBeInstanceOf(Date);

        const minimal = makeRun('r2');

        await store.insert(minimal);

        const gotMinimal = await store.findOne('r2');

        expect(gotMinimal).toEqual(minimal);

        const keys = Object.keys(gotMinimal!);

        for (const key of ['output', 'error', 'waiting', 'claim', 'cancelRequested', 'concurrencyKey', 'address', 'startedAt', 'finishedAt']) {
            expect(keys).not.toContain(key);
        }
    });

    it('revives trigger.attachments[].createdAt as Date', async () => {
        const createdAt = new Date('2026-03-08T07:15:00.456Z');
        const base = makeRun('r1');
        const run = makeRun('r1', {
            trigger: {
                ...base.trigger,
                attachments: [{
                    id: 'art-1',
                    runId: 'r1',
                    agent: 'a',
                    mediaType: 'image/png',
                    filename: 'a.png',
                    size: 3,
                    createdAt,
                }],
            },
        });

        await store.insert(run);

        const got = await store.findOne('r1');

        expect(got).toEqual(run);
        expect(got!.trigger.attachments![0]!.createdAt).toBeInstanceOf(Date);
        expect(got!.trigger.attachments![0]!.createdAt.getTime()).toBe(createdAt.getTime());
    });

    it('runs.insert keeps the stored run on a duplicate id', async () => {
        await expect(store.insert(makeRun('r1', { address: 'first' }))).resolves.toBe(true);
        await expect(store.insert(makeRun('r1', { address: 'second' }))).resolves.toBe(false);
        expect((await store.findOne('r1'))!.address).toBe('first');
        await expect(store.findOne('missing')).resolves.toBeUndefined();
    });

    it('runs.update clears columns for keys set to undefined and keeps absent ones', async () => {
        await store.insert(makeRun('r1', {
            status: 'waiting',
            address: 'th',
            error: { code: 'X', message: 'm' },
            waiting: {
                kind: 'approval',
                approvalId: 'ap1',
                toolName: 'tool',
                toolCallId: 'call-1',
                title: 'Approve tool',
                expiresAt: new Date(50_000),
            },
        }));
        await store.claim('r1', 'o1', 1_000);

        const updated = await store.update('r1', {
            waiting: undefined,
            error: undefined,
            claim: undefined,
            status: 'queued',
        });
        const got = await store.findOne('r1');

        for (const run of [updated, got!]) {
            expect(Object.keys(run)).not.toContain('waiting');
            expect(Object.keys(run)).not.toContain('error');
            expect(Object.keys(run)).not.toContain('claim');
            expect(run.status).toBe('queued');
            expect(run.address).toBe('th');
            expect(run.usage).toEqual({ inputTokens: 1, outputTokens: 2 });
        }
    });

    it('runs.update guard has one winner under concurrency', async () => {
        await store.insert(makeRun('r1'));

        const results = await Promise.allSettled(Array.from(
            { length: 10 },
            () => store.update('r1', { status: 'running' }, { expectStatus: ['queued'] }),
        ));
        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(9);

        for (const r of rejected) {
            expect((r as PromiseRejectedResult).reason).toBeInstanceOf(InvalidRunStateError);
        }
    });

    it('runs.update reports a missing run and a foreign owner', async () => {
        await expect(store.update('missing', { address: 'x' })).rejects.toBeInstanceOf(RunNotFoundError);
        await store.insert(makeRun('r1'));
        await store.claim('r1', 'o1', 1_000);
        await expect(store.update('r1', { address: 'x' }, { expectOwner: 'o2' })).rejects.toBeInstanceOf(InvalidRunStateError);
        await expect(store.update('r1', { address: 'x' }, { expectOwner: 'o1', expectStatus: ['queued'] }))
            .resolves.toMatchObject({ address: 'x' });
    });

    it('runs.update sets updatedAt from the clock unless the patch has one', async () => {
        await store.insert(makeRun('r1'));
        clock.advance(500);

        const a = await store.update('r1', { address: 'x' });

        expect(a.updatedAt.getTime()).toBe(10_500);

        const b = await store.update('r1', { updatedAt: new Date(42) });

        expect(b.updatedAt.getTime()).toBe(42);
        expect((await store.findOne('r1'))!.updatedAt.getTime()).toBe(42);
    });

    it('runs.find with an empty status list matches nothing', async () => {
        await store.insert(makeRun('r1'));
        await expect(store.find({ status: [] })).resolves.toEqual({ data: [], total: 0 });
    });

    it('runs.find total ignores an offset past the end', async () => {
        await store.insert(makeRun('r1'));
        await store.insert(makeRun('r2'));
        await expect(store.find({ offset: 5 })).resolves.toEqual({ data: [], total: 2 });
    });

    it('runs.update ignores patch keys that are Object.prototype members', async () => {
        await store.insert(makeRun('r1'));

        const patch = {
            constructor: 1,
            toString: 2,
            status: 'running',
        } as unknown as Partial<Run>;

        await expect(store.update('r1', patch)).resolves.toMatchObject({ id: 'r1', status: 'running' });
    });
});
