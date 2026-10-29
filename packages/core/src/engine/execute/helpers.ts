/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type {
    FinishReason,
    JSONValue,
    LanguageModelResponseMetadata,
    LanguageModelUsage,
    ModelMessage,
    OutputInterface,
    StepResult,
    ToolResultPart,
    ToolSet,
} from 'ai';
import { NoSuchToolError, TypeValidationError, asSchema } from 'ai';
import { isObject } from 'smob';
import { assertNoNeedsApproval, assertToolsContext } from '../../agent/asserts.ts';
import { toFilePart } from '../../artifact/helpers.ts';
import { createRunArtifacts } from '../../artifact/module.ts';
import { createToolChannels } from '../../channel/helpers.ts';
import { checkConversation, conversationFor } from '../../conversation/context.ts';
import { bindProvided } from '../../context/helpers.ts';
import { validateToolInput } from '../../effect/helpers.ts';
import { wrapToolsForRun } from '../../effect/wrap.ts';
import {
    BudgetExceededError,
    IncompleteResponseError,
    ToolNotAllowedError,
    ValidationError,
} from '../../errors/index.ts';
import type { Budget, Checkpoint, RunContext } from '../../run/types.ts';
import { createAgentState } from '../../state/module.ts';
import { createStateTools } from '../../state/tools.ts';
import { TOOL_CONTEXT_MISSING } from '../../tool/constants.ts';
import { hasToolContext } from '../../tool/helpers.ts';
import type { ToolContext } from '../../tool/types.ts';
import type { TriggerEnvelope } from '../../trigger/types.ts';
import { MAX_ERROR_CAUSE_LENGTH } from './constants.ts';
import type { ApprovalRequest, ExecuteContext } from './types.ts';

export function renderTrigger(envelope: TriggerEnvelope): string {
    const json = JSON.stringify({
        channel: envelope.channel,
        trigger: envelope.trigger,
        payload: envelope.payload,
    }, null, 2);
    return `\`\`\`json\n${json}\n\`\`\``;
}

/**
 * The run's first message: accepted conversation text or the rendered trigger,
 * followed by artifact markers for attachments (hydrated to bytes for the model).
 */
export function initialMessage(envelope: TriggerEnvelope, acceptedText?: string): ModelMessage {
    const text = acceptedText ?? renderTrigger(envelope);
    if (!envelope.attachments?.length) return { role: 'user', content: text };
    return {
        role: 'user',
        content: [{ type: 'text', text }, ...envelope.attachments.map(toFilePart)],
    };
}

/**
 * The issues at the bottom of a validation error's cause chain: a Standard
 * Schema issue list, or the `issues` of an error such as a ZodError.
 */
function causeIssues(error: unknown): unknown[] {
    let cause = error;
    while (TypeValidationError.isInstance(cause)) cause = cause.cause;
    if (Array.isArray(cause)) return cause;
    if (isObject(cause) && Array.isArray(cause.issues)) return cause.issues;
    return [];
}

/** An issue's path as `a.b.0`, undefined at the root. */
function issuePath(issue: unknown): string | undefined {
    if (!isObject(issue) || !Array.isArray(issue.path) || issue.path.length === 0) return undefined;
    return issue.path.map((segment) => String(isObject(segment) ? segment.key : segment)).join('.');
}

/**
 * A ValidationError for a tool context the AI SDK refused. The SDK's own
 * message holds the whole value (a toolsContext entry may carry a secret) and
 * issue messages may echo it too, so only the tool name and the issue paths
 * are kept; chamvi's own missing-context issue keeps its message.
 */
