/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type {
    LanguageModelV4Content,
    LanguageModelV4FinishReason,
    LanguageModelV4StreamPart,
    LanguageModelV4ToolCall,
    LanguageModelV4Usage,
} from '@ai-sdk/provider';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

export type MockPart =    | { type: 'text'; text: string } |
    {
        type: 'tool-call';
        toolName: string;
        input: unknown;
        toolCallId?: string;
    };

export type MockResponse = {
    /** One model turn: any mix of text and (parallel) tool calls. */
    parts: MockPart[];
    usage?: { inputTokens: number; outputTokens: number };
};

const DEFAULT_USAGE = { inputTokens: 1, outputTokens: 1 };

function usageOf(r: MockResponse): LanguageModelV4Usage {
    const u = r.usage ?? DEFAULT_USAGE;

    return {
        inputTokens: {
            total: u.inputTokens,
            noCache: u.inputTokens,
            cacheRead: undefined,
            cacheWrite: undefined,
        },
        outputTokens: {
            total: u.outputTokens,
            text: u.outputTokens,
            reasoning: undefined,
        },
    };
}

function contentOf(r: MockResponse, turn: number): Array<LanguageModelV4Content> {
    return r.parts.map((p, i): LanguageModelV4Content => {
        if (p.type === 'text') {
            return { type: 'text', text: p.text };
        }

        return {
            type: 'tool-call',
            toolCallId: p.toolCallId ?? `call-${turn}-${i}`,
            toolName: p.toolName,
            input: JSON.stringify(p.input),
        };
    });
}

function finishOf(r: MockResponse): LanguageModelV4FinishReason {
    const hasToolCall = r.parts.some((p) => p.type === 'tool-call');

    return { unified: hasToolCall ? 'tool-calls' : 'stop', raw: undefined };
}

/**
 * Mock language model answering turn N with responses[N], for generate and
 * stream alike (one shared counter). Throws "mock script exhausted" past the end.
 */
export function mockModel(responses: MockResponse[]) {
    let turn = 0;
    const next = () => {
        const index = turn++;
        const response = responses[index];

        if (!response) {
            throw new Error('mock script exhausted');
        }

        return { response, index };
    };

    return new MockLanguageModelV4({
        doGenerate: async () => {
            const { response, index } = next();

            return {
                content: contentOf(response, index),
                finishReason: finishOf(response),
                usage: usageOf(response),
                warnings: [],
            };
        },
        doStream: async () => {
            const { response, index } = next();
            const chunks: LanguageModelV4StreamPart[] = [{ type: 'stream-start', warnings: [] }];

            contentOf(response, index).forEach((part, i) => {
                if (part.type === 'text') {
                    chunks.push(
                        { type: 'text-start', id: `t${i}` },
                        {
                            type: 'text-delta',
                            id: `t${i}`,
                            delta: part.text,
                        },
                        { type: 'text-end', id: `t${i}` },
                    );
                } else if (part.type === 'tool-call') {
                    chunks.push(part satisfies LanguageModelV4ToolCall);
                }
            });
            chunks.push({
                type: 'finish',
                finishReason: finishOf(response),
                usage: usageOf(response),
            });

            return { stream: simulateReadableStream({ chunks }) };
        },
    });
}

/** One text turn (finish `stop`). */
export function textModel(text = 'done') {
    return mockModel([{ parts: [{ type: 'text', text }] }]);
}
