/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';
import { ApiError } from './error.ts';
import {
    pageQuery,
    path,
    runListQuery,
    toApiError,
    withQuery,
} from './helpers.ts';
import type {
    AgentIssueWire,
    AgentWire,
    ApiClientOptions,
    DocEntry,
    IApiClient,
    KvEntry,
    MeWire,
    RunDetail,
    RunPage,
    ScheduleWire,
    StartRunResult,
} from './types.ts';

type RequestOptions = {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    /** A fixed token: no refresh, no onUnauthorized (a pasted token being checked). */
    token?: string;
};

function dataOf<T>(body: unknown): T[] {
    return isObject(body) && Array.isArray(body.data) ? body.data as T[] : [];
}

/**
 * The chamvi REST API from the browser: bearer token per request, JSON in
 * and out, every non-2xx answer an `ApiError`. A 401 asks `refresh` once
 * and retries when it answers `true`; a 401 that stands calls
 * `onUnauthorized`.
 */
export function createApiClient(options: ApiClientOptions): IApiClient {
    const doFetch = options.fetch ?? ((input, init) => fetch(input, init));

    async function send(target: string, init: RequestOptions, retried = false): Promise<Response> {
        const headers = new Headers(init.headers);

        if (!headers.has('accept')) {
            headers.set('accept', 'application/json');
        }

        const token = init.token ?? await options.token();

        if (token) {
            headers.set('authorization', `Bearer ${token}`);
        }

        let body: string | undefined;

        if (init.body !== undefined) {
            headers.set('content-type', 'application/json');
            body = JSON.stringify(init.body);
        }

        const response = await doFetch(`${options.apiBase}${target}`, {
            method: init.method ?? 'GET',
            headers,
            body,
            signal: init.signal,
        });

        if (response.ok) {
            return response;
        }

        if (response.status === 401 && init.token === undefined) {
            if (!retried && options.refresh && await options.refresh()) {
                return send(target, init, true);
            }

            const error = await toApiError(response);

            options.onUnauthorized?.();

            throw error;
        }

        throw await toApiError(response);
    }

    async function request<T>(target: string, init: RequestOptions = {}): Promise<T> {
        const response = await send(target, init);
        const text = await response.text();

        if (!text) {
            return undefined as T;
        }

        try {
            return JSON.parse(text) as T;
        } catch {
            throw new ApiError(response.status, 'invalid_response', 'The API answered no JSON.');
        }
    }

    return {
        me: (token) => request<MeWire>('/me', token === undefined ? {} : { token }),
        listAgents: async () => {
            const body = await request('/agents');

            return {
                data: dataOf<AgentWire>(body),
                issues: isObject(body) && Array.isArray(body.issues) ? body.issues as AgentIssueWire[] : [],
            };
        },
        listSchedules: async () => dataOf<ScheduleWire>(await request('/schedules')),
        listRuns: (filter) => request<RunPage>(withQuery('/runs', runListQuery(filter))),
        getRun: (id) => request<RunDetail>(path('runs', id)),
        cancelRun: async (id) => {
            await request(`${path('runs', id)}/cancel`, { method: 'POST' });
        },
        approve: async (id, body) => {
            await request(`${path('runs', id)}/approve`, { method: 'POST', body });
        },
        listKv: async (agent, page) => dataOf<KvEntry>(await request(withQuery(`${path('agents', agent)}/state/kv`, pageQuery(new URLSearchParams(), page)))),
        listDocs: async (agent, collection, page) => dataOf<DocEntry>(await request(withQuery(
            `${path('agents', agent)}/state/collections${path(collection)}`,
            pageQuery(new URLSearchParams(), page),
        ))),
        startRun: (agent, body) => request<StartRunResult>(`${path('agents', agent)}/runs`, { method: 'POST', body }),
        streamRun: (id, init) => send(`${path('runs', id)}/stream`, {
            headers: {
                accept: 'text/event-stream',
                ...(init.lastEventId === undefined ? {} : { 'last-event-id': String(init.lastEventId) }),
            },
            signal: init.signal,
        }),
    };
}