function toolContextError(error: TypeValidationError): ValidationError {
    const prefix = `Type validation failed for tool context (${error.context?.entityName ?? 'unknown'}): `;
    const issues = causeIssues(error);
    if (issues.some((issue) => isObject(issue) && issue.message === TOOL_CONTEXT_MISSING)) {
        return new ValidationError(prefix + TOOL_CONTEXT_MISSING);
    }
    if (error.value === undefined) {
        return new ValidationError(`${prefix}the agent has no toolsContext entry for it, and its contextSchema requires one.`);
    }
    const paths = [...new Set(issues.map(issuePath).filter((path) => path !== undefined))];
    const at = paths.length > 0 ? ` (at ${paths.join(', ')})` : '';
    return new ValidationError(`${prefix}the agent's toolsContext entry does not match the tool's contextSchema${at}.`);
}

/**
 * `{ code, message }` of anything thrown; code falls back to 'Error'. A refused
 * tool context is recorded without its value.
 */
export function toRunError(error: unknown): { code: string; message: string } {
    if (TypeValidationError.isInstance(error) && error.context?.field === 'tool context') {
        return toRunError(toolContextError(error));
    }
    const code = isObject(error) ? error.code : undefined;
    return {
        code: typeof code === 'string' ? code : 'Error',
        message: error instanceof Error ? error.message : String(error),
    };
}

/**
 * The tools handed to the agent: generated state tools (when the agent declares
 * `state`) merged with the user's tools (a plain set or the factory's result),
 * which win on a name clash. Every tool stays executable, so a call pending
 * on an approval still gets an answer; `activeTools` (the names the
 * agent's toolPolicy allows, undefined without a policy) is what the model is
 * offered. wrapToolsForRun memoizes effects and re-checks the policy per call,
 * so a refused call is a tool error, and runs the agent's hooks around every
 * call; a call approve() suspended is reported to `onSuspend`, and
 * `stepIndex` names the step whose calls run (part of the approval id). `toolsContext`
 * maps every chamvi tool
 * (policy-hidden ones included) to the execution's one ToolContext, plus the
 * agent's own `toolsContext` entries for the other tools, by reference.
 * Throws InvalidAgentDefinitionError for a misconfigured `toolsContext` and
 * for a tool declaring `needsApproval`.
 */
export function assembleTools(
    ctx: ExecuteContext,
    runContext: RunContext,
    onSuspend?: (request: ApprovalRequest) => void,
    stepIndex?: () => number,
): {
    tools: ToolSet;
    activeTools?: string[];
    toolsContext: Record<string, unknown>;
} {
    const {
        tools: userTools,
        state: schema,
        toolPolicy,
        toolsContext: agentToolsContext,
        hooks: agentHooks,
    } = ctx.agent.definition;
    const hooks = conversationFor(runContext) ? {
        ...agentHooks,
        beforeToolExecution: async (...args: Parameters<NonNullable<NonNullable<typeof agentHooks>['beforeToolExecution']>>) => {
            await checkConversation(runContext);
            return agentHooks?.beforeToolExecution?.(...args);
        },
    } : agentHooks;
    if (!userTools && !schema) {
        if (agentToolsContext) assertToolsContext(ctx.agent.name, {}, agentToolsContext);
        return { tools: {}, toolsContext: {} };
    }
    const toolContext: ToolContext = {
        run: runContext,
        state: createAgentState(ctx.agent.name, schema, ctx.stores.state),
        artifacts: createRunArtifacts(ctx.stores.artifacts, { id: ctx.run.id, agent: ctx.run.agent }, ctx.clock),
        channels: createToolChannels(runContext, ctx.stores.effects, ctx.engine),
    };
    // before the factory, so inject() works there, in execute and in the effect hooks
    if (ctx.provided) bindProvided(toolContext, ctx.provided);
    const tools: ToolSet = {
        ...(schema ? createStateTools(schema) : {}),
        ...(typeof userTools === 'function' ? userTools(toolContext) : userTools),
    };

    // a factory's set is only known here: refused like defineAgent refuses a plain one
    assertNoNeedsApproval(ctx.agent.name, tools);

    const toolsContext: Record<string, unknown> = {};
    for (const [name, tool] of Object.entries(tools)) {
        if (hasToolContext(tool)) toolsContext[name] = toolContext;
    }
    if (agentToolsContext) {
        assertToolsContext(ctx.agent.name, tools, agentToolsContext);
        for (const [name, value] of Object.entries(agentToolsContext)) toolsContext[name] = value;
    }

    if (!toolPolicy) {
        return {
            tools: wrapToolsForRun(tools, toolContext, ctx.stores.effects, {
                hooks,
                onSuspend,
                stepIndex,
            }),
            toolsContext,
        };
    }
    const allow = (name: string) => toolPolicy(name, { run: runContext });
    return {
        tools: wrapToolsForRun(tools, toolContext, ctx.stores.effects, {
            allow,
            hooks,
            onSuspend,
            stepIndex,
        }),
        activeTools: Object.keys(tools).filter(allow),
        toolsContext,
    };
}

