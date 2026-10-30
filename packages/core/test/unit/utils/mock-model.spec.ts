/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { generateText, streamText } from 'ai';
import { describe, expect, it } from 'vitest';
import { mockModel } from '../../utils/mock-model.ts';

describe('mockModel', () => {
    it('replays scripted turns with usage, parallel tool calls and mixed parts', async () => {
        const model = mockModel([
            {
                parts: [
                    { type: 'text', text: 'thinking' },
                    {
                        type: 'tool-call',
                        toolName: 'a',
                        input: { q: 1 },
                    },
                    {
                        type: 'tool-call',
                        toolName: 'b',
                        input: {},
                    },
                ],
                usage: { inputTokens: 3, outputTokens: 4 },
            },
            { parts: [{ type: 'text', text: 'done' }] },
        ]);
        const first = await generateText({ model, prompt: 'hi' });

        expect(first.toolCalls.map((c) => c.toolName)).toEqual(['a', 'b']);
        expect(first.text).toBe('thinking');
        expect(first.usage.inputTokens).toBe(3);

        // the counter is shared between generate and stream
        const second = streamText({ model, prompt: 'hi' });

        expect(await second.text).toBe('done');
    });

    it('throws when the script is exhausted', async () => {
        const model = mockModel([{ parts: [{ type: 'text', text: 'only' }] }]);

        await generateText({ model, prompt: 'hi' });
        await expect(generateText({
            model,
            prompt: 'hi',
            maxRetries: 0,
        })).rejects.toThrow('mock script exhausted');
    });
});
