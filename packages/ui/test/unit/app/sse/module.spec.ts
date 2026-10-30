/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import type { ApiError } from '../../../../app/api/error.ts';
import { createApiClient } from '../../../../app/api/module.ts';
import { RECONNECT_DELAYS_MS } from '../../../../app/sse/constants.ts';
import { parseEventStream } from '../../../../app/sse/helpers.ts';
import { openRunStream } from '../../../../app/sse/module.ts';
import type { RunStreamEvent, SseEvent } from '../../../../app/sse/types.ts';
import {
    createFakeFetch,
    json,
    sse,
} from '../../../utils/fetch.ts';
import type { FakeAnswer } from '../../../utils/fetch.ts';

async function collect(chunks: string[]): Promise<SseEvent[]> {
    const events: SseEvent[] = await Array.fromAsync(parseEventStream(sse(chunks).body!));

    return events;
}

const run = (status: string) => `event: run.updated\ndata: ${JSON.stringify({ id: 'r1', status })}\n\n`;
const step = (index: number) => `event: step.appended\nid: ${index}\ndata: ${JSON.stringify({
    runId: 'r1',
    index,
    type: 'llm',
})}\n\n`;

function setup(answers: FakeAnswer[]) {
    const { fetch, requests } = createFakeFetch(answers);
    const client = createApiClient({
        apiBase: '',
        token: async () => 't',
        fetch,
    });
    const events: RunStreamEvent[] = [];
    const errors: ApiError[] = [];
    const delays: number[] = [];
    let settled = 0;
    const { promise: finished, resolve: done } = Promise.withResolvers<void>();
    const stream = openRunStream({
        client,
        runId: 'r1',
        onEvent: (event) => {
            events.push(event);
        },
        onSettled: () => {
            settled++; done();
        },
        onError: (error) => {
            errors.push(error); done();
        },
        sleep: async (ms) => {
            delays.push(ms);

            if (answers.length === 0) {
                done();
            }
        },
    });

    return {
        stream,
        requests,
        events,
        errors,
        delays,
        finished,
        settled: () => settled,
    };
}

describe('parseEventStream', () => {
    it('parses events split across chunks', async () => {
        expect(await collect(['event: run.upd', 'ated\nda', 'ta: {"a":1}\n', '\nevent: ping\ndata:\n\n'])).toEqual([
            { event: 'run.updated', data: '{"a":1}' },
            { event: 'ping', data: '' },
        ]);
    });

    it('parses CRLF and multi-line data, and ignores comments', async () => {
        expect(await collect([': keep-alive\r\n\r\nevent: x\r\nid: 7\r\ndata: one\r\ndata: two\r\n\r\ndata: plain\n\n'])).toEqual([
            {
                event: 'x',
                data: 'one\ntwo',
                id: '7',
            },
            { event: 'message', data: 'plain' },
        ]);
    });

    it('decodes UTF-8 split inside a character', async () => {
        const bytes = new TextEncoder().encode('data: é\n\n');
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(bytes.slice(0, 7));
                controller.enqueue(bytes.slice(7));
                controller.close();
            },
        });
        const events: SseEvent[] = await Array.fromAsync(parseEventStream(body));

        expect(events).toEqual([{ event: 'message', data: 'é' }]);
    });
});

