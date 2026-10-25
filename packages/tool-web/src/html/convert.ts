/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { Worker } from 'node:worker_threads';
import { requestError } from '../request/asserts.ts';
import { isConvertReply, nestingDepth } from './asserts.ts';
import { CONVERT_MAX_HEAP_MB, HTML_MAX_DEPTH } from './constants.ts';
import type { ConvertOptions, ConvertedPage } from './types.ts';

/**
 * The worker script: next to the sources (run with type stripping) or, once
 * built, the `html-worker` entry next to the chunk holding this code.
 */
const WORKER_URL = import.meta.url.endsWith('.ts') ?
    new URL('./worker.ts', import.meta.url) :
    new URL('./html-worker.mjs', import.meta.url);

/**
 * An HTML page as markdown or text, converted in a worker of its own so the
 * conversion (super-linear in size and nesting) never blocks the caller's
 * event loop. A page nested deeper than HTML_MAX_DEPTH is refused before any
 * parse; the worker is terminated after `timeoutMs` on the clock (a
 * web_request error), on an abort of `signal` (its reason) and once it
 * answered.
 */
export async function convertHtml(options: ConvertOptions): Promise<ConvertedPage> {
    const { signal } = options;
    signal.throwIfAborted();
    if (nestingDepth(options.html) > HTML_MAX_DEPTH) {
        throw requestError(`${options.baseUrl} nests elements deeper than ${HTML_MAX_DEPTH} levels; fetch it with format raw.`);
    }

    const worker = new Worker(WORKER_URL, {
        workerData: {
            html: options.html,
            baseUrl: options.baseUrl,
            format: options.format,
        },
        resourceLimits: { maxOldGenerationSizeMb: CONVERT_MAX_HEAP_MB },
    });
    let onAbort: (() => void) | undefined;
    let timer: { clear(): void } | undefined;
    try {
        return await new Promise<ConvertedPage>((resolve, reject) => {
            const failed = (message: string) => reject(requestError(`Could not convert ${options.baseUrl}: ${message}`));
            // node posts its own messages from a worker too (node --watch: one per import)
            worker.on('message', (message: unknown) => {
                if (!isConvertReply(message)) return;
                if ('page' in message) resolve(message.page);
                else failed(message.error || 'the converter failed without a message.');
            });
            worker.on('error', (error) => failed(error.message || error.name || 'the converter failed.'));
            worker.once('exit', (code) => failed(`the converter exited with code ${code}.`));
            timer = options.clock.setTimeout(() => {
                reject(requestError(`Converting ${options.baseUrl} took longer than ${options.timeoutMs}ms.`));
            }, options.timeoutMs);
            onAbort = () => reject(signal.reason);
            signal.addEventListener('abort', onAbort, { once: true });
        });
    } finally {
        timer?.clear();
        if (onAbort) signal.removeEventListener('abort', onAbort);
        worker.terminate().catch(() => undefined);
    }
}