/**
 * The error to record for a model's call to a tool the toolPolicy refused: the
 * AI SDK never offered it (not in `activeTools`) and answered the call with a
 * NoSuchToolError; the step records ToolNotAllowedError instead. Undefined for
 * any other tool error, a genuinely unknown tool included.
 */
export function refusedCallError(
    step: StepResult<ToolSet>,
    part: { toolCallId: string; toolName: string },
    tools: ToolSet,
    activeTools: string[] | undefined,
): ToolNotAllowedError | undefined {
    if (!activeTools || !Object.hasOwn(tools, part.toolName) || activeTools.includes(part.toolName)) return undefined;
    // an invalid (unparsable) call carries the parse error
    const call = step.toolCalls.find((c) => c.toolCallId === part.toolCallId);
    const error = call && 'error' in call ? call.error : undefined;
    return NoSuchToolError.isInstance(error) ? new ToolNotAllowedError(part.toolName) : undefined;
}

/** A tool call of the checkpoint that has no result yet: suspended by approve(). */
export type PendingToolCall = {
    toolCallId: string;
    toolName: string;
    input: unknown;
};

/**
 * The tool calls of the last assistant message in `messages` that have no
 * tool result (in any message): the calls a suspended approve() left
 * pending, in call order. Provider-executed calls are never pending.
 */
export function pendingToolCalls(messages: ModelMessage[]): PendingToolCall[] {
    const index = messages.findLastIndex((message) => message.role === 'assistant');
    const assistant = messages[index];
    if (!assistant || assistant.role !== 'assistant' || typeof assistant.content === 'string') return [];
    const answered = new Set<string>();
    for (const message of messages.slice(index)) {
        if (typeof message.content === 'string') continue;
        for (const part of message.content) if (part.type === 'tool-result') answered.add(part.toolCallId);
    }
    const pending: PendingToolCall[] = [];
    for (const part of assistant.content) {
        if (part.type !== 'tool-call' || part.providerExecuted || answered.has(part.toolCallId)) continue;
        pending.push({
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
        });
    }
    return pending;
}

/**
 * Drops the tool results of `toolCallIds` (the suspended calls' placeholders)
 * from tool messages, and a tool message left empty; the calls stay in the
 * assistant message, pending.
 */
export function withoutResults(messages: ModelMessage[], toolCallIds: ReadonlySet<string>): ModelMessage[] {
    const out: ModelMessage[] = [];
    for (const message of messages) {
        if (message.role !== 'tool') {
            out.push(message);
            continue;
        }
        const content = message.content.filter((part) => !(part.type === 'tool-result' && toolCallIds.has(part.toolCallId)));
        if (content.length > 0) out.push({ ...message, content });
    }
    return out;
}

/** `messages` with `parts` added to their trailing tool message (a new one when they end otherwise). */
export function withToolResults(messages: ModelMessage[], parts: ToolResultPart[]): ModelMessage[] {
    if (parts.length === 0) return messages;
    const last = messages.at(-1);
    if (last?.role === 'tool') {
        return [...messages.slice(0, -1), { ...last, content: [...last.content, ...parts] }];
    }
    return [...messages, { role: 'tool', content: parts }];
}

