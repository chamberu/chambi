/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

export type MockPart = { type: 'text'; text: string } |
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
