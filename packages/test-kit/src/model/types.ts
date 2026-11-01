/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { EmbeddingModelV4CallOptions } from '@ai-sdk/provider';
import type { MockEmbeddingModelV4 } from 'ai/test';

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

export type MockEmbeddingModelOptions = {
    /** Vector length, 1 to 8192, 64 by default. */
    dimensions?: number;
};

export type MockEmbeddingModel = MockEmbeddingModelV4 & {
    /** The options of every model call, in call order (`values` holds the texts). */
    readonly calls: EmbeddingModelV4CallOptions[];
};
