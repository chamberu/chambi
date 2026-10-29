/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { bindConversationRun } from '../../conversation/context.ts';
import { ToolLoopAgent, isStepCount } from 'ai';
import type {
    LanguageModel,
    ModelMessage,
    StepResult,
    StopCondition,
    ToolSet,
} from 'ai';
import { hydrateMessages } from '../../artifact/helpers.ts';
import {
    ArtifactNotFoundError,
    FatalToolError,
    IncompleteResponseError,
    InvalidAgentDefinitionError,
} from '../../errors/index.ts';
import { bindRunSnapshot } from '../../handoff/helpers.ts';
import { toLanguageModel } from '../../model/asserts.ts';
import { untilAborted } from '../../run/helpers.ts';
import { RunStatus } from '../../run/constants.ts';
import type { RunContext, Step, Usage } from '../../run/types.ts';
import {
    resolveBudget,
    stepTokens,
    timeoutSignal,
    tokensExceeded,
} from '../budget.ts';
import {
    assembleTools,
    budgetExceeded,
    executePendingCall,
    incompleteOutput,
    initialMessage,
    lastAssistantText,
    outputContext,
    pendingToolCalls,
    refusedCallError,
    toRunError,
    toToolResultPart,
    toValidationError,
    unansweredToolNames,
    withToolResults,
    withoutPartialOutput,
    withoutResults,
} from './helpers.ts';
import type { ApprovalRequest, ExecuteContext } from './types.ts';

/**
 * One execution of a claimed, `running` run: first runs the tool calls a
 * suspended approve() left pending in the latest checkpoint (pausing again,
 * without a model call, when one suspends again), then streams a
 * ToolLoopAgent from there (emitting text and reasoning deltas), checkpoints
 * every step and settles the run, or pauses it on the first call an
 * approve() suspended.
 */
