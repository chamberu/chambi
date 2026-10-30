/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../../app/api/error.ts';
import { runListQuery } from '../../../../app/api/helpers.ts';
import { createApiClient } from '../../../../app/api/module.ts';
import { createFakeFetch, json } from '../../../utils/fetch.ts';

describe('createApiClient', () => {
    it('sends the bearer token and the JSON body', async () => {
        const { fetch, requests } = createFakeFetch([json({ runId: 'r1', status: 'queued' }, 202)]);
        const client = createApiClient({
            apiBase: '/api',
            token: async () => 'tok',
            fetch,
        });

        await client.approve('r1', {
            approvalId: 'a1',
            approved: false,
            reason: 'no',
        });
        expect(requests[0]).toMatchObject({ url: '/api/runs/r1/approve', method: 'POST' });
        expect(requests[0]!.headers.get('authorization')).toBe('Bearer tok');
        expect(requests[0]!.headers.get('content-type')).toBe('application/json');
        expect(JSON.parse(requests[0]!.body!)).toEqual({
            approvalId: 'a1',
            approved: false,
            reason: 'no',
        });
    });

    it('starts a run through the agent\'s http trigger', async () => {
        const { fetch, requests } = createFakeFetch([json({ runId: 'r9', deduplicated: false }, 202)]);
        const client = createApiClient({
            apiBase: '/api',
            token: async () => 'tok',
            fetch,
        });

        expect(await client.startRun('release notes', { payload: { tag: 'v1' } })).toEqual({ runId: 'r9', deduplicated: false });
        expect(requests[0]).toMatchObject({ url: '/api/agents/release%20notes/runs', method: 'POST' });
        expect(JSON.parse(requests[0]!.body!)).toEqual({ payload: { tag: 'v1' } });
    });

    it('sends no authorization without a token', async () => {
        const { fetch, requests } = createFakeFetch([json({ data: [] })]);
        const client = createApiClient({
            apiBase: '',
            token: async () => undefined,
            fetch,
        });

        expect(await client.listAgents()).toEqual({ data: [], issues: [] });
        expect(requests[0]!.headers.has('authorization')).toBe(false);
    });

    it('reads the agents and their load issues from GET /agents', async () => {
        const issue = {
            agent: 'triage',
            message: 'agent.ts: Unexpected token',
            at: '2026-10-22T08:00:00.000Z',
        };
        const { fetch } = createFakeFetch([json({ data: [], issues: [issue] })]);
        const client = createApiClient({
            apiBase: '',
            token: async () => 'tok',
            fetch,
        });

        expect(await client.listAgents()).toEqual({ data: [], issues: [issue] });
    });

    it('maps an error body to ApiError', async () => {
        const { fetch } = createFakeFetch([
            json({
                status: 409,
                code: 'invalid_run_state',
                message: 'moved on',
            }, 409),
            new Response('bad gateway', { status: 502 }),
        ]);
        const client = createApiClient({
            apiBase: '',
            token: async () => 't',
            fetch,
        });
        const error = await client.getRun('r1').catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({
            status: 409,
            code: 'invalid_run_state',
            message: 'moved on',
        });
        await expect(client.getRun('r1')).rejects.toMatchObject({ status: 502, code: 'http_502' });
    });

    it('calls onUnauthorized once on a 401 and retries after a refreshed token', async () => {
        let token = 'old';
        let refreshed = 0;
        let unauthorized = 0;
        const unauth = () => json({
            status: 401,
            code: 'unauthorized',
            message: 'no',
        }, 401);
        const { fetch, requests } = createFakeFetch([unauth(), json({
            id: 'u',
            kind: 'k',
            permissions: [],
        }), unauth(), unauth()]);
        const client = createApiClient({
            apiBase: '',
            token: async () => token,
            refresh: async () => {
                refreshed++;

                if (refreshed > 1) {
                    return false;
                }

                token = 'new';

                return true;
            },
            onUnauthorized: () => {
                unauthorized++;
            },
            fetch,
        });

        expect(await client.me()).toEqual({
            id: 'u',
            kind: 'k',
            permissions: [],
        });
        expect(requests.map((r) => r.headers.get('authorization'))).toEqual(['Bearer old', 'Bearer new']);
        expect(unauthorized).toBe(0);

        await expect(client.listSchedules()).rejects.toMatchObject({ status: 401 });
        expect(refreshed).toBe(2);
        expect(unauthorized).toBe(1);
        expect(requests).toHaveLength(3);
    });

    it('me with an explicit token neither refreshes nor signs out', async () => {
        let unauthorized = 0;
        const { fetch, requests } = createFakeFetch([json({
            status: 401,
            code: 'unauthorized',
            message: 'no',
        }, 401)]);
        const client = createApiClient({
            apiBase: '',
            token: async () => 'stored',
            refresh: async () => {
                throw new Error('not called');
            },
            onUnauthorized: () => {
                unauthorized++;
            },
            fetch,
        });

        await expect(client.me('pasted')).rejects.toMatchObject({ status: 401 });
        expect(requests[0]!.headers.get('authorization')).toBe('Bearer pasted');
        expect(unauthorized).toBe(0);
    });

    it('lists runs newest first with the filter', async () => {
        const page = {
            data: [],
            meta: {
                total: 0,
                limit: 25,
                offset: 50,
            },
        };
        const { fetch, requests } = createFakeFetch([json(page)]);
        const client = createApiClient({
            apiBase: '',
            token: async () => 't',
            fetch,
        });

        expect(await client.listRuns({
            agent: 'triage',
            status: ['waiting', 'running'],
            limit: 25,
            offset: 50,
        })).toEqual(page);
        expect(decodeURIComponent(requests[0]!.url)).toBe('/runs?filter[agent]=triage&filter[status]=waiting,running&page[limit]=25&page[offset]=50&sort=-createdAt');
    });

    it('builds the run list query with only the given parts', () => {
        expect(runListQuery({}).toString()).toBe('sort=-createdAt');
    });

    it('encodes path segments', async () => {
        const { fetch, requests } = createFakeFetch([
            json({ id: 'a/b', steps: [] }),
            json({ data: [] }),
            json({ data: [] }),
            new Response(null, { status: 202 }),
        ]);
        const client = createApiClient({
            apiBase: '',
            token: async () => 't',
            fetch,
        });

        await client.getRun('a/b');
        await client.listKv('a b', { limit: 10, offset: 20 });
        await client.listDocs('x', 'c/d', { limit: 5 });
        await client.cancelRun('?');
        expect(requests.map((r) => decodeURI(r.url))).toEqual([ // decodeURI keeps %2F and %3F
            '/runs/a%2Fb',
            '/agents/a b/state/kv?page[limit]=10&page[offset]=20',
            '/agents/x/state/collections/c%2Fd?page[limit]=5',
            '/runs/%3F/cancel',
        ]);
    });

    it('opens the run stream with the last event id', async () => {
        const controller = new AbortController();
        const { fetch, requests } = createFakeFetch([new Response('', { status: 200 })]);
        const client = createApiClient({
            apiBase: '/api',
            token: async () => 't',
            fetch,
        });

        await client.streamRun('r1', { lastEventId: 3, signal: controller.signal });
        expect(requests[0]).toMatchObject({ url: '/api/runs/r1/stream' });
        expect(requests[0]!.headers.get('last-event-id')).toBe('3');
        expect(requests[0]!.headers.get('accept')).toBe('text/event-stream');
        expect(requests[0]!.signal).toBe(controller.signal);
    });
});
