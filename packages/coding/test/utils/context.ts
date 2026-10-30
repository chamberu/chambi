/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import { createAgentState, createMemoryStore } from '@chamvi/core';
import type { Artifact, IRunArtifacts, ToolContext } from '@chamvi/core';

/** In-memory run artifacts (`read_file` stores the images it shows), ids `artifact-<n>`. */
export function createArtifacts(runId = 'r1'): IRunArtifacts {
    const stored = new Map<string, { artifact: Artifact; data: Uint8Array }>();

    return {
        put: async (input) => {
            const artifact: Artifact = {
                id: `artifact-${stored.size + 1}`,
                runId,
                agent: 'coder',
                mediaType: input.mediaType,
                ...(input.filename === undefined ? {} : { filename: input.filename }),
                size: input.data.byteLength,
                createdAt: new Date(0),
            };

            stored.set(artifact.id, { artifact, data: Uint8Array.from(input.data) });

            return artifact;
        },
        get: async (id) => stored.get(id),
        list: async () => Array.from(stored.values(), (entry) => entry.artifact),
    };
}

/** A ToolContext of run `runId`, started over http; `signal` defaults to one that never aborts, `artifacts` to fresh ones. */
export function toolContext(
    runId: string,
    signal: AbortSignal = new AbortController().signal,
    artifacts: IRunArtifacts = createArtifacts(runId),
): ToolContext {
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
        artifacts,
    };
}

/** Calls `tools[name].execute` as the AI SDK does, with the context and call options. */
export async function callTool<T = unknown>(
    tools: ToolSet,
    name: string,
    input: unknown,
    ctx: ToolContext,
    abortSignal?: AbortSignal,
): Promise<T> {
    const execute = tools[name]?.execute as ((i: unknown, o: unknown) => Promise<unknown>) | undefined;

    if (!execute) {
        throw new TypeError(`no tool ${name}`);
    }

    return await execute(input, {
        toolCallId: 'call-1',
        messages: [],
        context: ctx,
        abortSignal,
    }) as T;
}
