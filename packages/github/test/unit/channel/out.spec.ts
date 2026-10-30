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
import {
    ChamviError,
    InvalidAgentDefinitionError,
    MemoryLockRepository,
    ValidationError,
} from '@chamvi/core';
import type { ChannelMessage, TriggerEnvelope } from '@chamvi/core';
import { GITHUB_CHANNEL_TIMEOUT_MS, githubChannel } from '@chamvi/github';
import type { GithubAppOptions, GithubChannelOptions } from '@chamvi/github';
import { renderComment } from '../../../src/channel/helpers.ts';
import {
    APPROVAL,
    createCommentFixture,
    githubEvent,
    githubTrigger,
    httpTrigger,
} from '../../utils/github.ts';

const COMMENTS = '/repos/octo/demo/issues/7/comments';
const ADDRESS = 'octo/demo#7';
const STATUS_APPROVAL: ChannelMessage = { ...APPROVAL, slot: 'maintainer-status' };

function setup(
    patch: Partial<GithubChannelOptions> = {},
    app: Partial<GithubAppOptions> = {},
    defaultMessage: ChannelMessage = APPROVAL,
) {
    const fixture = createCommentFixture(app);
    const peer = (overrides: Partial<GithubChannelOptions> = {}) => githubChannel({
        app: fixture.gh,
        mention: 'owner',
        clock: fixture.clock,
        ...patch,
        ...overrides,
    });
    const channel = peer();
    const send = (
        message: ChannelMessage = defaultMessage,
        address = ADDRESS,
        trigger: TriggerEnvelope = githubTrigger(),
        signal: AbortSignal = new AbortController().signal,
    ) => channel.out!(message, address, { signal, trigger });
    const posts = () => fixture.fake.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/comments'));

    return {
        ...fixture,
        channel,
        peer,
        send,
        posts,
        patches: () => fixture.fake.requests.filter((r) => r.method === 'PATCH' && r.path.includes('/issues/comments/')),
    };
}

function setupPersistent(patch: Partial<GithubChannelOptions> = {}) {
    return setup(patch, {}, STATUS_APPROVAL);
}

async function rejection(promise: Promise<unknown>): Promise<ChamviError> {
    const error = await promise.then(() => undefined, (e: unknown) => e);

    expect(error).toBeInstanceOf(ChamviError);

    return error as ChamviError;
}

