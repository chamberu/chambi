/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { streamEnded } from '../../../src/transport/helpers.ts';

function failWith(code: string): Error {
    return Object.assign(new Error(`read ${code}`), { code });
}

describe('streamEnded', () => {
    it.each(['ECONNRESET', 'EPIPE'])('resolves when the daemon closes the connection (%s): the exit code comes from inspect', async (code) => {
        const stream = new PassThrough();
        const ended = streamEnded(stream, new AbortController().signal);
        stream.emit('error', failWith(code));
        await expect(ended).resolves.toBeUndefined();
    });

    it('rejects on any other stream error', async () => {
        const stream = new PassThrough();
        const ended = streamEnded(stream, new AbortController().signal);
        stream.emit('error', failWith('EPROTO'));
        await expect(ended).rejects.toThrow('read EPROTO');
    });
});
