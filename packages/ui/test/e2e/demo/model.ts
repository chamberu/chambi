/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type {
    LanguageModelV4Prompt,
    LanguageModelV4StreamPart,
    LanguageModelV4Usage,
} from '@ai-sdk/provider';
import { simulateReadableStream } from 'ai';
import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

const USAGE: LanguageModelV4Usage = {
    inputTokens: {
        total: 1200,
        noCache: 1200,
        cacheRead: undefined,
        cacheWrite: undefined,
    },
    outputTokens: {
        total: 80,
        text: 80,
        reasoning: undefined,
    },
};

function hasToolResult(prompt: LanguageModelV4Prompt): boolean {
    return prompt.some((message) => message.role === 'tool');
}

function words(id: string, text: string): LanguageModelV4StreamPart[] {
    const parts: LanguageModelV4StreamPart[] = [{ type: 'text-start', id }];

    for (const word of text.split(/(?<= )/)) {
        parts.push({
            type: 'text-delta',
            id,
            delta: word,
        });
    }

    parts.push({ type: 'text-end', id });

    return parts;
}

/**
 * A stateless demo model, decided by the prompt: without a tool result it
 * explains itself and calls `toolName` (default `deploy` with
 * `{ env: 'prod' }`); with one it streams the answer word by word. A short
 * delay per chunk keeps the run `running` long enough to watch.
 */
export function createDemoModel(chunkDelayInMs = 120, toolName = 'deploy', input: unknown = { env: 'prod' }): LanguageModel {
    return new MockLanguageModelV4({
        doStream: async ({ prompt }) => {
            const answered = hasToolResult(prompt);
            const chunks: LanguageModelV4StreamPart[] = [{ type: 'stream-start', warnings: [] }];

            if (answered) {
                chunks.push(...words('t0', toolName === 'deploy' ?
                    'The deploy step answered. deployed prod, all checks green.' :
                    `The ${toolName} step answered.`));
            } else {
                chunks.push(...words('t0', toolName === 'deploy' ?
                    'Deploying the payload environment needs the deploy tool. ' :
                    `This needs the ${toolName} tool. `));
                chunks.push({
                    type: 'tool-call',
                    toolCallId: `call-${Date.now()}`,
                    toolName,
                    input: JSON.stringify(input),
                });
            }

            chunks.push({
                type: 'finish',
                finishReason: { unified: answered ? 'stop' : 'tool-calls', raw: undefined },
                usage: USAGE,
            });

            return { stream: simulateReadableStream({ chunks, chunkDelayInMs }) };
        },
    });
}