describe('openRunStream', () => {
    it('emits run, step and delta events', async () => {
        const s = setup([sse([
            run('running'),
            step(0),
            'event: delta\ndata: {"step":1,"kind":"text","text":"hi"}\n\n',
            'event: ping\ndata:\n\n',
            run('completed'),
        ])]);

        await s.finished;
        expect(s.events).toEqual([
            { type: 'run', run: { id: 'r1', status: 'running' } },
            {
                type: 'step',
                step: {
                    runId: 'r1',
                    index: 0,
                    type: 'llm',
                },
            },
            {
                type: 'delta',
                step: 1,
                kind: 'text',
                text: 'hi',
            },
            { type: 'run', run: { id: 'r1', status: 'completed' } },
        ]);
        expect(s.settled()).toBe(1);
    });

    it('starts after the given step', async () => {
        const { fetch, requests } = createFakeFetch([sse([run('completed')])]);
        const client = createApiClient({
            apiBase: '',
            token: async () => 't',
            fetch,
        });

        await new Promise<void>((resolve) => {
            openRunStream({
                client,
                runId: 'r1',
                after: 4,
                onEvent: () => {},
                onSettled: resolve,
            });
        });
        expect(requests[0]!.headers.get('last-event-id')).toBe('4');
    });

    it('reconnects after a drop with the last step id', async () => {
        const s = setup([
            sse([run('running'), step(2), step(3)]),
            sse([step(4), run('completed')]),
        ]);

        await s.finished;
        expect(s.requests).toHaveLength(2);
        expect(s.requests[0]!.headers.has('last-event-id')).toBe(false);
        expect(s.requests[1]!.headers.get('last-event-id')).toBe('3');
        expect(s.delays).toEqual([RECONNECT_DELAYS_MS[0]]);
        expect(s.settled()).toBe(1);
    });

    it('backs off on repeated failures, the last delay repeating', async () => {
        const s = setup([
            () => {
                throw new TypeError('network');
            },
            new Response('', { status: 502 }),
            sse([]),
            sse([]),
            sse([]),
        ]);

        await s.finished;
        expect(s.delays).toEqual([1000, 2000, 5000, 10_000, 10_000]);
        s.stream.close();
    });

    it('resets the backoff once an event arrived', async () => {
        const s = setup([sse([]), sse([]), sse([run('running')]), sse([])]);

        await s.finished;
        expect(s.delays).toEqual([1000, 2000, 1000, 2000]);
        s.stream.close();
    });

    it('honours Retry-After on 503', async () => {
        const s = setup([
            json({
                status: 503,
                code: 'service_unavailable',
                message: 'busy',
            }, 503, { 'retry-after': '7' }),
            sse([run('completed')]),
        ]);

        await s.finished;
        expect(s.delays).toEqual([7000]);
        expect(s.settled()).toBe(1);
    });

    it('honours Retry-After on 429', async () => {
        const s = setup([
            json({
                status: 429,
                code: 'too_many_requests',
                message: 'slow down',
            }, 429, { 'retry-after': '30' }),
            sse([run('completed')]),
        ]);

        await s.finished;
        expect(s.delays).toEqual([30000]);
        expect(s.errors).toEqual([]);
        expect(s.settled()).toBe(1);
    });

    it('stops after a settled run', async () => {
        const s = setup([sse([run('failed')])]);

        await s.finished;
        expect(s.requests).toHaveLength(1);
        expect(s.delays).toEqual([]);
    });

    it('keeps following a waiting run that the stream ended for', async () => {
        const s = setup([sse([run('waiting')]), sse([run('cancelled')])]);

        await s.finished;
        expect(s.requests).toHaveLength(2);
        expect(s.settled()).toBe(1);
    });

    it('stops on 404 and reports it', async () => {
        const s = setup([json({
            status: 404,
            code: 'run_not_found',
            message: 'gone',
        }, 404)]);

        await s.finished;
        expect(s.errors).toHaveLength(1);
        expect(s.errors[0]).toMatchObject({ status: 404, code: 'run_not_found' });
        expect(s.delays).toEqual([]);
    });

    it('close aborts the open request', async () => {
        let seen: AbortSignal | null | undefined;
        const { fetch } = createFakeFetch([(request) => {
            seen = request.signal;

            return new Promise<Response>((_resolve, reject) => {
                request.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            });
        }]);
        const client = createApiClient({
            apiBase: '',
            token: async () => 't',
            fetch,
        });
        const errors: unknown[] = [];
        const stream = openRunStream({
            client,
            runId: 'r1',
            onEvent: () => {},
            onError: (e) => {
                errors.push(e);
            },
            sleep: async () => {
                throw new Error('no reconnect after close');
            },
        });

        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });
        stream.close();
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });
        expect(seen?.aborted).toBe(true);
        expect(errors).toEqual([]);
    });
});
