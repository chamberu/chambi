/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ModelMessage, ToolSet } from 'ai';
import { createAgentState, createMemoryRepositories } from '@chamvi/core';
import type {
    IRunArtifacts,
    ToolContext,
    TriggerEnvelope,
} from '@chamvi/core';
import { START } from './app.ts';

const NO_ARTIFACTS: IRunArtifacts = {
    put: async () => { throw new TypeError('artifacts are not used by the github tools'); },
    get: async () => undefined,
    list: async () => [],
};

export type ToolContextInput = {
    runId?: string;
    /** The run's channel; default `github`. */
    channel?: string;
    /** Default: a GithubEvent for installation 42. */
    payload?: unknown;
    receivedAt?: Date;
    /** The run's signal; default one that never aborts. */
    signal?: AbortSignal;
};

/** A ToolContext of a run started on `channel` (default a github delivery for installation 42). */
export function toolContext(input: ToolContextInput = {}): ToolContext {
    const runId = input.runId ?? 'run-1';
    const channel = input.channel ?? 'github';
    const payload = input.payload ?? (channel === 'github' ?
        {
            name: 'issues',
            action: 'opened',
            delivery: 'd-1',
            installationId: 42,
            payload: {},
        } :
        {});
    const trigger: TriggerEnvelope = {
        id: `env-${runId}`,
        agent: 'triage',
        trigger: channel,
        channel,
        payload,
        receivedAt: input.receivedAt ?? START,
    };
    return {
        // these tools reach no channel
        channels: {} as ToolContext['channels'],
        run: {
            runId,
            agent: 'triage',
            trigger,
            signal: input.signal ?? new AbortController().signal,
        },
        state: createAgentState('triage', undefined, createMemoryRepositories().state),
        artifacts: NO_ARTIFACTS,
    };
}

export type CallInput = {
    toolCallId?: string;
    messages?: ModelMessage[];
};

/** Calls `tools[name].execute` as the AI SDK does, with the context and call options. */
export async function callTool<T = unknown>(
    tools: ToolSet,
    name: string,
    input: unknown,
    ctx: ToolContext,
    options: CallInput = {},
): Promise<T> {
    const execute = tools[name]?.execute as ((i: unknown, o: unknown) => Promise<unknown>) | undefined;
    if (!execute) throw new TypeError(`no tool ${name}`);
    return await execute(input, {
        toolCallId: options.toolCallId ?? 'call-1',
        messages: options.messages ?? [],
        context: ctx,
    }) as T;
}

/** An assistant message (one model step), optionally carrying a tool call. */
export function assistant(toolCallId?: string): ModelMessage {
    if (!toolCallId) return { role: 'assistant', content: 'thinking' };
    return {
        role: 'assistant',
        content: [{
            type: 'tool-call',
            toolCallId,
            toolName: 'github_create_comment',
            input: {},
        }],
    };
}
