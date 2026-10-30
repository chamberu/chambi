/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** `event`, `data` (lines joined by \\n) and `id` of one block, or nothing for a comment-only block. */
function toEvent(lines: string[]): {
    event: string;
    data: string;
    id?: string
} | undefined {
    let event = 'message';
    let id: string | undefined;
    const data: string[] = [];
    let seen = false;

    for (const line of lines) {
        if (line.startsWith(':')) {
            continue;
        }

        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);

        if (value.startsWith(' ')) {
            value = value.slice(1);
        }

        if (field === 'event') {
            event = value;
            seen = true;
        } else if (field === 'data') {
            data.push(value);
            seen = true;
        } else if (field === 'id') {
            id = value;
            seen = true;
        }
    }

    if (!seen) {
        return undefined;
    }

    return id === undefined ? { event, data: data.join('\n') } : {
        event,
        data: data.join('\n'),
        id,
    };
}

/** The events of a `text/event-stream` body (UTF-8, \\n or \\r\\n lines, comments skipped). */
export async function* parseEventStream(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lines: string[] = [];

    try {
        while (true) {
            const { done, value } = await reader.read();

            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });

            let index = buffer.search(/\r?\n/);

            while (index !== -1) {
                const line = buffer.slice(0, index);

                buffer = buffer.slice(buffer[index] === '\r' ? index + 2 : index + 1);

                if (line === '') {
                    const event = toEvent(lines);

                    lines = [];

                    if (event) {
                        yield event;
                    }
                } else {
                    lines.push(line);
                }

                index = buffer.search(/\r?\n/);
            }
        }
    } finally {
        reader.releaseLock();
    }
}

/** A wait that resolves at once when the signal aborts. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal.aborted) {
            resolve();

            return;
        }

        const timer = setTimeout(done, ms);
        function done(): void {
            clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
        }
        signal.addEventListener('abort', done);
    });
}