/** The message of anything thrown, as the AI SDK words a tool error for the model. */
function errorMessage(error: unknown): string {
    if (error == null) return 'unknown error';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    return JSON.stringify(error);
}

function toJsonValue(value: unknown): JSONValue {
    if (value === undefined) return null;
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : JSON.parse(serialized) as JSONValue;
}

/** The tool result the model sees for an output or error, as the AI SDK builds it. */
export async function toToolResultPart(
    call: PendingToolCall,
    tool: ToolSet[string] | undefined,
    outcome: { output: unknown } | { error: unknown },
): Promise<ToolResultPart> {
    let output: ToolResultPart['output'];
    if ('error' in outcome) {
        output = { type: 'error-text', value: errorMessage(outcome.error) };
    } else if (tool?.toModelOutput) {
        output = await tool.toModelOutput({
            toolCallId: call.toolCallId,
            input: call.input as never,
            output: outcome.output as never,
        });
    } else {
        output = typeof outcome.output === 'string' ?
            { type: 'text', value: outcome.output } :
            { type: 'json', value: toJsonValue(outcome.output) };
    }
    return {
        type: 'tool-result',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output,
    };
}

/**
 * Runs a pending tool call outside the AI SDK, re-applying what the SDK
 * would: the toolPolicy (a refused call answers ToolNotAllowedError), the
 * input schema parse (a failure is a ValidationError result) and the
 * `contextSchema` check (a failure throws the SDK's TypeValidationError, which
 * fails the run); the wrapped tool runs the hooks and the effect logic.
 * Resolves the call's output or its tool error; a suspended call resolves the
 * placeholder (the caller reads the suspension from its `onSuspend`).
 */
export async function executePendingCall(input: {
    call: PendingToolCall;
    tools: ToolSet;
    activeTools?: string[];
    toolsContext: Record<string, unknown>;
    messages: ModelMessage[];
    signal: AbortSignal;
}): Promise<{ output: unknown } | { error: unknown }> {
    const {
        call,
        tools,
        activeTools,
        toolsContext,
    } = input;
    const tool = Object.hasOwn(tools, call.toolName) ? tools[call.toolName] : undefined;
    if (!tool || typeof tool.execute !== 'function') {
        return { error: new ValidationError(`Tool "${call.toolName}" is not available any more.`) };
    }
    if (activeTools && !activeTools.includes(call.toolName)) return { error: new ToolNotAllowedError(call.toolName) };

    let parsed: unknown;
    try {
        parsed = await validateToolInput(call.toolName, tool.inputSchema, call.input, 'the pending call\'s input');
    } catch (error) {
        return { error };
    }

    let context = Object.hasOwn(toolsContext, call.toolName) ? toolsContext[call.toolName] : undefined;
    if (tool.contextSchema) {
        const { validate } = asSchema(tool.contextSchema);
        if (validate) {
            const result = await validate(context);
            if (!result.success) {
                throw new TypeValidationError({
                    value: context,
                    cause: result.error,
                    context: { field: 'tool context', entityName: call.toolName },
                });
            }
            context = result.value;
        }
    }

    try {
        let output: unknown = await (tool.execute as (input: unknown, options: unknown) => unknown)(parsed, {
            toolCallId: call.toolCallId,
            messages: input.messages,
            abortSignal: input.signal,
            context,
        });
        if (isObject(output) && Symbol.asyncIterator in output) {
            let last: unknown;
            for await (const chunk of output as AsyncIterable<unknown>) last = chunk;
            output = last;
        }
        return { output };
    } catch (error) {
        return { error };
    }
}

