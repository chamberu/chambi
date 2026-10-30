/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import { createAgentState, createMemoryStore } from '@chamvi/core';
import type { IRunArtifacts, ToolContext } from '@chamvi/core';

const NO_ARTIFACTS: IRunArtifacts = {
    put: async () => {
        throw new TypeError('artifacts are not used by the workspace tools');
    },
    get: async () => undefined,
    list: async () => [],
};

/** A ToolContext of run `runId`, started over http; `signal` defaults to one that never aborts. */
export function toolContext(runId: string, signal: AbortSignal = new AbortController().signal): ToolContext {
    return {
        // these tools reach no channel
        channels: {} as ToolContext['channels'],
        run: {
            runId,
            agent: 'coder',
            trigger: {
                id: `env-${runId}`,
                agent: 'coder',
                trigger: 'http',
                channel: 'http',
                payload: {},
                receivedAt: new Date(0),
            },
            signal,
        },
        state: createAgentState('coder', undefined, createMemoryStore().state),
        artifacts: NO_ARTIFACTS,
    };
}

/** Calls `tools[name].execute` as the AI SDK does, with the context and call options. */
export async function callTool<T = unknown>(
    tools: ToolSet,
    name: string,
    input: unknown,
    ctx: ToolContext,
): Promise<T> {
    const execute = tools[name]?.execute as ((i: unknown, o: unknown) => Promise<unknown>) | undefined;

    if (!execute) {
        throw new TypeError(`no tool ${name}`);
    }

    return await execute(input, {
        toolCallId: 'call-1',
        messages: [],
        context: ctx,
    }) as T;
}
