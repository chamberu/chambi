/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    APPROVAL_OPTIONS_MAX,
    InvalidAgentDefinitionError,
    RunStatus,
    hasPermission,
} from '@chamvi/core';
import type { Agent, RunStatusLiteral } from '@chamvi/core';
import { fromJsonSchema } from '@modelcontextprotocol/server';
import type { McpServer } from '@modelcontextprotocol/server';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../app/constants.ts';
import { acquireStreamSlot } from '../app/helpers.ts';
import type { HttpContext } from '../app/types.ts';
import { toInvoker } from '../auth/helpers.ts';
import { agentPermission } from '../auth/module.ts';
import type { Principal } from '../auth/types.ts';
import { KEY_MAX_LENGTH } from '../request/constants.ts';
import { validatePayload } from '../request/helpers.ts';
import {
    APPROVAL_ID_MAX_LENGTH,
    APPROVAL_OPTION_ID_MAX_LENGTH,
    APPROVAL_REASON_MAX_LENGTH,
} from '../runs/constants.ts';
import { MCP_CHANNEL_NAME } from '../channels/constants.ts';
import {
    assertCanListRuns,
    findHttpSubscription,
    loadApprovableRun,
    loadReadableRun,
    serializeRun,
} from '../runs/helpers.ts';
import {
    DEFAULT_MCP_MAX_WAIT_SECONDS,
    DEFAULT_MCP_NAME,
    DEFAULT_MCP_VERSION,
    MCP_TOOL_NAME_MAX_LENGTH,
    MCP_WAIT_POLL_MS,
} from './constants.ts';
import {
    runTool,
    toJsonSchema,
    toRunToolResult,
    toolResult,
    waitForRun,
} from './helpers.ts';
import type {
    McpEndpointOptions,
    McpRequestExtra,
    McpRunTool,
    RunAgentArgs,
    RunSummary,
} from './types.ts';

type GetRunArgs = { runId: string };

/** No U+0000: Postgres text columns refuse it. */
const NO_NUL = '^[^\\u0000]*$';

type ApproveRunArgs = {
    runId: string;
    approvalId: string;
    approved: boolean;
    reason?: string;
    selected?: string[];
};

const DESCRIPTION_MAX_LENGTH = 200;

type ListRunsArgs = {
    agent?: string;
    status?: RunStatusLiteral[];
    limit?: number;
    offset?: number;
};

// built once: fromJsonSchema compiles a validator per schema object
const GET_RUN_INPUT = fromJsonSchema<GetRunArgs>({
    type: 'object',
    properties: {
        runId: {
            type: 'string', 
            minLength: 1, 
            pattern: NO_NUL,
        },
    },
    required: ['runId'],
    additionalProperties: false,
});

const LIST_RUNS_INPUT = fromJsonSchema<ListRunsArgs>({
    type: 'object',
    properties: {
        agent: {
            type: 'string', 
            minLength: 1, 
            pattern: NO_NUL,
        },
        status: { type: 'array', items: { type: 'string', enum: Object.values(RunStatus) } },
        limit: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_PAGE_LIMIT,
        },
        offset: { type: 'integer', minimum: 0 },
    },
    additionalProperties: false,
});

const APPROVE_RUN_INPUT = fromJsonSchema<ApproveRunArgs>({
    type: 'object',
    properties: {
        runId: {
            type: 'string',
            minLength: 1,
            pattern: NO_NUL,
        },
        approvalId: {
            type: 'string',
            minLength: 1,
            maxLength: APPROVAL_ID_MAX_LENGTH,
            pattern: NO_NUL,
        },
        approved: { type: 'boolean' },
        reason: { type: 'string', maxLength: APPROVAL_REASON_MAX_LENGTH },
        selected: {
            type: 'array',
            maxItems: APPROVAL_OPTIONS_MAX,
            items: {
                type: 'string',
                minLength: 1,
                maxLength: APPROVAL_OPTION_ID_MAX_LENGTH,
                pattern: NO_NUL,
            },
        },
    },
    required: ['runId', 'approvalId', 'approved'],
    additionalProperties: false,
});

function summarize(run: RunSummary): RunSummary {
    return {
        id: run.id,
        agent: run.agent,
        status: run.status,
        createdAt: run.createdAt,
        ...(run.finishedAt !== undefined ? { finishedAt: run.finishedAt } : {}),
        ...(run.error !== undefined ? { error: run.error } : {}),
    };
}