/** Text of the last assistant message, '' when there is none. */
export function lastAssistantText(messages: ModelMessage[]): string {
    const last = messages.findLast((m) => m.role === 'assistant');
    if (!last) return '';
    if (typeof last.content === 'string') return last.content;
    return last.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

export function budgetExceeded(budget: Budget, kind: 'steps' | 'tokens'): BudgetExceededError {
    return new BudgetExceededError(kind === 'steps' ?
        `The run reached its ${budget.maxSteps} step limit.` :
        `The run reached its ${budget.maxTokens} token limit.`);
}

/**
 * A structured output that failed to parse or validate, as a core ValidationError;
 * the cause (JSON parse or schema error) names the offending text or field, cut
 * to MAX_ERROR_CAUSE_LENGTH characters (the whole answer stays in the llm step).
 */
export function toValidationError(error: unknown): ValidationError {
    const message = error instanceof Error ? error.message : String(error);
    let cause = isObject(error) && error.cause instanceof Error ? error.cause.message : undefined;
    if (cause && cause.length > MAX_ERROR_CAUSE_LENGTH) cause = `${cause.slice(0, MAX_ERROR_CAUSE_LENGTH)}…`;
    return new ValidationError(cause ? `${message} ${cause}` : message);
}

/** Names of the step's tool calls that got neither a result nor an error. */
export function unansweredToolNames(step: StepResult<ToolSet> | undefined): string[] {
    if (!step) return [];
    const answered = new Set<string>();
    for (const part of step.content) {
        if (part.type === 'tool-result' || part.type === 'tool-error') answered.add(part.toolCallId);
    }
    return step.toolCalls.filter((call) => !answered.has(call.toolCallId)).map((call) => call.toolName);
}

/**
 * Why a structured output has no complete answer to parse, for a loop that
 * ended on `finishReason`: the answer was cut off ('length'), or the loop ended
 * on tool calls nothing executed ('tool-calls' without a budget stop, e.g. a
 * tool without `execute`). Undefined when the answer can be parsed.
 */
export function incompleteOutput(finishReason: string | undefined, toolNames: string[] = []): IncompleteResponseError | undefined {
    if (finishReason === 'length') {
        return new IncompleteResponseError(
            'The model answer was cut off at its output token limit (finish reason length), so there is no complete output to parse.',
        );
    }
    if (finishReason === 'tool-calls') {
        const names = toolNames.length > 0 ? toolNames.map((name) => `"${name}"`).join(', ') : 'a tool';
        return new IncompleteResponseError(
            `The model ended on a call to ${names} that nothing executed (a tool without execute), so there is no final answer to parse.`,
        );
    }
    return undefined;
}

/**
 * The context `Output.parseCompleteOutput` gets for the final answer of an
 * earlier execution: its finish reason, zero usage, minimal response metadata.
 */
export function outputContext(checkpoint: Checkpoint, now: Date): {
    response: Omit<LanguageModelResponseMetadata, 'messages' | 'body'>;
    usage: LanguageModelUsage;
    finishReason: FinishReason;
} {
    return {
        response: {
            id: `checkpoint-${checkpoint.runId}-${checkpoint.stepIndex}`,
            timestamp: now,
            modelId: 'checkpoint',
        },
        usage: {
            inputTokens: 0,
            inputTokenDetails: {
                noCacheTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
            },
            outputTokens: 0,
            outputTokenDetails: {
                textTokens: 0,
                reasoningTokens: 0,
            },
            totalTokens: 0,
        },
        finishReason: (checkpoint.finishReason ?? 'other') as FinishReason,
    };
}

/**
 * `output` for the stream: parsePartialOutput hands back the accumulated text
 * instead of parsing it, so the AI SDK does not re-parse the whole answer on
 * every delta (nobody reads the partial output) and still publishes each delta
 * (a returned undefined would hold the deltas back until the text ends).
 * parseCompleteOutput and responseFormat are the agent's own.
 */
export function withoutPartialOutput(output: OutputInterface): OutputInterface {
    const copy: OutputInterface = Object.create(output);
    copy.parsePartialOutput = async ({ text }: { text: string }) => ({ partial: text });
    return copy;
}
