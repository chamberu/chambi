/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ChamviError, RunNotFoundError, RunStatus } from '@chamvi/core';
import type { Run } from '@chamvi/core';
import { isHTTPError } from '@ebec/http';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import { isObject } from 'smob';
import type { HttpContext } from '../app/types.ts';
import type {
    McpRequestExtra,
    RunToolResult,
    WaitForRunOptions,
} from './types.ts';

/** A tool result carrying `value` as JSON text and as structured content. */
export function toolResult(value: object): CallToolResult {
    // Dates and other toJSON values become what the wire carries
    const structured = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

    return {
        content: [{ type: 'text', text: JSON.stringify(structured) }],
        structuredContent: structured,
    };
}

export function toolError(message: string): CallToolResult {
    return { isError: true, content: [{ type: 'text', text: message }] };
}

/**
 * Runs a tool body: HTTP and core errors become `isError` results with
 * their message, anything else goes to `onError` and reads as
 * `Internal Server Error`.
 */
export async function runTool(ctx: HttpContext, fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
    try {
        return await fn();
    } catch (error) {
        if ((isHTTPError(error) && error.status < 500) || error instanceof ChamviError) {
            return toolError(error.message);
        }

        ctx.onError(error);

        return toolError('Internal Server Error');
    }
}

/** The principal and request signal the route put on `authInfo.extra`. */
export function readRequestExtra(extra: Record<string, unknown> | undefined): McpRequestExtra | undefined {
    if (!isObject(extra) || !isObject(extra.principal) || !(extra.signal instanceof AbortSignal)) {
        return undefined;
    }

    return extra as unknown as McpRequestExtra;
}

const WAIT_OVER = new Set<string>([
    RunStatus.COMPLETED,
    RunStatus.FAILED,
    RunStatus.CANCELLED,
    RunStatus.WAITING,
]);

/**
 * Resolves with the run once it is `completed`, `failed`, `cancelled` or
 * `waiting` (seen through `run.updated` or a store poll every `pollMs`, which
 * covers runs executing on another replica), or with the latest stored run
 * when `timeoutMs` elapses or `signal` aborts. Rejects when the store fails.
 * Always unsubscribes and clears its timers.
 */
export function waitForRun(ctx: HttpContext, runId: string, opts: WaitForRunOptions): Promise<Run> {
    return new Promise<Run>((resolve, reject) => {
        let done = false;
        let poll: { clear(): void } | undefined;
        let timeout: { clear(): void } | undefined;
        let unsubscribe: (() => void) | undefined;
        const { signal } = opts;

        function stop(): boolean {
            if (done) {
                return false;
            }

            done = true;
            unsubscribe?.();
            poll?.clear();
            timeout?.clear();
            signal?.removeEventListener('abort', settleLatest);

            return true;
        }

        function settle(run: Run | undefined): void {
            if (run) {
                resolve(run);
            } else {
                reject(new RunNotFoundError(runId));
            }
        }

        /** Timeout or abort: answer with whatever the store holds now. */
        function settleLatest(): void {
            if (!stop()) {
                return;
            }

            ctx.store.runs.findOne(runId).then(settle, reject);
        }

        async function check(): Promise<void> {
            try {
                const run = await ctx.store.runs.findOne(runId);

                if (done) {
                    return;
                }

                if (!run || WAIT_OVER.has(run.status)) {
                    stop();
                    settle(run);

                    return;
                }

                poll = ctx.clock.setTimeout(() => {
                    void check();
                }, opts.pollMs);
            } catch (error) {
                if (stop()) {
                    reject(error);
                }
            }
        }

        if (signal?.aborted) {
            settleLatest();

            return;
        }

        unsubscribe = ctx.engine.on('run.updated', (e) => {
            if (e.run.id !== runId || !WAIT_OVER.has(e.run.status)) {
                return;
            }

            if (stop()) {
                resolve(e.run);
            }
        });
        signal?.addEventListener('abort', settleLatest, { once: true });
        timeout = ctx.clock.setTimeout(settleLatest, opts.timeoutMs);
        void check();
    });
}

/** What `run_<agent>` answers for a run. */
export function toRunToolResult(run: Run, deduplicated: boolean): RunToolResult {
    const result: RunToolResult = {
        runId: run.id,
        status: run.status,
        deduplicated,
    };

    if (run.output !== undefined) {
        result.output = run.output;
    }

    if (run.error !== undefined) {
        result.error = run.error;
    }

    if (run.waiting) {
        result.waiting = {
            toolName: run.waiting.toolName,
            title: run.waiting.title,
            ...(run.waiting.body !== undefined ? { body: run.waiting.body } : {}),
            ...(run.waiting.options !== undefined ? { options: run.waiting.options } : {}),
            ...(run.waiting.multiple === true ? { multiple: true } : {}),
            expiresAt: run.waiting.expiresAt.toISOString(),
        };
    }

    return result;
}

type JsonSchemaCarrier = { '~standard': Partial<StandardJSONSchemaV1.Props> };

/** Keywords whose values are data, not subschemas: a `$ref` key inside them is no reference. */
const JSON_SCHEMA_DATA_KEYWORDS = new Set(['const', 'default', 'enum', 'examples']);

/**
 * `node` with every local `$ref` (`#`, `#/definitions/...`) re-rooted at
 * `pointer`, so a schema nested there still resolves its own definitions.
 */
function rebaseRefs(node: unknown, pointer: string): unknown {
    if (Array.isArray(node)) {
        return node.map((item) => rebaseRefs(item, pointer));
    }

    if (!isObject(node)) {
        return node;
    }

    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string' && value.startsWith('#')) {
            out[key] = `${pointer}${value.slice(1)}`;
        } else if (JSON_SCHEMA_DATA_KEYWORDS.has(key)) {
            out[key] = value;
        } else {
            out[key] = rebaseRefs(value, pointer);
        }
    }

    return out;
}

/**
 * The JSON Schema (draft-07, without `$schema`) of a Standard Schema's
 * input, for a tool's `payload`; `{}` (anything) without a schema, a
 * converter, or when conversion fails. `pointer` is where the schema sits in
 * the tool's input schema (e.g. `#/properties/payload`): local `$ref`s of a
 * recursive or reused schema are rewritten to resolve from there.
 */
export function toJsonSchema(schema: StandardSchemaV1 | undefined, pointer = '#'): Record<string, unknown> {
    const converter = (schema as JsonSchemaCarrier | undefined)?.['~standard'].jsonSchema;

    if (!converter) {
        return {};
    }

    try {
        const jsonSchema = { ...converter.input({ target: 'draft-07' }) };

        delete jsonSchema.$schema;

        return rebaseRefs(jsonSchema, pointer) as Record<string, unknown>;
    } catch {
        return {};
    }
}