function registerReadTools(server: McpServer, ctx: HttpContext, principal: Principal): void {
    server.registerTool('get_run', {
        title: 'Get run',
        description: 'Reads one run: status, output, error and the pending approval, if any.',
        inputSchema: GET_RUN_INPUT,
        annotations: { readOnlyHint: true },
    }, (args) => runTool(ctx, async () => toolResult(serializeRun(await loadReadableRun(ctx, principal, args.runId)))));

    server.registerTool('list_runs', {
        title: 'List runs',
        description: 'Lists runs, oldest first. Without run:read, agent must name an agent you may run.',
        inputSchema: LIST_RUNS_INPUT,
        annotations: { readOnlyHint: true },
    }, (args) => runTool(ctx, async () => {
        assertCanListRuns(principal, args.agent);
        const { data, total } = await ctx.store.runs.find({
            ...(args.agent !== undefined ? { agent: args.agent } : {}),
            ...(args.status !== undefined ? { status: args.status } : {}),
            limit: args.limit ?? DEFAULT_PAGE_LIMIT,
            offset: args.offset ?? 0,
        });
        return toolResult({ data: data.map(summarize), total });
    }));
}

function describeAgent(agent: Agent): string {
    const [firstLine = ''] = agent.definition.instructions.trim().split('\n');
    return firstLine.trim().slice(0, DESCRIPTION_MAX_LENGTH) || `Starts a run of agent "${agent.name}".`;
}

/**
 * The `run_<agent>` tool of an agent with an `http.on()` subscription (`undefined`
 * without one): the payload's JSON Schema is converted and compiled here, not
 * per request. A schema the MCP validator cannot compile, or a tool name above
 * 64 characters, throws InvalidAgentDefinitionError.
 */
