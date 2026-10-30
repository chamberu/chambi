/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

// Runs on the built packages (spawned by test/unit/loader/identity.spec.ts):
// a module provides a context key in engineCreated, and a folder agent's tool
// in CHAMVI_AGENTS_DIR (argv[2], outside the app tree) injects it. The folder
// agent reads the key and the mock model from globalThis.
import { AppToken, createApp, storeModule } from '@chamvi/app';
import { createMemoryStore, defineContextKey } from '@chamvi/core';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

const usage = {
    inputTokens: {
        total: 1,
        noCache: 1,
        cacheRead: undefined,
        cacheWrite: undefined,
    },
    outputTokens: {
        total: 1,
        text: 1,
        reasoning: undefined,
    },
};
const turns = [
    [{
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'greet',
        input: '{}',
    }],
    [{ type: 'text-start', id: 't' }, {
        type: 'text-delta',
        id: 't',
        delta: 'done',
    }, { type: 'text-end', id: 't' }],
];
let turn = 0;
const model = new MockLanguageModelV4({
    doStream: async () => {
        const parts = turns[turn++] ?? [];
        const hasToolCall = parts.some((part) => part.type === 'tool-call');
        const finishReason = { unified: hasToolCall ? 'tool-calls' : 'stop', raw: undefined };

        return {
            stream: simulateReadableStream({
                chunks: [{ type: 'stream-start', warnings: [] }, ...parts, {
                    type: 'finish',
                    finishReason,
                    usage,
                }],
            }),
        };
    },
});

const key = defineContextKey('greeting');

globalThis.chamviGreetingKey = key;
// the model goes in directly: through a models provider the AI SDK would wrap the mock
globalThis.chamviModel = model;

const store = createMemoryStore();
const app = createApp({
    modules: [{
        name: 'greeting',
        async setup(container) {
            container.registerMany(AppToken.LIFECYCLE_HOOKS, { useValue: { name: 'greeting', engineCreated: (engine) => engine.provide(key, 'hello from the module') } });
        },
    }, storeModule({ store })],
});

const result = await app.runJob({
    agent: 'greeter',
    env: {
        RESUME_SECRET: 'x'.repeat(32),
        CHAMVI_AGENTS_DIR: process.argv[2],
        CHAMVI_DRAIN_TIMEOUT_MS: '1000',
        CHAMVI_LOG_LEVEL: 'error',
    },
});
const steps = result.runId ? await store.steps.find(result.runId) : [];
const tool = steps.find((step) => step.kind === 'tool');

process.stdout.write(`${JSON.stringify({
    status: result.status,
    output: tool?.output ?? null,
    error: tool?.error ?? null,
})}\n`);
