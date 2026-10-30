/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import type { WebLookup } from './types.ts';

/** `dns.lookup` with every address; the signal ends the wait, not the lookup. */
export const systemLookup: WebLookup = async (hostname, signal) => {
    signal.throwIfAborted();

    const answers = await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
        const onAbort = () => reject(signal.reason);

        signal.addEventListener('abort', onAbort, { once: true });
        dnsLookup(hostname, { all: true, verbatim: true })
            .then(resolve, reject)
            .finally(() => signal.removeEventListener('abort', onAbort));
    });

    return answers.map((answer) => ({ address: answer.address, family: answer.family }));
};