export function buildRunTool(agent: Agent, options: McpEndpointOptions): McpRunTool | undefined {
    const subscription = findHttpSubscription(agent);
    if (!subscription) return undefined;
    if (`run_${agent.name}`.length > MCP_TOOL_NAME_MAX_LENGTH) {
        throw new InvalidAgentDefinitionError(
            `The MCP tool "run_${agent.name}" exceeds ${MCP_TOOL_NAME_MAX_LENGTH} characters: shorten the agent name to ${MCP_TOOL_NAME_MAX_LENGTH - 4} or set mcp: false.`,
        );
    }
    const schema = subscription.options.schema as StandardSchemaV1 | undefined;
    let inputSchema: McpRunTool['inputSchema'];
    try {
        inputSchema = fromJsonSchema<RunAgentArgs>({
            type: 'object',
            properties: {
                payload: toJsonSchema(schema, '#/properties/payload'),
                idempotencyKey: {
                    type: 'string',
                    minLength: 1,
                    maxLength: KEY_MAX_LENGTH,
                    pattern: NO_NUL,
                    description: 'Dedupes starts over MCP; a key used over REST is a different scope.',
                },
                address: {
                    type: 'string',
                    minLength: 1,
                    maxLength: KEY_MAX_LENGTH,
                    pattern: NO_NUL,
                },
                waitSeconds: {
                    type: 'integer',
                    minimum: 0,
                    description: `Seconds to wait for the run to finish or pause (at most ${options.maxWaitSeconds}). Default 0.`,
                },
            },
            additionalProperties: false,
        });
    } catch (error) {
        throw new InvalidAgentDefinitionError(
            `The payload schema of agent "${agent.name}" is no valid JSON Schema for MCP: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    return {
        agent,
        subscription,
        ...(schema ? { schema } : {}),
        description: describeAgent(agent),
        inputSchema,
    };
}

/**
 * Throws InvalidAgentDefinitionError when the agent's `run_<agent>` MCP tool
 * cannot be built (a name above 64 characters with `run_`, a payload schema
 * the MCP validator cannot compile), as createHttpApp would for a code agent.
 */
export function assertMcpRunTool(agent: Agent): void {
    buildRunTool(agent, {
        name: DEFAULT_MCP_NAME,
        version: DEFAULT_MCP_VERSION,
        maxWaitSeconds: DEFAULT_MCP_MAX_WAIT_SECONDS,
    });
}

/**
 * The `run_<agent>` tools of the app's agents, read per request in
 * registration order. Each definition is built once per agent object (a
 * replaced agent is a new object, so it is rebuilt). The agents held at
 * construction are built eagerly and a failure fails the app (a folder
 * agent's is reported to `onError` and its tool skipped); an agent
 * registered later is built on the first request that sees it, and a failure
 * then is reported to `onError` once and its tool skipped.
 */
export function createRunToolSource(ctx: HttpContext, options: McpEndpointOptions): () => McpRunTool[] {
    // null: no http subscription, or a definition that failed to build
    const built = new WeakMap<Agent, McpRunTool | null>();
    const toolOf = (agent: Agent): McpRunTool | null => {
        const cached = built.get(agent);
        if (cached !== undefined) return cached;
        let tool: McpRunTool | null = null;
        try {
            tool = buildRunTool(agent, options) ?? null;
        } catch (error) {
            ctx.onError(error);
        }
        built.set(agent, tool);
        return tool;
    };

    // a folder agent (one with a revision) never fails the app: it was checked before it was registered
    for (const agent of ctx.agents.list()) {
        if (ctx.engine.agentRevision(agent.name) === undefined) built.set(agent, buildRunTool(agent, options) ?? null);
        else toolOf(agent);
    }

    return () => ctx.agents.list()
        .map(toolOf)
        .filter((tool): tool is McpRunTool => tool !== null);
}

function registerRunTool(
    server: McpServer,
    ctx: HttpContext,
    tool: McpRunTool,
    extra: McpRequestExtra,
    options: McpEndpointOptions,
): void {
    const {
        agent, 
        subscription, 
        schema, 
    } = tool;
    if (!hasPermission(extra.principal.permissions, agentPermission(agent.name, 'run'))) return;

    server.registerTool(`run_${agent.name}`, {
        title: `Run ${agent.name}`,
        description: tool.description,
        inputSchema: tool.inputSchema,
    }, (args, toolCtx) => runTool(ctx, async () => {
        const payload = await validatePayload(schema, args.payload);
        const { runId, deduplicated } = await ctx.engine.dispatch({
            agent: agent.name,
            trigger: subscription.id,
            channel: MCP_CHANNEL_NAME,
            payload,
            ...(args.idempotencyKey !== undefined ? { idempotencyKey: args.idempotencyKey } : {}),
            ...(args.address !== undefined ? { address: args.address } : {}),
            invoker: toInvoker(extra.principal),
        });

        const waitSeconds = Math.min(args.waitSeconds ?? 0, options.maxWaitSeconds);
        // a wait holds one stream.maxOpen slot; over the cap the dispatched run is answered at once
        const release = waitSeconds > 0 ? acquireStreamSlot(ctx) : undefined;
        if (!release) {
            const status = deduplicated ? (await ctx.store.runs.findOne(runId))?.status ?? RunStatus.QUEUED : RunStatus.QUEUED;
            return toolResult({
                runId,
                status,
                deduplicated,
            });
        }

        // the HTTP request going away, or an MCP cancel notification
        const signal = AbortSignal.any([extra.signal, toolCtx.mcpReq.signal]);
        try {
            const run = await waitForRun(ctx, runId, {
                timeoutMs: waitSeconds * 1_000,
                pollMs: MCP_WAIT_POLL_MS,
                signal,
            });
            return toolResult(toRunToolResult(run, deduplicated));
        } finally {
            release();
        }
    }));
}

function registerApproveTool(server: McpServer, ctx: HttpContext, principal: Principal): void {
    server.registerTool('approve_run', {
        title: 'Approve run',
        description: 'Answers the approval a waiting run waits on (its waiting.approvalId, from get_run). With options, pass the chosen option ids as selected (from get_run\'s waiting.options). Needs agent:<agent>:approve for the run\'s agent.',
        inputSchema: APPROVE_RUN_INPUT,
    }, (args) => runTool(ctx, async () => {
        const run = await loadApprovableRun(ctx, principal, args.runId);
        await ctx.engine.approve(run.id, {
            approvalId: args.approvalId,
            approved: args.approved,
            ...(args.reason !== undefined ? { reason: args.reason } : {}),
            ...(args.selected !== undefined ? { selected: args.selected } : {}),
            approver: toInvoker(principal),
        });
        return toolResult({ runId: run.id, status: RunStatus.QUEUED });
    }));
}

/** Registers the tools one MCP request's principal sees (from definitions built once). */
export function registerTools(
    server: McpServer,
    ctx: HttpContext,
    runTools: McpRunTool[],
    extra: McpRequestExtra,
    options: McpEndpointOptions,
): void {
    for (const tool of runTools) registerRunTool(server, ctx, tool, extra, options);
    registerReadTools(server, ctx, extra.principal);
    registerApproveTool(server, ctx, extra.principal);
}
