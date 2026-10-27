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
import { ChamviError, InvalidAgentDefinitionError, ValidationError } from '@chamvi/core';
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

function setup(patch: Partial<GithubChannelOptions> = {}, app: Partial<GithubAppOptions> = {}) {
    const fixture = createCommentFixture(app);
    const channel = githubChannel({
        app: fixture.gh,
        mention: 'owner',
        clock: fixture.clock,
        ...patch,
    });
    const send = (
        message: ChannelMessage = APPROVAL,
        address = ADDRESS,
        trigger: TriggerEnvelope = githubTrigger(),
        signal: AbortSignal = new AbortController().signal,
    ) => channel.out!(message, address, { signal, trigger });
    const posts = () => fixture.fake.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/comments'));
    return {
        ...fixture,
        channel,
        send,
        posts,
    };
}

async function rejection(promise: Promise<unknown>): Promise<ChamviError> {
    const error = await promise.then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(ChamviError);
    return error as ChamviError;
}

describe('github channel out', () => {
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
            body: `posted earlier ${marker}`,
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
        fake.route('GET', '/repos/:owner/:repo/issues/:number/comments', () => new Promise(() => {}));
        const pending = send();
        await vi.waitFor(() => expect(fake.requests.some((r) => r.path.endsWith('/comments'))).toBe(true));
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
        fake.route('GET', '/repos/:owner/:repo/issues/:number/comments', () => new Promise(() => {}));
        const controller = new AbortController();
        const pending = send(APPROVAL, ADDRESS, githubTrigger(), controller.signal);
        await vi.waitFor(() => expect(fake.requests.some((r) => r.path.endsWith('/comments'))).toBe(true));
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