export async function executeRun(ctx: ExecuteContext): Promise<void> {
    const {
        run,
        agent,
        store,
        clock,
    } = ctx;
    const budget = resolveBudget(agent);
    const checkpoint = await store.latestCheckpoint(run.id);
    // stored form: file parts hold artifact markers; the model gets a hydrated copy
    let initial: ModelMessage[] = checkpoint?.messages ?? [...(ctx.conversation?.snapshot.messages ?? []), initialMessage(run.trigger)];
    const usage: Usage = { ...run.usage };
    let stepIndex = checkpoint ? checkpoint.stepIndex + 1 : 0;
    let stepSeq = (await store.listSteps(run.id)).length;

    // calls a suspended approve() left without a result: run before any model call
    const pending = checkpoint ? pendingToolCalls(checkpoint.messages) : [];

    // a resumed approval gets exactly one step beyond maxSteps, so an approval
    // granted (or denied) on the last allowed step still runs and is answered
    const extraSteps = pending.length > 0 ? 1 : 0;
    const remainingSteps = budget.maxSteps + extraSteps - stepIndex;
    if (remainingSteps <= 0) {
        // the step limit was reached by an earlier execution that did not settle the run
        if (checkpoint && checkpoint.finishReason !== 'tool-calls') {
            const text = lastAssistantText(checkpoint.messages);
            const { output } = agent.definition;
            if (!output) {
                await ctx.finish({ status: RunStatus.COMPLETED, output: text });
                return;
            }
            const incomplete = incompleteOutput(checkpoint.finishReason);
            if (incomplete) {
                await ctx.finish({ status: RunStatus.FAILED, error: toRunError(incomplete) });
                return;
            }
            try {
                const parsed: unknown = await output.parseCompleteOutput({ text }, outputContext(checkpoint, clock.now()));
                await ctx.finish({ status: RunStatus.COMPLETED, output: parsed });
            } catch (error) {
                await ctx.finish({ status: RunStatus.FAILED, error: toRunError(toValidationError(error)) });
            }
        } else {
            await ctx.finish({ status: RunStatus.FAILED, error: toRunError(budgetExceeded(budget, 'steps')) });
        }
        return;
    }

    let prompt: ModelMessage[];
    try {
        prompt = await hydrateMessages(initial, store);
    } catch (error) {
        if (!(error instanceof ArtifactNotFoundError)) throw error;
        await ctx.finish({ status: RunStatus.FAILED, error: toRunError(error) });
        return;
    }

    const timeout = budget.timeoutMs === undefined ? undefined : timeoutSignal(clock, budget.timeoutMs);
    // aborted on every exit, so a stream left unread (e.g. a throw while consuming it) is cancelled
    const local = new AbortController();
    const signal = AbortSignal.any([ctx.signal, local.signal, ...(timeout ? [timeout.signal] : [])]);
    const runContext: RunContext = {
        runId: run.id,
        agent: run.agent,
        trigger: run.trigger,
        signal,
    };
    bindRunSnapshot(runContext);
    if (ctx.conversation) bindConversationRun(runContext, ctx.conversation.capability, run);

    // the calls approve() suspended in this execution, in the order they suspended
    const suspended: ApprovalRequest[] = [];
    // while the pending calls run they belong to the checkpoint's step, later ones to the step being made
    let replaying = pending.length > 0;
    let assembled: ReturnType<typeof assembleTools>;
    let model: LanguageModel;
    try {
        model = toLanguageModel(ctx.model, ctx.models, agent.name);
        assembled = assembleTools(ctx, runContext, (request) => {
            suspended.push(request);
        }, () => (replaying ? checkpoint!.stepIndex : stepIndex));
    } catch (error) {
        local.abort();
        timeout?.clear();
        if (!(error instanceof InvalidAgentDefinitionError)) throw error;
        await ctx.finish({ status: RunStatus.FAILED, error: toRunError(error) });
        return;
    }
    const {
        tools,
        activeTools,
        toolsContext,
    } = assembled;

    const responseMessages: ModelMessage[] = [];
    // AI SDK swallows onStepEnd errors; a fatal one is kept here and stops the loop
    let fatal: { error: unknown } | undefined;
    // set once the run settles on abort; a still running stream must not write anymore
    let abandoned = false;
    let pendingStepEnd: Promise<void> = Promise.resolve();
    let stepStartedAt = clock.now();
    // the approval the last step suspended on (the first in call order); the loop stops on it
    let approval: ApprovalRequest | undefined;
    // set when the provider's finish part arrived for the current step; without
    // it the AI SDK synthesizes a finish ('other') and never runs the step's tools
    let modelCallEnded = false;

    /**
     * Runs a store write unless the execution was abandoned meanwhile or lost
     * the run. An abort alone does not stop it: a step that completed before a
     * drain or cancel still lands whole (its tool rows and checkpoint), so a
     * recovery does not re-run it. `checkOwner: false` skips the ownership read
     * for writes that are owner-conditional in the store already (ctx.update).
     */
    const guarded = async (write: () => Promise<void>, { checkOwner = true } = {}): Promise<boolean> => {
        if (abandoned) return false;
        if (checkOwner && ctx.ownsRun && !await ctx.ownsRun()) return false;
        if (abandoned) return false;
        await write();
        return true;
    };

    const append = async (step: Omit<Step, 'runId' | 'index'>) => {
        const full: Step = {
            ...step,
            runId: run.id,
            index: stepSeq,
        };
        if (await guarded(() => store.appendStep(full))) {
            stepSeq++;
            ctx.onStepAppended(full);
        }
    };

    const handleStepEnd = async (step: StepResult<ToolSet>) => {
        const complete = modelCallEnded;
        modelCallEnded = false;
        try {
            const finishedAt = clock.now();
            const tokens = stepTokens(step);
            await append({
                kind: 'llm',
                name: step.model.modelId,
                output: {
                    text: step.text,
                    toolCalls: step.toolCalls.map((call) => ({
                        toolCallId: call.toolCallId,
                        toolName: call.toolName,
                        input: call.input,
                    })),
                    finishReason: step.finishReason,
                    usage: tokens,
                },
                startedAt: stepStartedAt,
                finishedAt,
            });
            // the suspended calls stay pending: no tool step, no result in the checkpoint
            const suspendedIds = new Set(suspended.map((request) => request.toolCallId));
            for (const part of step.content) {
                if ((part.type === 'tool-result' || part.type === 'tool-error') && suspendedIds.has(part.toolCallId)) continue;
                if (part.type === 'tool-result') {
                    await append({
                        kind: 'tool',
                        name: part.toolName,
                        input: part.input,
                        output: part.output,
                        startedAt: stepStartedAt,
                        finishedAt,
                    });
                } else if (part.type === 'tool-error') {
                    await append({
                        kind: 'tool',
                        name: part.toolName,
                        input: part.input,
                        error: toRunError(refusedCallError(step, part, tools, activeTools) ?? part.error),
                        startedAt: stepStartedAt,
                        finishedAt,
                    });
                    // other tool errors go back to the model as tool-error results
                    if (part.error instanceof FatalToolError) fatal ??= { error: part.error };
                }
            }
            let { messages }: { messages: ModelMessage[] } = step.response;
            if (suspendedIds.size > 0) {
                messages = withoutResults(messages, suspendedIds);
                const order = step.toolCalls.map((c) => c.toolCallId);
                approval = suspended
                    .filter((request) => order.includes(request.toolCallId))
                    .sort((a, b) => order.indexOf(a.toolCallId) - order.indexOf(b.toolCallId))[0] ?? suspended[0];
            }
            responseMessages.push(...messages);
            await guarded(() => store.saveCheckpoint({
                runId: run.id,
                stepIndex: stepIndex++,
                messages: [...initial, ...responseMessages],
                finishReason: step.finishReason,
                ...(ctx.conversation ? {
                    conversation: {
                        scopeId: ctx.conversation.snapshot.scope.id,
                        generation: ctx.conversation.snapshot.scope.generation,
                        snapshotRunId: run.id,
                    },
                } : {}),
                createdAt: finishedAt,
            }));
            usage.inputTokens += tokens.inputTokens;
            usage.outputTokens += tokens.outputTokens;
            await guarded(async () => {
                await ctx.update({ usage: { ...usage }, updatedAt: clock.now() });
            }, { checkOwner: false });
            stepStartedAt = clock.now();
            // an error part ends the step with 'error' and fails the run with that error
            if (!complete && step.finishReason === 'other') {
                fatal ??= { error: new IncompleteResponseError('The model stream ended without a finish part.') };
            }
        } catch (error) {
            fatal ??= { error };
        }
    };

    // the write of the pending call that finished last; an abort waits for it before settling
    let pendingWrite: Promise<void> = Promise.resolve();

    /**
     * Runs the pending calls in call order. After each finished call the
     * checkpoint (under its own index, replacing it) gets the call's result
     * before its tool step is appended, so a drain, crash or lost lease
     * after that call never runs it again. Stops before the next call once
     * the execution was aborted. Resolves `paused` when a call suspended
     * again (the results before it are kept), `failed` on a FatalToolError
     * result.
     */
    const runPending = async (): Promise<'paused' | 'failed' | 'done'> => {
        for (const call of pending) {
            if (signal.aborted) return 'done';
            const startedAt = clock.now();
            const result = await executePendingCall({
                call,
                tools,
                activeTools,
                toolsContext,
                messages: prompt,
                signal,
            });
            if (suspended.length > 0) return 'paused';
            const finishedAt = clock.now();
            pendingWrite = (async () => {
                const part = await toToolResultPart(call, Object.hasOwn(tools, call.toolName) ? tools[call.toolName] : undefined, result);
                initial = withToolResults(initial, [part]);
                prompt = withToolResults(prompt, [part]);
                await guarded(() => store.saveCheckpoint({
                    runId: run.id,
                    stepIndex: checkpoint!.stepIndex,
                    messages: initial,
                    ...(checkpoint!.finishReason !== undefined ? { finishReason: checkpoint!.finishReason } : {}),
                    ...(ctx.conversation ? {
                        conversation: {
                            scopeId: ctx.conversation.snapshot.scope.id,
                            generation: ctx.conversation.snapshot.scope.generation,
                            snapshotRunId: run.id,
                        },
                    } : {}),
                    createdAt: finishedAt,
                }));
                await append({
                    kind: 'tool',
                    name: call.toolName,
                    input: call.input,
                    ...('error' in result ? { error: toRunError(result.error) } : { output: result.output }),
                    startedAt,
                    finishedAt,
                });
            })();
            await pendingWrite;
            if ('error' in result && result.error instanceof FatalToolError) {
                fatal ??= { error: result.error };
                return 'failed';
            }
        }
        return 'done';
    };

    const onStepEnd = (step: StepResult<ToolSet>): Promise<void> => {
        pendingStepEnd = handleStepEnd(step);
        return pendingStepEnd;
    };

    if (pending.length > 0) {
        let outcome: Awaited<ReturnType<typeof runPending>>;
        try {
            const work = runPending();
            work.catch(() => {});
            outcome = await untilAborted(work, signal);
        } catch (error) {
            local.abort();
            timeout?.clear();
            // the write of a call that finished before the abort lands before the run settles, never after
            let settled: Promise<void>;
            do {
                settled = pendingWrite;
                await settled.catch(() => {});
            } while (settled !== pendingWrite);
            abandoned = true;
            if (ctx.signal.aborted) {
                await ctx.finish({ status: RunStatus.CANCELLED, usage });
            } else if (timeout?.signal.aborted) {
                await ctx.finish({
                    status: RunStatus.FAILED,
                    usage,
                    error: toRunError(timeout.signal.reason),
                });
            } else {
                await ctx.finish({
                    status: RunStatus.FAILED,
                    usage,
                    error: toRunError(error),
                });
            }
            return;
        }
        replaying = false;
        if (outcome !== 'done') {
            local.abort();
            timeout?.clear();
            if (outcome === 'failed' && fatal) {
                await ctx.finish({
                    status: RunStatus.FAILED,
                    usage,
                    error: toRunError(fatal.error),
                });
            } else {
                await ctx.pause(suspended[0]!, usage);
            }
            return;
        }
    }

    const stopWhen: StopCondition<ToolSet>[] = [
        isStepCount(remainingSteps),
        () => fatal !== undefined,
        // a call approve() suspended ends the loop after its step
        () => suspended.length > 0,
    ];
    const spentTokens = run.usage.inputTokens + run.usage.outputTokens;
    if (budget.maxTokens !== undefined) stopWhen.push(tokensExceeded(budget.maxTokens, spentTokens));

    const loop = new ToolLoopAgent({
        model,
        instructions: agent.definition.instructions,
        tools,
        activeTools,
        // the AI SDK types toolsContext from a concrete tool set; a ToolSet infers none
        toolsContext: toolsContext as never,
        stopWhen,
        // a tool result's artifact marker (artifactFilePart) gets its bytes per model call, never in a stored message
        prepareStep: async ({ messages }) => ({ messages: await hydrateMessages(messages, store) }),
        onLanguageModelCallEnd: () => {
            modelCallEnded = true;
        },
        onStepEnd,
        output: agent.definition.output ? withoutPartialOutput(agent.definition.output) : undefined,
    });

    // stream steps seen so far; a step's deltas belong to the checkpoint index it is saved under
    const firstStepIndex = stepIndex;
    let streamStep = -1;
    const consume = async () => {
        // onError is no typed agent stream parameter but reaches streamText; the
        // error is the run's, so the AI SDK's default console logging is muted
        const options = {
            messages: prompt,
            abortSignal: signal,
            onError: () => {},
        };
        const stream = await loop.stream(options);
        // the first stream error fails the run, as a rejected generate did
        let streamError: { error: unknown } | undefined;
        for await (const part of stream.fullStream) {
            if (part.type === 'start-step') {
                streamStep++;
            } else if (part.type === 'text-delta' || part.type === 'reasoning-delta') {
                if (!abandoned) {
                    ctx.onDelta({
                        runId: run.id,
                        step: firstStepIndex + Math.max(streamStep, 0),
                        kind: part.type === 'text-delta' ? 'text' : 'reasoning',
                        text: part.text,
                    });
                }
            } else if (part.type === 'error') {
                streamError ??= { error: part.error };
            }
        }
        if (streamError) throw streamError.error;
        const [steps, finishReason, text] = await Promise.all([stream.steps, stream.finishReason, stream.text]);
        // Keep normal sends alive until their journal settles; cancellation still exits via untilAborted.
        await ctx.conversation?.capability.idle(run.id);
        return {
            stream,
            steps,
            finishReason,
            text,
        };
    };

    let result: Awaited<ReturnType<typeof consume>>;
    try {
        const work = consume();
        // the agent may keep running after an abort; never leak its rejection
        work.catch(() => {});
        result = await untilAborted(work, signal);
    } catch (error) {
        // stop the model work right away; the cause is read from ctx.signal, timeout and fatal
        local.abort();
        // the step-end writes in flight land completely before the run settles, never after
        let settled: Promise<void>;
        do {
            settled = pendingStepEnd;
            await settled;
        } while (settled !== pendingStepEnd);
        abandoned = true;
        if (ctx.signal.aborted) {
            await ctx.finish({ status: RunStatus.CANCELLED, usage });
        } else if (timeout?.signal.aborted) {
            await ctx.finish({
                status: RunStatus.FAILED,
                usage,
                error: toRunError(timeout.signal.reason),
            });
        } else {
            await ctx.finish({
                status: RunStatus.FAILED,
                usage,
                error: toRunError(fatal ? fatal.error : error),
            });
        }
        return;
    } finally {
        local.abort();
        timeout?.clear();
    }

    if (fatal) {
        await ctx.finish({
            status: RunStatus.FAILED,
            usage,
            error: toRunError(fatal.error),
        });
        return;
    }
    if (ctx.signal.aborted) {
        await ctx.finish({ status: RunStatus.CANCELLED, usage });
        return;
    }
    if (approval) {
        await ctx.pause(approval, usage);
        return;
    }

    // the loop ended on a budget stop condition while the model still wanted tools
    const outOfSteps = result.steps.length >= remainingSteps;
    const outOfTokens = budget.maxTokens !== undefined && usage.inputTokens + usage.outputTokens >= budget.maxTokens;
    if (result.finishReason === 'tool-calls' && (outOfSteps || outOfTokens)) {
        await ctx.finish({
            status: RunStatus.FAILED,
            usage,
            error: toRunError(budgetExceeded(budget, outOfSteps ? 'steps' : 'tokens')),
        });
        return;
    }

    // a plain agent keeps the text it got (cut, or before a call nothing executed)
    if (!agent.definition.output) {
        await ctx.finish({
            status: RunStatus.COMPLETED,
            usage,
            output: result.text,
        });
        return;
    }
    const incomplete = incompleteOutput(result.finishReason, unansweredToolNames(result.steps.at(-1)));
    if (incomplete) {
        await ctx.finish({
            status: RunStatus.FAILED,
            usage,
            error: toRunError(incomplete),
        });
        return;
    }
    let output: unknown;
    try {
        output = await result.stream.output;
    } catch (error) {
        await ctx.finish({
            status: RunStatus.FAILED,
            usage,
            error: toRunError(toValidationError(error)),
        });
        return;
    }
    await ctx.finish({
        status: RunStatus.COMPLETED,
        usage,
        output,
    });
}