describe('githubChannel persistent comments', () => {
    it('keeps delivery reconciliation separate for slotted and ordinary messages sharing a key', async () => {
        const {
            send,
            posts,
            fake,
        } = setup();

        await send({ ...APPROVAL, slot: 'status' });
        await send(APPROVAL);
        await send({ ...APPROVAL, slot: 'results' });
        await send(APPROVAL);
        await send({ ...APPROVAL, slot: 'status' });

        expect(posts()).toHaveLength(3);
        expect(fake.comments.get(ADDRESS)).toHaveLength(3);
    });
    it('does not overwrite an ordinary bot comment quoting a slot marker', async () => {
        const {
            send,
            fake,
            posts,
            patches,
        } = setup();

        await send(STATUS_APPROVAL);

        const status = fake.comments.get(ADDRESS)![0]!;
        const marker = String(status.body).match(/<!-- chamvi:comment=[0-9a-f]{64} -->/)![0];

        fake.comments.set(ADDRESS, []);
        await send({
            ...APPROVAL,
            key: 'quote',
            body: `Quoted status:\n${marker}`,
        });

        const ordinary = { ...fake.comments.get(ADDRESS)![0]! };

        await send(STATUS_APPROVAL);

        expect(posts()).toHaveLength(3);
        expect(patches()).toHaveLength(0);
        expect(fake.comments.get(ADDRESS)).toHaveLength(2);
        expect(fake.comments.get(ADDRESS)![0]).toEqual(ordinary);
    });

    it('does not suppress an update when the body quotes its delivery marker', async () => {
        const {
            send,
            fake,
            patches,
        } = setupPersistent();
        const next = {
            ...STATUS_APPROVAL,
            key: 'next',
            body: 'New status',
        };

        await send(next);

        const marker = String(fake.comments.get(ADDRESS)![0]!.body).match(/<!-- chamvi:effect=[0-9a-f]{64} -->/)![0];

        await send({ ...STATUS_APPROVAL, body: `Quoted delivery:\n${marker}` });
        await send(next);

        expect(patches()).toHaveLength(2);
        expect(fake.comments.get(ADDRESS)![0]!.body).toContain('New status');
        expect(fake.comments.get(ADDRESS)![0]!.body).not.toContain('Quoted delivery');
    });

    it('does not deduplicate an ordinary key against a slot delivery hash', async () => {
        const {
            send,
            fake,
            posts,
        } = setup();

        await send(STATUS_APPROVAL);

        const key = String(fake.comments.get(ADDRESS)![0]!.body).match(/<!-- chamvi:effect=([0-9a-f]{64}) -->/)![1]!;

        await send({
            ...APPROVAL,
            key,
            body: 'Ordinary comment',
        });

        expect(posts()).toHaveLength(2);
        expect(fake.comments.get(ADDRESS)).toHaveLength(2);
    });

    it('mixes ordinary comments and two named slots for one agent on one channel', async () => {
        const {
            send,
            fake,
            posts,
            patches,
        } = setup();
        const status: ChannelMessage = {
            ...APPROVAL,
            slot: 'maintainer-status',
            body: 'Initial status',
        };
        const review: ChannelMessage = {
            ...APPROVAL,
            slot: 'review-summary',
            body: 'Initial review',
        };
        const ordinary: ChannelMessage = {
            ...APPROVAL,
            key: 'ordinary:1',
            body: 'Ordinary comment',
        };

        await send(status);
        await send(ordinary);
        await send(review);

        const [statusComment, ordinaryComment, reviewComment] = fake.comments.get(ADDRESS)!;

        await send({
            ...status,
            key: 'status:2',
            body: 'Updated status',
        });
        await send({
            ...review,
            key: 'review:2',
            body: 'Updated review',
        });
        await send(ordinary);
        await send({
            ...ordinary,
            key: 'ordinary:2',
            body: 'Another ordinary comment',
        });

        const comments = fake.comments.get(ADDRESS)!;

        expect(posts()).toHaveLength(4);
        expect(patches()).toHaveLength(2);
        expect(comments).toHaveLength(4);
        expect(comments[0]).toMatchObject({ id: statusComment!.id, body: expect.stringContaining('Updated status') });
        expect(comments[1]).toMatchObject({ id: ordinaryComment!.id, body: expect.stringContaining('Ordinary comment') });
        expect(comments[2]).toMatchObject({ id: reviewComment!.id, body: expect.stringContaining('Updated review') });
        expect(comments[3]?.body).toContain('Another ordinary comment');
        expect(comments[0]?.body).toContain('<!-- chamvi:comment=');
        expect(comments[2]?.body).toContain('<!-- chamvi:comment=');
        expect(comments[1]?.body).not.toContain('<!-- chamvi:comment=');
        expect(comments[3]?.body).not.toContain('<!-- chamvi:comment=');
    });

    it('creates once and refreshes the same comment for a new approval', async () => {
        const {
            send,
            fake,
            posts,
        } = setupPersistent();

        await send();

        const firstId = fake.comments.get(ADDRESS)![0]!.id;
        const updated: ChannelMessage = {
            ...STATUS_APPROVAL,
            key: 'approval:new',
            runId: 'run-new',
            approvalId: 'approval-new',
            body: 'Updated assessment for head abc123',
            options: [{ id: 'merge', label: 'Merge' }],
            expiresAt: new Date('2026-11-01T00:00:00Z'),
        };

        await send(updated);

        expect(fake.comments.get(ADDRESS)![0]!.id).toBe(firstId);
        expect(posts()).toHaveLength(1);
        expect(fake.comments.get(ADDRESS)).toHaveLength(1);
        expect(fake.comments.get(ADDRESS)?.[0]?.body).toContain('Updated assessment for head abc123');
        expect(fake.comments.get(ADDRESS)?.[0]?.body).toContain('run-new');
        expect(fake.requests.filter((r) => r.method === 'PATCH')).toHaveLength(1);
    });

    it('updates a slot in a new run even when the caller key is fixed', async () => {
        const {
            send,
            fake,
            patches,
        } = setupPersistent();

        await send({
            ...STATUS_APPROVAL,
            key: 'status',
            body: 'First run',
        });
        await send({
            ...STATUS_APPROVAL,
            key: 'status',
            runId: 'r2',
            body: 'Second run',
        });

        expect(patches()).toHaveLength(1);
        expect(fake.comments.get(ADDRESS)?.[0]?.body).toContain('Second run');
    });

    it('finds an old slot comment on a later page without a since filter', async () => {
        const {
            send,
            fake,
            clock,
            posts,
            patches,
        } = setupPersistent();

        await send();

        const original = fake.comments.get(ADDRESS)![0]!;

        fake.comments.set(ADDRESS, [
            ...Array.from({ length: 100 }, (_, i) => ({
                id: i + 1,
                body: 'Unrelated comment',
                user: { login: 'octocat', type: 'User' },
                updated_at: '2020-01-01T00:00:00Z',
            })),
            { ...original, updated_at: '2020-01-01T00:00:00Z' },
        ]);
        clock.advance(7 * 24 * 60 * 60 * 1_000);

        const start = fake.requests.length;

        await send({
            ...STATUS_APPROVAL,
            key: 'later-approval',
            approvalId: 'later',
            body: 'A later assessment',
        });

        const lists = fake.requests.slice(start).filter((r) => r.method === 'GET' && r.path === COMMENTS);

        expect(lists).toHaveLength(2);
        expect(lists[1]?.query.page).toBe('2');
        expect(lists.every((r) => r.query.since === undefined)).toBe(true);
        expect(posts()).toHaveLength(1);
        expect(patches()).toHaveLength(1);
        expect(fake.comments.get(ADDRESS)?.[100]).toMatchObject({ id: original.id, body: expect.stringContaining('later') });
    });

    it.each([
        ['a human', { login: 'chamvi-test[bot]', type: 'User' }],
        ['another bot', { login: 'other-app[bot]', type: 'Bot' }],
    ])('ignores a copied slot marker from %s', async (_label, user) => {
        const {
            send,
            fake,
            posts,
            patches,
        } = setupPersistent();

        await send();

        const original = fake.comments.get(ADDRESS)![0]!;

        fake.comments.set(ADDRESS, [{ ...original, user }]);

        await send({ ...STATUS_APPROVAL, key: 'next-approval' });

        expect(posts()).toHaveLength(2);
        expect(patches()).toHaveLength(0);
        expect(fake.comments.get(ADDRESS)?.[0]).toMatchObject({ body: original.body, user });
    });

    it('skips both POST and PATCH on a same-key retry, including after an update', async () => {
        const {
            send,
            posts,
            patches,
        } = setupPersistent();

        await send();
        await send({ ...STATUS_APPROVAL, body: 'Changed payload, same delivery key' });
        expect(posts()).toHaveLength(1);
        expect(patches()).toHaveLength(0);

        const next = {
            ...STATUS_APPROVAL,
            key: 'next-approval',
            approvalId: 'next',
        };

        await send(next);
        await send({ ...next, body: 'Changed again' });
        expect(posts()).toHaveLength(1);
        expect(patches()).toHaveLength(1);
    });

    it('recreates a deleted slot comment even for the same delivery key', async () => {
        const {
            send,
            fake,
            posts,
            patches,
        } = setupPersistent();

        await send();

        const originalId = fake.comments.get(ADDRESS)?.[0]?.id;

        fake.comments.delete(ADDRESS);

        await send();

        expect(posts()).toHaveLength(2);
        expect(patches()).toHaveLength(0);
        expect(fake.comments.get(ADDRESS)).toHaveLength(1);
        expect(fake.comments.get(ADDRESS)?.[0]?.id).not.toBe(originalId);
    });

    it.each([403, 500])('does not POST after a failed slot lookup (%i), and releases for retry', async (status) => {
        const {
            send,
            fake,
            posts,
        } = setupPersistent();

        fake.failNext('GET', COMMENTS, status);

        expect((await rejection(send())).code).toBe('github_request');
        expect(posts()).toHaveLength(0);
        await send();
        expect(posts()).toHaveLength(1);
    });

    it.each([403, 404, 500])('does not POST after a failed slot update (%i), and releases for retry', async (status) => {
        const {
            send,
            fake,
            posts,
            patches,
        } = setupPersistent();

        await send();

        const original = { ...fake.comments.get(ADDRESS)![0]! };

        fake.failNext('PATCH', `/repos/octo/demo/issues/comments/${original.id}`, status);

        const next = {
            ...STATUS_APPROVAL,
            key: 'next-approval',
            approvalId: 'next',
        };

        expect((await rejection(send(next))).code).toBe('github_request');
        expect(posts()).toHaveLength(1);
        expect(fake.comments.get(ADDRESS)?.[0]?.body).toBe(original.body);
        await send(next);
        expect(posts()).toHaveLength(1);
        expect(patches()).toHaveLength(2);
    });

    it('fails a disappearing comment PATCH, then recreates on the next send', async () => {
        const {
            send,
            fake,
            posts,
            patches,
        } = setupPersistent();

        await send();

        const original = fake.comments.get(ADDRESS)![0]!;
        let deleted = false;

        fake.route('GET', COMMENTS, () => {
            const comments = fake.comments.get(ADDRESS) ?? [];

            if (!deleted) {
                fake.comments.delete(ADDRESS);
                deleted = true;
            }

            return { status: 200, body: comments };
        });

        const next = {
            ...STATUS_APPROVAL,
            key: 'next-approval',
            approvalId: 'next',
        };

        expect((await rejection(send(next))).message).toContain('404');
        expect(posts()).toHaveLength(1);
        expect(patches()).toHaveLength(1);
        await send(next);
        expect(posts()).toHaveLength(2);
        expect(fake.comments.get(ADDRESS)?.[0]?.id).not.toBe(original.id);
    });

    it.each([
        ['agent', {}, { ...STATUS_APPROVAL, agent: 'other-agent' }, ADDRESS],
        ['slot', {}, { ...STATUS_APPROVAL, slot: 'other-slot' }, ADDRESS],
        ['channel', { name: 'other-channel' }, STATUS_APPROVAL, ADDRESS],
        ['issue', {}, STATUS_APPROVAL, 'octo/demo#8'],
        ['repository', {}, STATUS_APPROVAL, 'octo/other#7'],
    ] satisfies Array<[string, Partial<GithubChannelOptions>, ChannelMessage, string]>)('isolates the persistent comment by %s', async (_label, options, message, address) => {
        const {
            send,
            fake,
            peer,
            posts,
            patches,
        } = setupPersistent();

        fake.issues.set(address, { number: 7 });
        await send();

        const other = peer(options);

        await other.out!(message, address, {
            signal: new AbortController().signal,
            trigger: githubTrigger(githubEvent(), other.name),
        });
        await send();

        expect(posts()).toHaveLength(2);
        expect(patches()).toHaveLength(0);
    });

    it('normalizes repository casing for the same named slot across instances', async () => {
        const {
            send,
            fake,
            peer,
            posts,
            patches,
        } = setupPersistent();

        await send();
        fake.comments.set('OCTO/DEMO#7', fake.comments.get(ADDRESS)!);

        const other = peer();

        await other.out!({ ...STATUS_APPROVAL, key: 'next-approval' }, 'OCTO/DEMO#7', {
            signal: new AbortController().signal,
            trigger: githubTrigger(),
        });

        expect(posts()).toHaveLength(1);
        expect(patches()).toHaveLength(1);
    });

    it('coordinates independently constructed instances with shared locks and retries the busy loser', async () => {
        const locks = new MemoryLockRepository();
        const {
            send,
            fake,
            peer,
            posts,
            patches,
        } = setupPersistent({ locks });
        const other = peer();
        const entered = Promise.withResolvers<void>();
        const proceed = Promise.withResolvers<void>();

        fake.route('GET', COMMENTS, async () => {
            entered.resolve();
            await proceed.promise;

            return { status: 200, body: fake.comments.get(ADDRESS) ?? [] };
        });

        const winner = send();

        await entered.promise;

        const retry = () => other.out!({ ...STATUS_APPROVAL, key: 'next-approval' }, ADDRESS, {
            signal: new AbortController().signal,
            trigger: githubTrigger(),
        });

        try {
            const error = await rejection(retry());

            expect(error.code).toBe('github_request');
            expect(error.message).toMatch(/busy/i);
            expect(posts()).toHaveLength(0);
        } finally {
            proceed.resolve();
            await winner;
        }

        expect(posts()).toHaveLength(1);
        await retry();
        expect(posts()).toHaveLength(1);
        expect(patches()).toHaveLength(1);
    });

    it('releases the slot after a failed POST', async () => {
        const {
            send,
            fake,
            posts,
        } = setupPersistent();

        fake.failNext('POST', COMMENTS, 500);

        expect((await rejection(send())).code).toBe('github_request');
        expect(fake.comments.get(ADDRESS)).toBeUndefined();
        await send();
        expect(posts()).toHaveLength(2);
        expect(fake.comments.get(ADDRESS)).toHaveLength(1);
    });

    it.each(['abort', 'timeout'])('releases the slot after %s during a PATCH', async (mode) => {
        const {
            send,
            fake,
            clock,
            posts,
            patches,
        } = setupPersistent();

        await send();

        const entered = Promise.withResolvers<void>();
        let stalled = true;

        fake.route('PATCH', '/repos/octo/demo/issues/comments/:id', async ({ body }) => {
            if (stalled) {
                entered.resolve();

                return new Promise(() => {});
            }

            Object.assign(fake.comments.get(ADDRESS)![0]!, body);

            return { status: 200, body: fake.comments.get(ADDRESS)![0] };
        });

        const controller = new AbortController();
        const reason = new Error('cancel the update');
        const next = { ...STATUS_APPROVAL, key: 'next-approval' };
        const pending = send(next, ADDRESS, githubTrigger(), controller.signal).catch((error: unknown) => error);

        await entered.promise;

        if (mode === 'abort') {
            controller.abort(reason);
            expect(await pending).toBe(reason);
        } else {
            clock.advance(GITHUB_CHANNEL_TIMEOUT_MS);
            expect(await pending).toMatchObject({ code: 'github_request', message: expect.stringContaining('within') });
        }

        stalled = false;
        await send(next);
        expect(posts()).toHaveLength(1);
        expect(patches()).toHaveLength(2);
    });

    it.each(['abort', 'timeout'])('rejects promptly on %s while acquiring, and releases a late acquisition without writing', async (mode) => {
        const locks = new MemoryLockRepository();
        const release = vi.spyOn(locks, 'release');
        const acquire = Promise.withResolvers<boolean>();

        const acquireLock = vi.spyOn(locks, 'acquire').mockImplementationOnce(() => acquire.promise);

        const {
            send,
            fake,
            clock,
        } = setupPersistent({ locks });
        const controller = new AbortController();
        const reason = new Error('cancel while acquiring');
        let settled = false;
        const pending = send(STATUS_APPROVAL, ADDRESS, githubTrigger(), controller.signal).catch((error: unknown) => {
            settled = true;

            return error;
        });

        if (mode === 'abort') {
            controller.abort(reason);
        } else {
            clock.advance(GITHUB_CHANNEL_TIMEOUT_MS);
        }

        try {
            await vi.waitFor(() => expect(settled).toBe(true), { timeout: 100 });

            if (mode === 'abort') {
                expect(await pending).toBe(reason);
            } else {
                expect(await pending).toMatchObject({ code: 'github_request', message: expect.stringContaining('within') });
            }
        } finally {
            acquire.resolve(true);
            await pending;
        }

        await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
        expect(release).toHaveBeenCalledWith(acquireLock.mock.calls[0]?.[0], acquireLock.mock.calls[0]?.[1]);
        expect(acquireLock.mock.calls[0]?.[2]).toBe(GITHUB_CHANNEL_TIMEOUT_MS * 2);
        expect(fake.requests).toHaveLength(0);
    });

    it('observes a rejected acquisition when the lock provider aborts synchronously', async () => {
        const controller = new AbortController();
        const reason = new Error('cancelled in lock provider');
        const { send } = setupPersistent({
            locks: {
                acquire: async () => {
                    controller.abort(reason);

                    throw new Error('lock store unavailable');
                },
                release: async () => {},
            },
        });

        await expect(send(STATUS_APPROVAL, ADDRESS, githubTrigger(), controller.signal)).rejects.toBe(reason);
    });

    it.each(['abort', 'timeout'])('settles promptly on %s while release remains pending after a successful write', async (mode) => {
        const locks = new MemoryLockRepository();
        const entered = Promise.withResolvers<void>();

        vi.spyOn(locks, 'release').mockImplementation(() => {
            entered.resolve();

            return new Promise(() => {});
        });

        const {
            send,
            fake,
            clock,
        } = setupPersistent({ locks });
        const controller = new AbortController();
        const reason = new Error('cancel while releasing');
        let settled = false;
        const pending = send(STATUS_APPROVAL, ADDRESS, githubTrigger(), controller.signal).catch((error: unknown) => {
            settled = true;

            return error;
        });

        await entered.promise;
        expect(fake.comments.get(ADDRESS)).toHaveLength(1);

        if (mode === 'abort') {
            controller.abort(reason);
        } else {
            clock.advance(GITHUB_CHANNEL_TIMEOUT_MS);
        }

        await vi.waitFor(() => expect(settled).toBe(true), { timeout: 100 });

        if (mode === 'abort') {
            expect(await pending).toBe(reason);
        } else {
            expect(await pending).toMatchObject({ code: 'github_request', message: expect.stringContaining('within') });
        }
    });

    it('wraps a rejected release as github_request after a successful write', async () => {
        const locks = new MemoryLockRepository();

        vi.spyOn(locks, 'release').mockRejectedValueOnce(new Error('lock store unavailable'));

        const { send, fake } = setupPersistent({ locks });
        const error = await rejection(send());

        expect(error.code).toBe('github_request');
        expect(error.message).toContain('lock store unavailable');
        expect(fake.comments.get(ADDRESS)).toHaveLength(1);
    });

    it('releases when abort races the successful acquisition callback', async () => {
        const locks = new MemoryLockRepository();
        const acquire = Promise.withResolvers<boolean>();
        const release = vi.spyOn(locks, 'release');
        const acquireLock = vi.spyOn(locks, 'acquire').mockImplementationOnce(() => acquire.promise);
        const { send, fake } = setupPersistent({ locks });
        const controller = new AbortController();
        const reason = new Error('cancel just after acquisition');
        const pending = send(STATUS_APPROVAL, ADDRESS, githubTrigger(), controller.signal).catch((error: unknown) => error);

        acquire.resolve(true);
        queueMicrotask(() => controller.abort(reason));

        expect(await pending).toBe(reason);
        expect(release).toHaveBeenCalledOnce();
        expect(release).toHaveBeenCalledWith(acquireLock.mock.calls[0]?.[0], acquireLock.mock.calls[0]?.[1]);
        expect(fake.requests).toHaveLength(0);
    });

    it('preserves choices, approval links and length limits on both create and update', async () => {
        const approvalUrl = vi.fn(({ approvalId }: { approvalId: string }) => `https://chamvi.test/approvals/${approvalId}`);
        const {
            send,
            fake,
            posts,
            patches,
        } = setupPersistent({ approvalUrl });
        const first: ChannelMessage = {
            ...STATUS_APPROVAL,
            body: 'x'.repeat(70_000),
            options: [
                { id: 'allow-once', label: 'Allow once' },
                { id: 'approve-run', label: 'Approve this run' },
                { id: 'reject', label: 'Reject' },
            ],
        };
        const next = {
            ...first,
            key: 'next-approval',
            approvalId: 'next',
        };

        await send(first);
        await send(next);

        for (const [request, message] of [[posts()[0], first], [patches()[0], next]] as const) {
            const { body } = (request?.body as { body: string });

            expect(body).toContain('@owner');
            expect(body).toContain('allow-once');
            expect(body).toContain('approve-run');
            expect(body).toContain('Reject');
            expect(body).toContain(`https://chamvi.test/approvals/${message.approvalId}`);
            expect(body).toContain('cut,');
            expect(body.length).toBeLessThanOrEqual(65_536);
            expect(body).toMatch(/<!-- chamvi:effect=[0-9a-f]{64} -->/);
        }

        expect(fake.comments.get(ADDRESS)).toHaveLength(1);
        expect(approvalUrl).toHaveBeenCalledTimes(2);
    });
});

