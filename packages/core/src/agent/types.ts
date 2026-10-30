/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { OutputInterface, ToolSet } from 'ai';
import type { ChannelSubscription } from '../channel/types.ts';
import type { AssistantModelMessage, SystemModelMessage, UserModelMessage } from '../message/types.ts';
import type { ModelRef } from '../model/types.ts';
import type { Budget, RunContext } from '../run/types.ts';
import type { StateSchema } from '../state/types.ts';
import type { SkillInput } from '../skill/types.ts';
import type { ToolContext } from '../tool/types.ts';

/** The factory's argument: the same ToolContext the run's chamvi tools get. */
export type ToolFactoryContext<S extends StateSchema = StateSchema> = ToolContext<S>;

/**
 * Decides per tool name whether a run may use a tool. A refused tool is not
 * offered to the model (it is left out of `activeTools`). A call to it that
 * still arrives is a tool error, never a run failure, and its tool step
 * records `tool_not_allowed` (ToolNotAllowedError) on both paths:
 * - the model calls it anyway: the AI SDK answers the model with its
 *   unavailable-tool error (NoSuchToolError), the engine records the step
 *   as ToolNotAllowedError;
 * - a call pending on an approval (the policy changed before the resume)
 *   reaches the engine's per-call re-check, which answers the model with
 *   ToolNotAllowedError.
 * Should depend only on the run snapshot (e.g. `run.trigger.invoker`), so
 * the tool set is stable across executions.
 */
export type ToolPolicy = (toolName: string, ctx: { run: RunContext }) => boolean;

/** A tool call as the agent hooks see it. */
export type ToolCallInfo = {
    toolName: string;
    toolCallId: string;
    input: unknown;
};

/**
 * Gates and rewrites for every tool call of the agent's merged set (user,
 * chamvi, state and third-party tools alike), run inside the tool-call frame
 * with the execution's ToolContext (`inject` works there).
 */
export type AgentHooks = {
    /**
     * Runs before the effect lookup and returns the input to execute with
     * (`undefined` keeps it). A changed input is re-validated against the
     * tool's input schema (a failure is a ValidationError tool error) and is
     * what the effect key is computed from. A throw is a tool error
     * (ToolDeniedError for a refusal); a FatalToolError fails the run.
     */
    beforeToolExecution?(call: ToolCallInfo, ctx: ToolContext): unknown | Promise<unknown>;
    /**
     * Runs on a fresh result and on a recorded effect result alike and returns
     * the output the model sees (`undefined` keeps it). A streaming tool's
     * hook gets its final value. Not called for a tool error.
     */
    afterToolExecution?(call: ToolCallInfo & { output: unknown }, ctx: ToolContext): unknown | Promise<unknown>;
};

/** Trusted configured messages; tool-role messages are never instruction inputs. */
export type AgentInstruction = SystemModelMessage | UserModelMessage | AssistantModelMessage;

/** A string is shorthand for one system message. Arrays retain their authored order. */
export type AgentInstructions = string | readonly AgentInstruction[];

export type AgentDefinition<S extends StateSchema = StateSchema> = {
    name: string;
    /**
     * `'<provider>/<model id>'` (resolved through EngineOptions.models) or a
     * LanguageModel object; without it the agent uses EngineOptions.model.
     */
    model?: ModelRef;
    instructions: AgentInstructions;
    readonly skills?: readonly SkillInput[];
    /**
     * The channels that start the agent's runs (e.g. `cron.on('0 8 * * 1-5')`);
     * every subscription names a channel registered on the engine, ids are
     * unique per agent.
     */
    channels?: ChannelSubscription[];
    /** Shared-store execution cap across all channels; omitted or false adds no cap. */
    concurrencyMaxRuns?: number | false;
    /**
     * The agent's tools: a plain `ToolSet` (the default), or a factory for
     * dynamic sets, called once per execution with the same ToolContext the
     * tools get. Tools built with `defineTool`/`defineEffectTool` receive that
     * context as `context` in `execute`.
     */
    tools?: ToolSet | ((ctx: ToolContext<S>) => ToolSet);
    /**
     * Per tool name, the context of a tool that is not chamvi's (e.g. a
     * third-party tool with its own `contextSchema`), passed through unchanged
     * by reference to every call of every run: treat it as immutable. An entry
     * naming a chamvi tool or no tool is an InvalidAgentDefinitionError (at
     * defineAgent for a plain set, a failed run for a factory).
     */
    toolsContext?: Record<string, unknown>;
    /**
     * Tool hooks (see AgentHooks). AI SDK tools declaring their own
     * `needsApproval` are refused (nothing answers that request).
     */
    hooks?: AgentHooks;
    /** Filters the merged tool set (state tools included) per run, e.g. requireToolPermission(). */
    toolPolicy?: ToolPolicy;
    /** Record<collection, StandardSchemaV1>. */
    state?: S;
    budget?: Partial<Budget>;
    /**
     * Structured output (AI SDK `Output`, e.g. `Output.object({ schema })`):
     * a completed run's `output` is the parsed value instead of the text; a
     * final answer that does not parse fails the run with a ValidationError.
     */
    output?: OutputInterface;
};

export type Agent<S extends StateSchema = StateSchema> = {
    readonly name: string;
    readonly definition: Required<Pick<AgentDefinition<S>, 'budget'>> & AgentDefinition<S>;
};

/**
 * The revision marker of a folder agent: the content hash of its folder
 * (never its code) and when that hash was recorded.
 */
export type AgentRevision = {
    agent: string;
    hash: string;
    changedAt: Date;
};
