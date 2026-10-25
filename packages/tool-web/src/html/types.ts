/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock } from '@chamvi/core';

export type ConvertedPage = {
    title?: string;
    content: string;
};

export type ConvertFormat = 'markdown' | 'text';

/** The conversion worker's input (its workerData). */
export type ConvertJob = {
    html: string;
    baseUrl: string;
    format: ConvertFormat;
};

/** The conversion worker's one message. */
export type ConvertReply = { page: ConvertedPage } | { error: string };

export type ConvertOptions = ConvertJob & {
    signal: AbortSignal;
    /** The conversion fails after this long on the clock. */
    timeoutMs: number;
    clock: IClock;
};
