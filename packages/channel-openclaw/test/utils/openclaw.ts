/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock } from '@chamvi/core';
import type { OpenclawHookBody } from '@chamvi/channel-openclaw';

export type FakeOpenclawRequest = {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
};

export type FakeOpenclaw = {
    fetch: typeof globalThis.fetch;
    /** Every request, in order (also refused, lost and hung ones). */
    requests: FakeOpenclawRequest[];
    /** The hook bodies OpenClaw admitted as a new agent run. */
    dispatched: OpenclawHookBody[];
    /** The next request answers `status` with `body` (`$MESSAGE` replaced by the request's message), once. */
    failNext(status: number, headers?: Record<string, string>, body?: string): void;
    /** The next request is admitted, then the fetch rejects as a lost response would. */
    loseNextResponse(): void;
    /** The next request never answers; it rejects with the signal's reason on abort. */
    hangNext(): void;
};

type Replay = {
    body: string;
    runId: string;
    expiresAt: number
};

type Next =    | {
    kind: 'fail';
    status: number;
    headers: Record<string, string>;
    body: string
} |
    { kind: 'lose' } |
    { kind: 'hang' };

const IDEMPOTENCY_KEY_MAX_LENGTH = 256;
const REPLAY_TTL_MS = 5 * 60 * 1000;

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * An in-process OpenClaw gateway serving `POST <hooksPath>/agent` as its docs
 * describe it: bearer hooks token, `message` required, `channel` and `to`
 * both concrete (`last` refused), replay of a key (at most 256 characters)
 * for the same body for 5 minutes, a new run for the same key with another
 * body. Never touches the network.
 */
export function createFakeOpenclaw(input: {
    token: string;
    hooksPath?: string;
    clock?: IClock
}): FakeOpenclaw {
    const hooksPath = input.hooksPath ?? '/hooks';
    const now = () => input.clock?.now().getTime() ?? 0;
    const replays = new Map<string, Replay>();
    const queue: Next[] = [];
    let runs = 0;

    const fake: FakeOpenclaw = {
        fetch: undefined as unknown as typeof globalThis.fetch,
        requests: [],
        dispatched: [],
        failNext(status, headers = {}, body = '{"error":"injected"}') {
            queue.push({
                kind: 'fail',
                status,
                headers,
                body,
            });
        },
        loseNextResponse() {
            queue.push({ kind: 'lose' });
        },
        hangNext() {
            queue.push({ kind: 'hang' });
        },
    };

    function admit(request: FakeOpenclawRequest, text: string): Response {
        const url = new URL(request.url);

        if (url.pathname !== `${hooksPath}/agent`) {
            return json(404, { error: 'Not Found' });
        }

        if (request.method !== 'POST') {
            return json(405, { error: 'Method Not Allowed' });
        }

        if (request.headers.authorization !== `Bearer ${input.token}`) {
            return json(401, { error: 'Unauthorized' });
        }

        const body = request.body as Partial<OpenclawHookBody> | undefined;

        if (typeof body?.message !== 'string' || body.message.trim().length === 0) {
            return json(400, { error: 'message required' });
        }

        const { channel, to } = body;

        if (!channel || !to || channel === 'last') {
            return json(400, { error: 'invalid delivery' });
        }

        const key = request.headers['idempotency-key']?.trim();
        const usable = key && key.length <= IDEMPOTENCY_KEY_MAX_LENGTH ? key : undefined;

        if (usable) {
            const replay = replays.get(usable);

            if (replay && replay.expiresAt > now() && replay.body === text) {
                return json(200, { ok: true, runId: replay.runId });
            }
        }

        const runId = `oc-run-${++runs}`;

        fake.dispatched.push(body as OpenclawHookBody);

        if (usable) {
            replays.set(usable, {
                body: text,
                runId,
                expiresAt: now() + REPLAY_TTL_MS,
            });
        }

        return json(200, { ok: true, runId });
    }

    fake.fetch = async (resource, init) => {
        const request = new Request(resource as RequestInfo, init);
        const { signal } = request;

        if (signal.aborted) {
            throw signal.reason;
        }

        const text = await request.text();
        let body: unknown;

        try {
            body = text ? JSON.parse(text) : undefined;
        } catch {
            body = undefined;
        }

        const recorded: FakeOpenclawRequest = {
            url: request.url,
            method: request.method,
            headers: Object.fromEntries(request.headers),
            body,
        };

        fake.requests.push(recorded);

        const next = queue.shift();

        if (next?.kind === 'hang') {
            return new Promise<Response>((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            });
        }

        if (next?.kind === 'fail') {
            const message = (body as { message?: string } | undefined)?.message ?? '';

            return new Response(next.body.replaceAll('$MESSAGE', message), {
                status: next.status,
                headers: next.headers,
            });
        }

        const response = admit(recorded, text);

        if (next?.kind === 'lose') {
            throw new TypeError('fetch failed', { cause: new Error('other side closed') });
        }

        return response;
    };

    return fake;
}
