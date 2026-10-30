/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

export type RecordedRequest = {
    url: string;
    method: string;
    headers: Headers;
    body?: string;
    signal?: AbortSignal | null;
};

export type FakeAnswer = Response | ((request: RecordedRequest) => Response | Promise<Response>);

/** A fetch answering the queued responses in order and recording every request. */
export function createFakeFetch(answers: FakeAnswer[]) {
    const requests: RecordedRequest[] = [];
    const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
        const request: RecordedRequest = {
            url: String(input),
            method: init.method ?? 'GET',
            headers: new Headers(init.headers),
            body: typeof init.body === 'string' ? init.body : undefined,
            signal: init.signal,
        };

        requests.push(request);

        const answer = answers.shift();

        if (!answer) {
            throw new Error(`no answer queued for ${request.method} ${request.url}`);
        }

        return typeof answer === 'function' ? answer(request) : answer;
    };

    return { fetch: fetch as typeof globalThis.fetch, requests };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** A text/event-stream body delivering `chunks` and then ending. */
export function sse(chunks: string[], status = 200): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(encoder.encode(chunk));
            }

            controller.close();
        },
    });

    return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}
