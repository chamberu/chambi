/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

export type SseEvent = {
    event: string;
    id?: string;
    data: string;
};

/** Parses complete SSE messages (separated by a blank line); a trailing partial message is ignored. */
export function parseSse(text: string): SseEvent[] {
    const events: SseEvent[] = [];
    const blocks = text.split('\n\n');

    blocks.pop();

    for (const block of blocks) {
        const message: SseEvent = { event: 'message', data: '' };
        const data: string[] = [];

        for (const line of block.split('\n')) {
            const index = line.indexOf(':');

            if (index === 0) {
                continue;
            }

            const field = index === -1 ? line : line.slice(0, index);
            const value = index === -1 ? '' : line.slice(index + 1).replace(/^ /, '');

            if (field === 'event') {
                message.event = value;
            } else if (field === 'id') {
                message.id = value;
            } else if (field === 'data') {
                data.push(value);
            }
        }

        message.data = data.join('\n');
        events.push(message);
    }

    return events;
}

/** Reads an SSE response incrementally. */
export class SseReader {
    readonly reader: ReadableStreamDefaultReader<Uint8Array>;

    protected text = '';

    protected consumed = 0;

    done = false;

    protected readonly decoder = new TextDecoder();

    constructor(response: Response) {
        if (!response.body) {
            throw new Error('the response has no body');
        }

        this.reader = response.body.getReader();
    }

    protected pending(): SseEvent[] {
        return parseSse(this.text).slice(this.consumed);
    }

    /** The next `count` events; fewer when the body ends first. */
    async next(count: number): Promise<SseEvent[]> {
        while (!this.done && this.pending().length < count) {
            const { done, value } = await this.reader.read();

            if (done) {
                this.done = true;
            } else {
                this.text += this.decoder.decode(value, { stream: true });
            }
        }

        const events = this.pending().slice(0, count);

        this.consumed += events.length;

        return events;
    }

    /** Every event until the body ends. */
    async rest(): Promise<SseEvent[]> {
        return this.next(Infinity);
    }
}

/** Reads `count` events (or all until the body ends, without `count`). */
export function readEvents(response: Response, count = Infinity): Promise<SseEvent[]> {
    return new SseReader(response).next(count);
}