describe('github channel out', () => {
    it.each([null, false, 1, '', ' ', '\t\n', 'status\0', '\uD800', '\uDC00', [], {}])('rejects an invalid explicit slot %j before any request', async (slot) => {
        const { send, fake } = setup();
        const message = { ...APPROVAL, slot } as unknown as ChannelMessage;

        await expect(send(message)).rejects.toBeInstanceOf(ValidationError);
        expect(fake.requests).toHaveLength(0);
    });

    it('treats an explicitly undefined slot as an ordinary comment', async () => {
        const {
            send,
            fake,
            posts,
            patches,
        } = setup();

        await send({ ...APPROVAL, slot: undefined });
        await send({
            ...APPROVAL,
            slot: undefined,
            key: 'r1:a2',
        });

        expect(posts()).toHaveLength(2);
        expect(patches()).toHaveLength(0);

        for (const comment of fake.comments.get(ADDRESS)!) {
            expect(comment.body).not.toContain('<!-- chamvi:comment=');
        }
    });

    it('posts one comment on the address', async () => {
        const {
            send,
            posts,
            fake,
        } = setup();

        await send();
        expect(posts()).toHaveLength(1);
        expect(posts()[0]!.path).toBe(COMMENTS);
        expect(posts()[0]!.body).toEqual({
            body: renderComment(APPROVAL, {
                mentions: ['owner'],
                marker: '<!-- chamvi:effect=r1:a1 -->',
            }),
        });
        // as installation 42, the event's
        expect(fake.tokenInstallations).toEqual([42]);
    });

    it('comments on another issue than the run\'s', async () => {
        const { send, fake } = setup();

        fake.issues.set('octo/other#3', { number: 3, state: 'open' });
        await send(APPROVAL, 'octo/other#3');
        expect(fake.comments.get('octo/other#3')).toHaveLength(1);
        expect(fake.comments.get('octo/demo#7') ?? []).toHaveLength(0);
    });

    it('passes the approval ref to approvalUrl', async () => {
        const refs: unknown[] = [];
        const { send, posts } = setup({
            approvalUrl: (ref) => {
                refs.push(ref);

                return `https://app.example/ui/approvals?run=${ref.runId}&approval=${ref.approvalId}`;
            },
        });

        await send();
        expect(refs).toEqual([{
            runId: 'r1',
            approvalId: 'a1',
            agent: 'release',
        }]);
        expect((posts()[0]!.body as { body: string }).body).toContain('Approve or deny: https://app.example/ui/approvals?run=r1&approval=a1');
    });

    it('finds its own comment', async () => {
        const { send, posts } = setup();

        await send();
        await send();
        expect(posts()).toHaveLength(1);
    });

    it('ignores a copied marker', async () => {
        const {
            send,
            posts,
            fake,
            clock,
        } = setup();
        const marker = '<!-- chamvi:effect=r1:a1 -->';

        fake.comments.set('octo/demo#7', [{
            id: 1,
            body: `copied ${marker}`,
            user: { login: 'mallory', type: 'User' },
            updated_at: clock.now().toISOString(),
        }]);
        await send();
        expect(posts()).toHaveLength(1);

        const other = setup();

        other.fake.comments.set('octo/demo#7', [{
            id: 2,
            body: `posted earlier\n${marker}`,
            user: { login: 'Chamvi-Test[bot]', type: 'Bot' },
            updated_at: other.clock.now().toISOString(),
        }]);
        await other.send();
        expect(other.posts()).toHaveLength(0);
    });

    it('posts again for another key', async () => {
        const { send, posts } = setup();

        await send();
        await send({ ...APPROVAL, key: 'r1:a2' });
        expect(posts()).toHaveLength(2);
    });

    it('hashes a key an HTML comment cannot hold into the marker', async () => {
        const { send, posts } = setup();

        await send({
            kind: 'message',
            key: 'r1:emit:github:a--b',
            runId: 'r1',
            agent: 'release',
            body: 'Hi',
        });
        expect((posts()[0]!.body as { body: string }).body).toMatch(/<!-- chamvi:effect=sha256:[0-9a-f]{64} -->$/);
    });

    it('lists comments since the run was received, less the skew', async () => {
        const { send, fake } = setup();

        await send();

        const list = fake.requests.find((r) => r.method === 'GET' && r.path === COMMENTS);

        expect(list?.query).toMatchObject({ since: '2026-10-21T08:00:00.000Z', per_page: '100' });
    });

    it('throws on a GitHub failure', async () => {
        const {
            send,
            posts,
            fake,
        } = setup();

        fake.failNext('POST', COMMENTS, 502);

        const error = await rejection(send());

        expect(error.code).toBe('github_request');
        expect(error.message.startsWith('GitHub 502')).toBe(true);
        expect(error.message).not.toContain('ghs_');

        await send();
        expect(posts()).toHaveLength(2);
        expect(fake.comments.get('octo/demo#7')).toHaveLength(1);
    });

    it('times out', async () => {
        const {
            send,
            fake,
            clock,
        } = setup();

        const entered = Promise.withResolvers<void>();

        fake.route('GET', '/repos/:owner/:repo/issues/:number/comments', () => {
            entered.resolve();

            return new Promise(() => {});
        });

        const pending = send();

        await entered.promise;
        clock.advance(GITHUB_CHANNEL_TIMEOUT_MS);

        const error = await rejection(pending);

        expect(error.code).toBe('github_request');
        expect(error.message).toBe('GitHub did not answer within 30000ms.');
    });

    it('stops when the caller aborts', async () => {
        const {
            send,
            fake,
            posts,
        } = setup();

        const entered = Promise.withResolvers<void>();

        fake.route('GET', '/repos/:owner/:repo/issues/:number/comments', () => {
            entered.resolve();

            return new Promise(() => {});
        });

        const controller = new AbortController();
        const pending = send(APPROVAL, ADDRESS, githubTrigger(), controller.signal);

        await entered.promise;

        const reason = new Error('the engine gave up');

        controller.abort(reason);
        await expect(pending).rejects.toBe(reason);
        expect(posts()).toHaveLength(0);
    });

    it.each([
        ['no number', 'octo/demo'],
        ['number 0', 'octo/demo#0'],
        ['a fractional number', 'octo/demo#1.5'],
        ['a dot segment', 'a/../b#1'],
        ['no owner', 'demo#1'],
        ['an empty address', ''],
        ['two numbers', 'octo/demo#7#8'],
    ])('refuses an address with %s before any request', async (_label, address) => {
        const { send, fake } = setup();

        await expect(send(APPROVAL, address)).rejects.toBeInstanceOf(ValidationError);
        expect(fake.requests).toEqual([]);
    });

    it('comments as the app installation for a run of another channel', async () => {
        const {
            send,
            posts,
            fake,
        } = setup({}, { installationId: 7 });

        await send(APPROVAL, ADDRESS, httpTrigger());
        expect(posts().map((r) => r.path)).toEqual([COMMENTS]);
        expect(fake.tokenInstallations).toEqual([7]);
    });

    it('comments as the app installation for a github event without one', async () => {
        const { send, fake } = setup({}, { installationId: 7 });

        await send(APPROVAL, ADDRESS, githubTrigger(githubEvent({ installationId: undefined })));
        expect(fake.tokenInstallations).toEqual([7]);
    });

    it('takes the event installation of a run of a renamed github channel', async () => {
        const {
            gh,
            fake,
            clock,
        } = createCommentFixture({ installationId: 7 });
        const channel = githubChannel({
            app: gh,
            name: 'github-ent',
            clock,
        });

        await channel.out!(APPROVAL, ADDRESS, {
            signal: new AbortController().signal,
            trigger: githubTrigger(githubEvent(), 'github-ent'),
        });
        expect(fake.tokenInstallations).toEqual([42]);
    });

    it('comments as the installation of the address repository', async () => {
        const { send, fake } = setup({}, { installationId: 7 });

        fake.installations.set('octo/demo', 9);
        await send(APPROVAL, ADDRESS, httpTrigger());
        expect(fake.tokenInstallations).toEqual([9]);
    });

    it('seeds from the event of the same repository without a lookup', async () => {
        const { send, fake } = setup({}, { installationId: 7 });

        fake.installations.set('octo/demo', 42);

        const event = githubEvent({ payload: { repository: { full_name: 'Octo/Demo' }, issue: { number: 7 } } });

        await send(APPROVAL, ADDRESS, githubTrigger(event));
        expect(fake.tokenInstallations).toEqual([42]);
        expect(fake.requests.some((r) => r.path.endsWith('/installation'))).toBe(false);
    });

    it('looks up the installation of another repository than the event one', async () => {
        const { send, fake } = setup();

        fake.installations.set('acme/api', 9);
        fake.issues.set('acme/api#3', { number: 3 });
        await send(APPROVAL, 'acme/api#3');
        expect(fake.tokenInstallations).toEqual([9]);
    });

    it('throws a github_request error when the lookup fails', async () => {
        const {
            send,
            fake,
            posts,
        } = setup({}, { installationId: 7 });

        fake.failNext('GET', '/repos/octo/demo/installation', 500);

        const error = await rejection(send(APPROVAL, ADDRESS, httpTrigger()));

        expect(error.code).toBe('github_request');
        expect(posts()).toEqual([]);
    });

    it('throws a configuration error without an installation, before any comment request', async () => {
        const { send, fake } = setup();

        await expect(send(APPROVAL, ADDRESS, httpTrigger())).rejects.toBeInstanceOf(InvalidAgentDefinitionError);
        await expect(send(APPROVAL, ADDRESS, httpTrigger())).rejects.toThrow('installationId');
        expect(fake.requests.filter((r) => !r.path.endsWith('/installation'))).toEqual([]);
    });
});
