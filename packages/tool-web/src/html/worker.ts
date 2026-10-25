/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/**
 * The conversion worker (its own build entry, dist/html-worker.mjs): converts
 * the page of its workerData and posts one ConvertReply. It imports nothing
 * but node:worker_threads and the converter, so it also runs from source.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { htmlToMarkdown, htmlToText } from './module.ts';
import type { ConvertJob, ConvertReply } from './types.ts';

const job = workerData as ConvertJob;
let reply: ConvertReply;
try {
    reply = { page: job.format === 'markdown' ? htmlToMarkdown(job.html, job.baseUrl) : htmlToText(job.html) };
} catch (error) {
    reply = { error: error instanceof Error ? error.message : String(error) };
}
parentPort?.postMessage(reply);
