/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { ArtifactNotFoundError, artifactFilePart } from '@chamvi/core';
import { hydrateMessages } from '../../../src/artifact/helpers.ts';
import { storeArtifact } from '../../../src/artifact/module.ts';
import { createMemoryStores } from '../../../src/store/index.ts';

const PNG = new Uint8Array([137, 80, 78, 71]);

function toolMessage(id: string): ModelMessage {
    return {
        role: 'tool',
        content: [{
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'read_file',
            output: {
                type: 'content',
                value: [
                    { type: 'text', text: 'an image' },
                    artifactFilePart({ id, mediaType: 'image/png' }),
                ],
            },
        }],
    };
}

describe('hydrateMessages', () => {
    it('gives a tool result file item the bytes of its artifact, leaving the input alone', async () => {
        const store = createMemoryStores();
        const artifact = await storeArtifact(store.artifacts, { id: 'r1', agent: 'a' }, { mediaType: 'image/png', data: PNG }, new Date(0));
        const messages = [toolMessage(artifact.id)];
        const before = JSON.stringify(messages);

        const [message] = await hydrateMessages(messages, store.artifacts);
        const { output } = ((message!.content as Array<{ output: { value: Array<Record<string, unknown>> } }>)[0]!);
        expect(output.value[0]).toEqual({ type: 'text', text: 'an image' });
        expect(output.value[1]).toEqual({
            type: 'file',
            mediaType: 'image/png',
            data: { type: 'data', data: PNG },
        });
        expect(JSON.stringify(messages)).toBe(before);
    });

    it('returns messages without a marker as they are', async () => {
        const messages: ModelMessage[] = [{ role: 'user', content: 'hi' }];
        await expect(hydrateMessages(messages, createMemoryStores().artifacts)).resolves.toBe(messages);
    });

    it('throws ArtifactNotFoundError for a tool result marker whose artifact is gone', async () => {
        await expect(hydrateMessages([toolMessage('gone')], createMemoryStores().artifacts)).rejects.toThrow(ArtifactNotFoundError);
    });
});
