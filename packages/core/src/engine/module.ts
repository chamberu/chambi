/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { pid } from 'node:process';
import type { Agent } from '../agent/types.ts';
import { conversationKey } from '../agent/asserts.ts';
import { approvalDecisionKey, assertSelectionShape, toSelection } from '../approval/helpers.ts';
import { assertArtifactInput } from '../artifact/helpers.ts';
import { attachmentIds, storeArtifact } from '../artifact/module.ts';
import { assertConcurrencyMaxRuns } from '../channel/concurrency.ts';
import { assertChannelName, assertDefaultAddress } from '../channel/helpers.ts';
import type {
    ChannelContext,
    ChannelDispatchEnvelope,
    DispatchResult,
    IChannel,
} from '../channel/types.ts';
import { Conversations } from '../conversation/module.ts';
import { ConversationOperation } from '../conversation/constants.ts';
import {
    assertConversationIdentity,
    assertConversationText,
    identityId,
} from '../conversation/persistence/module.ts';
import { conversationConcurrencyKey } from '../conversation/helpers.ts';
import type {
    ConversationBinding,
    ConversationIdentity,
    ConversationInspection,
    ConversationScope,
    ConversationTarget,
    IConversations,
} from '../conversation/types.ts';
import { systemClock } from '../clock/index.ts';
import type { IClock } from '../clock/index.ts';
import { contextKeyName, isContextKey } from '../context/helpers.ts';
import type { ContextKey } from '../context/types.ts';
import {
    AgentNotFoundError,
    ChamviError,
    ChannelNotFoundError,
    ErrorCode,
    InvalidAgentDefinitionError,
    InvalidRunStateError,
    LeaseLostError,
    ValidationError,
} from '../errors/index.ts';
import { RunStatus } from '../run/constants.ts';
import type {
    Run,
    Step,
    Usage,
    WaitPoint,
} from '../run/types.ts';
import { HANDOFF_CONTEXT } from '../handoff/constants.ts';
import type { HandoffHost } from '../handoff/types.ts';
import { assertHandoffSubscription } from '../handoff/helpers.ts';
import { MODEL_CONTEXT } from '../model/constants.ts';
import { checkAgentModel, checkDefaultModel } from '../model/module.ts';
import type { IModelResolver, ModelContext, ModelRef } from '../model/types.ts';
import { EngineSkills } from './skills/module.ts';
import type { IEngineSkills } from './skills/types.ts';
import type { IStore } from '../repository/types.ts';
import { idempotencyScope, toInvoker } from '../trigger/helpers.ts';
import { assertTriggerKey } from '../trigger/key.ts';
import type { TriggerEnvelope, TriggerParent } from '../trigger/types.ts';
import {
    APPROVAL_TIMED_OUT,
    DEFAULT_DRAIN_TIMEOUT_MS,
    IDEMPOTENCY_TTL_MS,
} from './constants.ts';
import { toRunError } from './execute/helpers.ts';
import { executeRun } from './execute/module.ts';
import type { ApprovalRequest } from './execute/types.ts';
import { RunQueue } from './queue/module.ts';
import { agentCancelReason } from './registry/helpers.ts';
import {
    cancelAgentRuns,
    claimRevision,
    dropRevision,
    syncRevision,
} from './registry/module.ts';
import type { CancelReason, RegistryContext } from './registry/types.ts';
import type {
    ApprovalAnswer,
    DispatchEnvelope,
    EngineEvent,
    EngineOptions,
    EngineStartOptions,
    IEngine,
} from './types.ts';

/** What `answer()` records: an `ApprovalAnswer` without its approval id. */
type ApprovalDecisionInput = Omit<ApprovalAnswer, 'approvalId'>;

export class Engine implements IEngine {
    /** Persistence capabilities, independently replaceable by packages built on the engine. */
    readonly store: IStore;

    protected readonly agents: Map<string, Agent>;

    /** The revision each registered agent was loaded at; undefined for a code agent. */
    protected readonly revisions = new Map<string, string | undefined>();

    /** Agents whose revision marker this engine is moving: none of their runs starts here meanwhile. */
    protected readonly syncing = new Set<string>();

    /** Agents removed here whose store cleanup is still to finish, with the revision they had. */
    protected readonly removals = new Map<string, string | undefined>();

    /** The registered channels by name, in registration order. */
    protected readonly channels: Map<string, IChannel<any, any>>;

    /** Channels started by the last start(), until a drain() or stop() stops them. */
    protected startedChannels: IChannel<any, any>[] = [];

    /** The stop of the channels started last, shared by drain() and stop(). */
    protected stoppingChannels: Promise<void> | undefined;

    protected readonly owner: string;

    /** Every time-based decision of the engine; packages built on it share it. */
    readonly clock: IClock;

    protected readonly queue: RunQueue;

    protected readonly conversations?: IConversations;

    protected readonly claimTtlMs: number;

    /** The default model of agents without one (EngineOptions.model). */
    protected readonly model?: ModelRef;

    /** Resolves string model refs (EngineOptions.models). */
    protected readonly models?: IModelResolver;

    protected readonly listeners = new Set<(e: EngineEvent) => void>();

    protected readonly onError: (error: unknown, run?: Run) => void;

    /**
     * Runs executing in this process, by id. `stop` says why the execution was
     * aborted: cancel settles it `cancelled`, drain `interrupted`, and after a
     * lost lease it writes nothing at all.
     */
    protected readonly executions = new Map<string, {
        controller: AbortController;
        done: Promise<void>;
        stop?: 'cancel' | 'drain' | 'lease-lost';
        /** What a cancel by the registry stores on the run when it settles `cancelled`. */
        cancelReason?: CancelReason;
    }>();

    /**
     * Approval deliveries started by a pause, detached from the execution so
     * a slow channel holds neither the slot nor the executions entry (a resume
     * meanwhile starts the next execution); idle() and drain() wait for them.
     */
    protected readonly deliveries = new Set<Promise<void>>();

    protected readonly deliveryControllers = new Set<AbortController>();

    protected started = false;

    protected draining = false;

    protected lastCreatedAt = 0;

    /** Values tools reach through inject(ctx, key), by reference. */
    protected readonly provided = new Map<ContextKey<unknown>, unknown>();

    protected readonly skills: IEngineSkills;

    protected readonly preparing = new Set<Promise<void>>();

    protected preparationController = new AbortController();

    protected startup?: {
        controller: AbortController;
        signal: AbortSignal;
        done: Promise<void>
    };

    protected stopping?: Promise<void>;

    constructor(opts: EngineOptions) {
        this.skills = new EngineSkills(opts.skills);
        this.store = opts.store;

        if (opts.conversations !== undefined) {
            if (!opts.store.conversations) {
                throw new InvalidAgentDefinitionError('Conversations need store.conversations.');
            }

            this.conversations = new Conversations(
                opts.conversations,
                opts.store.conversations,
                opts.store.runs,
                opts.store.effects,
            );
        }

        this.agents = new Map(opts.agents.map((a) => [a.name, a]));

        const channels = opts.channels ?? [];

        this.channels = new Map();

        for (const channel of channels) {
            assertChannelName(channel.name);
            assertDefaultAddress(channel);

            if (this.channels.has(channel.name)) {
                throw new InvalidAgentDefinitionError(`The channel "${channel.name}" is registered more than once.`);
            }

            this.channels.set(channel.name, channel);
        }

        this.owner = opts.owner ?? `${hostname()}-${pid}`;
        this.clock = opts.clock ?? systemClock;
        this.claimTtlMs = opts.claimTtlMs ?? 60_000;

        if (this.agents.size !== opts.agents.length) {
            const seen = new Set<string>();
            const duplicate = opts.agents.find((a) => seen.size === seen.add(a.name).size);
            throw new InvalidAgentDefinitionError(`Agent name "${duplicate?.name}" is used more than once.`);
        }

        this.model = opts.model;
        this.models = opts.models;
        checkDefaultModel({ model: this.model, models: this.models });
        // set directly: the key is module-private, so no provide() can collide
        this.provided.set(MODEL_CONTEXT, {
            model: this.model,
            models: this.models,
            agentModel: (name: string) => this.agents.get(name)?.definition.model,
        } satisfies ModelContext);

        this.provided.set(HANDOFF_CONTEXT, this.createHandoffHost());

        for (const agent of opts.agents) {
            this.assertRegistrable(agent);
        }

        // eslint-disable-next-line no-console
        this.onError = opts.onError ?? ((error) => console.error('[chamvi]', error));

        this.queue = new RunQueue({
            store: this.store,
            getAgent: (name) => this.getAgent(name),
            clock: this.clock,
            owner: this.owner,
            concurrencyMaxRuns: opts.concurrencyMaxRuns ?? 4,
            claimTtlMs: this.claimTtlMs,
            execute: (run) => this.guardedExecute(run),
            onError: (error, run) => this.onError(error, run),
            onRunUpdated: (run) => this.emit({ type: 'run.updated', run }),
            onPoll: async () => {
                await this.tick();
                await this.recover();
            },
            onLeaseLost: (runId) => this.loseLease(runId),
            prepareStart: () => this.prepareStart(),
        });
    }

    async dispatch(envelope: DispatchEnvelope): Promise<{ runId: string; deduplicated: boolean }> {
        // a JS caller may pass a parent anyway: dropped, so nobody forges lineage
        const rest: DispatchEnvelope & { parent?: unknown; conversation?: unknown } = { ...envelope };

        delete rest.parent;
        delete rest.conversation;

        return this.createRun(rest);
    }

    /**
     * dispatch()'s body; `parent` comes only from this argument (the
     * hand-off host), never from the envelope.
     */
    protected async createRun(
        envelope: DispatchEnvelope,
        parent?: TriggerParent,
        conversation?: ConversationBinding,
    ): Promise<{ runId: string; deduplicated: boolean }> {
        if (!this.agents.has(envelope.agent)) {
            throw new AgentNotFoundError(envelope.agent);
        }

        // Also strip forged fields from handoff and internal envelope spreads.
        const safe: DispatchEnvelope & { conversation?: unknown; parent?: unknown } = { ...envelope };

        delete safe.conversation;
        delete safe.parent;

        const {
            attachments,
            invoker,
            ...rest
        } = safe as DispatchEnvelope;

        // before any store write: an invalid attachment stores nothing
        if (attachments !== undefined && !Array.isArray(attachments)) {
            throw new ValidationError('The attachments must be an array.');
        }

        attachments?.forEach((attachment, i) => assertArtifactInput(attachment, `attachment ${i}`));
        assertTriggerKey('idempotency key', envelope.idempotencyKey);
        assertTriggerKey('concurrency key', envelope.concurrencyKey);
        assertTriggerKey('address', envelope.address);

        const snapshot = invoker !== undefined ? toInvoker(invoker) : undefined;
        const now = this.nextCreatedAt();
        const trigger: TriggerEnvelope = {
            ...rest,
            ...(snapshot ? { invoker: snapshot } : {}),
            ...(parent ? { parent: { ...parent } } : {}),
            id: envelope.id ?? randomUUID(),
            receivedAt: envelope.receivedAt ?? now,
        };
        let runId: string = randomUUID();

        if (trigger.idempotencyKey !== undefined) {
            const claimed = await this.store.idempotency.claim(
                idempotencyScope(conversation ? {
                    ...trigger,
                    agent: conversation.scope.identity.agent,
                    channel: `${trigger.channel}:conversation:${conversation.scope.id}`,
                } : trigger),
                trigger.idempotencyKey,
                runId,
                IDEMPOTENCY_TTL_MS,
            );

            if (!claimed.created) {
                const original = await this.store.runs.findOne(claimed.runId);

                if (original) {
                    if (conversation && original.conversation?.scope.id !== conversation.scope.id) {
                        throw new ValidationError('The duplicate run belongs to another conversation.');
                    }

                    return { runId: claimed.runId, deduplicated: true };
                }

                // shortcut: post-reset reservations cannot heal, persist generations when automatic recovery is required.
                if (conversation && conversation.scope.generation > 0) {
                    throw new InvalidRunStateError('The reserved conversation run is missing and its original generation cannot be proven after reset.');
                }

                // the key's run was never created (createRun failed after the claim, or is
                // still in flight): create it under the reserved id; createRun decides the race
                runId = claimed.runId;
            }
        }

        if (attachments?.length) {
            // stored before the run, so an executing run finds them; a crash in between leaves orphans.
            // Ids derive from the run id: a concurrent healer of the same run writes no-ops.
            const ids = attachmentIds(runId, attachments.length);

            trigger.attachments = [];

            for (const [i, attachment] of attachments.entries()) {
                trigger.attachments.push(await storeArtifact(
                    this.store.artifacts,
                    { id: runId, agent: trigger.agent },
                    attachment,
                    now,
                    ids[i],
                ));
            }
        }

        const run: Run = {
            id: runId,
            agent: trigger.agent,
            status: RunStatus.QUEUED,
            trigger,
            concurrencyKey: trigger.concurrencyKey,
            address: trigger.address,
            usage: { inputTokens: 0, outputTokens: 0 },
            createdAt: now,
            updatedAt: now,
        };

        if (conversation) {
            run.conversation = structuredClone(conversation);
        }

        if (!await this.store.runs.insert(run)) {
            return { runId, deduplicated: true };
        }

        this.emit({ type: 'run.updated', run });

        if (this.started) {
            void this.queue.pump();
        }

        return { runId, deduplicated: false };
    }

    protected conversationCapability(): IConversations {
        if (!this.conversations) {
            throw new ValidationError('Conversation capability is disabled.');
        }

        return this.conversations;
    }

    /** Privileged in-process operator APIs; audit run/checkpoint copies survive deletion. */
    inspectConversation(identity: ConversationIdentity, query?: { limit?: number; offset?: number }): Promise<ConversationInspection | undefined> {
        return this.conversationCapability().inspect(structuredClone(identity), query);
    }

    async resetConversation(identity: ConversationIdentity, options: { keepNotes?: boolean } = {}): Promise<ConversationScope> {
        const capability = this.conversationCapability();
        const copied = structuredClone(identity);

        await capability.repair(copied);

        return capability.repository.reset(copied, { keepNotes: options.keepNotes ?? false });
    }

    async deleteConversation(identity: ConversationIdentity): Promise<void> {
        const capability = this.conversationCapability();
        const copied = structuredClone(identity);

        await capability.repair(copied);
        await capability.repository.delete(copied);
    }

    pruneConversations(): Promise<void> {
        return this.conversationCapability().prune();
    }

    /**
     * The internal host startHandoff() reaches through inject(): the only
     * dispatch path that sets a run's parent.
     */
    protected createHandoffHost(): HandoffHost {
        const chains = new Map<string, Promise<unknown>>();

        return {
            getAgent: (name) => this.agents.get(name),
            effects: this.store.effects,
            dispatch: (envelope, parent) => this.createRun(envelope, parent),
            serial: (runId, fn) => {
                const previous = chains.get(runId) ?? Promise.resolve();
                const next = previous.then(fn, fn);
                const tail = next.catch(() => {});

                chains.set(runId, tail);
                void tail.then(() => {
                    if (chains.get(runId) === tail) {
                        chains.delete(runId);
                    }
                });

                return next;
            },
            inflight: new Map(),
        };
    }

    /**
     * Provides `value` (by reference, never cloned, stored or serialized) to
     * every execution's tools, tools factory and effect hooks through
     * inject(ctx, key); also after start(). Refuses a key not made by this
     * copy's defineContextKey(), `undefined` and a second value for one key.
     */
    provide<T>(key: ContextKey<T>, value: T): void {
        const name = contextKeyName(key);

        if (!isContextKey(key)) {
            throw new InvalidAgentDefinitionError(
                `Context "${name}" has no key from defineContextKey() of the engine's @chamvi/core: ` +
                'a key from another copy of @chamvi/core (a package that resolved its own) is refused.',
            );
        }

        if (value === undefined) {
            throw new InvalidAgentDefinitionError(`Context "${name}" needs a value.`);
        }

        if (this.provided.has(key)) {
            throw new InvalidAgentDefinitionError(`Context "${name}" is already provided.`);
        }

        this.provided.set(key, value);
    }

    /** Synchronous live registry lookup; no loading, creation or I/O. Missing agents return undefined. */
    getAgent(name: string): Agent | undefined {
        return this.agents.get(name);
    }

    /** The registered agents in registration order, as a new array. */
    listAgents(): Agent[] {
        return this.agents.values().toArray();
    }

    /** Gives a transport a context for the exact registered channel object. */
    channelContext(channel: IChannel): ChannelContext {
        if (this.channels.get(channel.name) !== channel) {
            throw new ValidationError('The channel object is not registered.');
        }

        return {
            engine: this,
            dispatch: (envelope) => this.dispatch({ ...envelope, channel: channel.name }),
            dispatchConversation: (envelope, target) => this.intakeConversation(channel, envelope, target),
        };
    }

    /** Trusted intake belongs to the engine and is bound to the registered channel object. */
    protected async intakeConversation(channel: IChannel, envelope: ChannelDispatchEnvelope, target: ConversationTarget): Promise<DispatchResult> {
        if (this.channels.get(channel.name) !== channel) {
            throw new ValidationError('Conversation intake needs the registered channel object.');
        }

        const capability = this.conversationCapability();
        const copied = structuredClone(target);
        const input = structuredClone(envelope);
        const agent = this.agents.get(input.agent);
        const key = agent && conversationKey(agent.definition);

        if (key === undefined) {
            throw new ValidationError('The agent has not enabled conversations.');
        }

        const identity: ConversationIdentity = {
            agent: key,
            channel: channel.name,
            account: copied?.account,
            chat: copied?.chat,
            audience: copied?.audience,
        };

        assertConversationIdentity(identity);
        assertConversationText(copied?.text, capability.limits.maxItemBytes);

        for (const field of ['id', 'idempotencyKey', 'concurrencyKey', 'address'] as const) {
            if (input[field] !== undefined) {
                assertConversationText(input[field], Number.MAX_SAFE_INTEGER);
            }
        }

        const invoker = input.invoker === undefined ? undefined : toInvoker(input.invoker);

        await capability.allow(ConversationOperation.DISPATCH, identity, input.agent, invoker);

        // Validate caller keys before resolve can create any conversation rows.
        assertTriggerKey('idempotency key', input.idempotencyKey);
        assertTriggerKey('concurrency key', input.concurrencyKey);

        const current = await capability.repository.findOne(identity);
        const proposed = current ?? {
            id: identityId(identity),
            generation: 0,
            identity,
        };

        if (input.concurrencyKey !== undefined && input.concurrencyKey !== conversationConcurrencyKey(proposed)) {
            throw new ValidationError('The conversation concurrency key conflicts with its scope.');
        }

        const scope = await capability.repository.resolve(identity);
        const concurrencyKey = conversationConcurrencyKey(scope);

        if (input.concurrencyKey !== undefined && input.concurrencyKey !== concurrencyKey) {
            throw new ValidationError('The conversation concurrency key conflicts with its scope.');
        }

        return this.createRun({
            ...input,
            channel: channel.name,
            concurrencyKey,
        }, undefined, { scope, text: copied.text });
    }

    /** The registered channel of that name. */
    getChannel(name: string): IChannel | undefined {
        return this.channels.get(name);
    }

    /** The registered channels in registration order, as a new array. */
    listChannels(): IChannel[] {
        return Array.from(this.channels.values());
    }

    /** The revision the registered agent was loaded at (undefined for a code agent). */
    agentRevision(name: string): string | undefined {
        return this.revisions.get(name);
    }

    /**
     * Registers an agent, or replaces the one of the same name in place (a new
     * one goes last). With a `revision` (a folder agent's content hash) the
     * store's revision marker is brought to it under the lock `agents:<name>`:
     * a changed marker cancels the agent's unsettled runs created before the
     * change, once across replicas. Without one, replacing a registered agent
     * cancels its unsettled runs created before now. Emits `agents.changed`,
     * except for the same agent at the same revision (`unchanged`).
     *
     * With `reload: false` (a process that never reloads, e.g. a job) nothing
     * is cancelled: a missing marker is written, a different one moved only
     * while the agent has no unsettled run, else InvalidRunStateError and the
     * agent stays unregistered.
     *
     * A marker at `formerRevision` (the same content hashed by an earlier
     * algorithm) counts as equal: it is moved to `revision` and nothing is
     * cancelled, so a hash change of the loader never cancels runs.
     *
     * `signal` cancels preparation and prevents registry mutation. Once a
     * registry operation starts, it finishes with local publication even if
     * the caller or engine stops, keeping registration and durable state aligned.
     */
    async putAgent(
        agent: Agent,
        options: {
            revision?: string;
            formerRevision?: string;
            reload?: boolean;
            signal?: AbortSignal
        } = {},
    ): Promise<'added' | 'replaced' | 'unchanged'> {
        this.assertRegistrable(agent);
        await this.prepare({ agents: [agent], signal: options.signal });

        const preparationSignal = AbortSignal.any([this.preparationController.signal, ...(options.signal ? [options.signal] : [])]);

        preparationSignal.throwIfAborted();

        const { name } = agent;
        const {
            revision,
            formerRevision,
            reload = true,
        } = options;
        const registered = this.agents.has(name);

        if (registered && this.agents.get(name) === agent && this.revisions.get(name) === revision) {
            return 'unchanged';
        }

        let cancelled: string[] | undefined;

        if (revision !== undefined) {
            this.syncing.add(name);

            try {
                if (reload) {
                    cancelled = await syncRevision(this.registry(), name, revision, formerRevision);
                } else {
                    await claimRevision(this.registry(), name, revision, formerRevision);
                }
            } finally {
                this.syncing.delete(name);
            }
        } else if (registered && reload) {
            cancelled = await cancelAgentRuns(this.registry(), name, agentCancelReason(name, 'replaced'), this.clock.now());
        }

        if (cancelled) {
            this.emit({
                type: 'agents.cancelled',
                name,
                reason: 'agent_replaced',
                ...(revision !== undefined && { revision }),
                runIds: cancelled,
            });
        }

        // Finish a registry operation already started, keeping its marker and local publication consistent.
        const kind = this.agents.has(name) ? 'replaced' : 'added';

        this.agents.set(name, agent);
        this.revisions.set(name, revision);
        this.emit({
            type: 'agents.changed',
            name,
            kind,
        });

        return kind;
    }

    /**
     * Removes an agent: first from this engine (no further dispatch, emits
     * `agents.changed`), then from the store's view under the lock
     * `agents:<name>`: with a stored revision marker (also one this engine
     * never loaded) all its unsettled runs are cancelled and the marker
     * deleted, unless this engine had the agent at another revision (a newer
     * one registered elsewhere); without a marker, the runs of an agent
     * registered here are cancelled. Resolves whether it was registered here.
     */
    async removeAgent(name: string): Promise<boolean> {
        const registered = this.agents.has(name);

        if (registered) {
            this.removals.set(name, this.revisions.get(name));
            this.agents.delete(name);
            this.revisions.delete(name);
            this.emit({
                type: 'agents.changed',
                name,
                kind: 'removed',
            });
        }

        const pending = this.removals.has(name);
        const cancelled = await dropRevision(this.registry(), name, {
            registered: pending,
            ...(pending && { revision: this.removals.get(name) }),
        });

        this.removals.delete(name);

        if (cancelled) {
            this.emit({
                type: 'agents.cancelled',
                name,
                reason: 'agent_removed',
                runIds: cancelled,
            });
        }

        return registered;
    }

    getRun(id: string): Promise<Run | undefined> {
        return this.store.runs.findOne(id);
    }

    on<T extends EngineEvent['type']>(event: T, listener: (e: Extract<EngineEvent, { type: T }>) => void): () => void {
        const wrapped = (e: EngineEvent) => {
            if (e.type === event) {
                listener(e as Extract<EngineEvent, { type: T }>);
            }
        };

        this.listeners.add(wrapped);

        return () => {
            this.listeners.delete(wrapped);
        };
    }

    /** True from drain() until the next start(). */
    get isDraining(): boolean {
        return this.draining;
    }

    /** Prepare registered agents and optional candidates without registering or writing to the store. */
    prepare(options: { signal?: AbortSignal; agents?: readonly Agent[] } = {}): Promise<void> {
        if (this.stopping) {
            return this.stopping.then(() => this.prepare(options));
        }

        if (this.preparationController.signal.aborted) {
            this.preparationController = new AbortController();
        }

        const signal = AbortSignal.any([this.preparationController.signal, ...(options.signal ? [options.signal] : [])]);

        const run = async () => {
            signal.throwIfAborted();

            const agents = [...new Set([...this.agents.values(), ...(options.agents ?? [])])];

            await this.skills.prepare(agents, { signal });
        };

        const done = Promise.try(async () => {
            // Keep external provider code deferred until ownership is registered.
            await Promise.resolve();

            return run();
        });

        this.preparing.add(done);
        void done.then(() => this.preparing.delete(done), () => this.preparing.delete(done));

        return done;
    }

    /**
     * Recovers abandoned runs, starts every channel (in registration order,
     * unless `channels: false`), then starts executing queued runs and
     * polling. A throwing channel start rejects after the channels already
     * started were stopped and polling stopped.
     */
    start(options: EngineStartOptions = {}): Promise<void> {
        if (this.stopping) {
            return this.stopping.then(() => this.start(options));
        }

        if (this.startup && !this.startup.controller.signal.aborted) {
            const attempt = this.startup;

            if (options.signal) {
                const { signal } = options;
                const abort = () => attempt.controller.abort(signal.reason);

                if (signal.aborted) {
                    abort();
                } else {
                    signal.addEventListener('abort', abort, { once: true });
                }

                const remove = () => signal.removeEventListener('abort', abort);

                void attempt.done.then(remove, remove);
            }

            return attempt.done;
        }

        if (this.startup) {
            return this.startup.done.catch(() => {}).then(() => this.start(options));
        }

        if (options.signal?.aborted) {
            return Promise.reject(options.signal.reason);
        }

        if (this.started) {
            return Promise.resolve();
        }

        const controller = new AbortController();
        const signal = AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])]);
        const attempt = {
            controller,
            signal,
            done: Promise.resolve(),
        };

        attempt.done = Promise.try(async () => {
            // Publish the attempt before preparation can invoke external code.
            await Promise.resolve();

            try {
                signal.throwIfAborted();
                await this.prepare({ signal });
                signal.throwIfAborted();
                this.draining = false;
                this.started = true;
                this.queue.resume();
                // Verification failures above propagate; ordinary recovery keeps its existing reporting behavior.
                await this.recover().catch((error: unknown) => this.onError(error));
                signal.throwIfAborted();

                if (options.channels ?? true) {
                    await this.startChannels(signal);
                }

                signal.throwIfAborted();
                this.queue.startPolling();
                await this.queue.pump();
                signal.throwIfAborted();
            } catch (error) {
                this.started = false;
                await this.queue.halt();
                await this.stopChannels();

                throw error;
            } finally {
                if (this.startup === attempt) {
                    this.startup = undefined;
                }
            }
        });

        this.startup = attempt;

        return attempt.done;
    }

    /** Abort admission immediately, then join actual provider and channel work before returning. */
    stop(): Promise<void> {
        if (this.stopping) {
            return this.stopping;
        }

        this.started = false;

        const admission = this.queue.halt();

        this.preparationController.abort();
        this.startup?.controller.abort();

        const startup = this.startup?.done;

        const done = (async () => {
            if (startup) {
                await startup.catch(() => {});
            }

            while (this.preparing.size) {
                await Promise.allSettled([...this.preparing]);
            }

            await admission;
            await this.stopChannels();
        })();

        this.stopping = done;

        void done.then(() => {
            if (this.stopping === done) {
                this.stopping = undefined;
            }
        });

        return done;
    }

    protected async startChannels(signal: AbortSignal): Promise<void> {
        await this.stopChannels();
        signal.throwIfAborted();

        for (const channel of this.channels.values()) {
            if (!channel.start) {
                continue;
            }

            await channel.start(this.channelContext(channel));
            // Record even a late success: startup's internal cleanup must own its stop.
            this.startedChannels.push(channel);
            signal.throwIfAborted();
        }
    }

    /** Stops every started channel once, concurrently; a rejection goes to onError. */
    protected stopChannels(): Promise<void> {
        if (this.startedChannels.length > 0) {
            const channels = this.startedChannels;

            this.startedChannels = [];

            const previous = this.stoppingChannels ?? Promise.resolve();

            this.stoppingChannels = previous.then(async () => {
                const results = await Promise.allSettled(channels.map((channel) => channel.stop?.()));

                for (const result of results) {
                    if (result.status === 'rejected') {
                        this.onError(result.reason);
                    }
                }
            });
        }

        return this.stoppingChannels ?? Promise.resolve();
    }

    /**
     * Requeues every `running` or `interrupted` run whose claim expired (or was
     * released), so its next execution resumes from the latest checkpoint.
     * Runs executing here and runs with a live claim are left alone. Also runs
     * on every poll. Resolves the number of runs requeued.
     */
    async recover(): Promise<number> {
        const { data } = await this.store.runs.find({ status: [RunStatus.RUNNING, RunStatus.INTERRUPTED] });
        let requeued = 0;

        for (const run of data) {
            const execution = this.executions.get(run.id);

            if (execution) {
                // cancel() was called on a replica that does not execute the run
                if (run.cancelRequested) {
                    execution.stop ??= 'cancel';
                    execution.controller.abort();
                }

                continue;
            }

            try {
                // atomic: fails while another owner's claim is live
                if (!await this.store.runs.claim(run.id, this.owner, this.claimTtlMs)) {
                    continue;
                }
            } catch (error) {
                this.onError(error, run);

                continue;
            }

            try {
                const queued = await this.store.runs.update(run.id, {
                    status: RunStatus.QUEUED,
                    claim: undefined,
                    updatedAt: this.clock.now(),
                }, { expectStatus: [RunStatus.RUNNING, RunStatus.INTERRUPTED], expectOwner: this.owner });

                requeued++;
                this.emit({ type: 'run.updated', run: queued });
            } catch (error) {
                // the run settled since it was listed: drop the claim just taken
                await this.store.runs.update(run.id, { claim: undefined }, { expectOwner: this.owner })
                    .catch(() => {});

                if (!(error instanceof InvalidRunStateError)) {
                    this.onError(error, run);
                }
            }
        }

        if (requeued > 0 && this.started) {
            void this.queue.pump();
        }

        return requeued;
    }

    /**
     * Graceful shutdown: stops starting runs (dispatch still stores them
     * `queued`, for another replica), polling and tick; waits up to `timeoutMs`
     * (default 30 000) for in-flight runs, then aborts the rest and marks them
     * `interrupted` with their claim released.
     */
    async drain(opts: { timeoutMs?: number } = {}): Promise<void> {
        this.draining = true;
        // no new inbound before the wait
        await this.stop();
        await this.queue.halt();

        let timer: { clear(): void } | undefined;
        const timedOut = new Promise<true>((resolve) => {
            // keepAlive: the process must not exit before the leftovers are marked interrupted
            timer = this.clock.setTimeout(() => resolve(true), opts.timeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS, { keepAlive: true });
        });

        try {
            const settled = await Promise.race([this.idle().then(() => false as const), timedOut]);

            if (!settled) {
                return;
            }

            while (this.executions.size > 0) {
                const pending = this.executions.values().toArray();

                for (const execution of pending) {
                    execution.stop ??= 'drain';
                    execution.controller.abort();
                }

                await Promise.all(pending.map((execution) => execution.done));
            }

            for (const controller of this.deliveryControllers) {
                controller.abort();
            }

            await this.idle();
        } finally {
            timer?.clear();
        }
    }

    /** Resolves when nothing runs, nothing more can be started and no approval delivery is in flight. */
    async idle(): Promise<void> {
        await this.queue.idle();
        await this.conversations?.idle();

        while (this.deliveries.size > 0) {
            await Promise.all(this.deliveries);
            await this.queue.idle();
        }
    }

    /**
     * Cancels a run: aborts it when it executes in this process (resolving once
     * it settled), or marks a queued or waiting run cancelled. A run `running`
     * on another replica (or `interrupted`) gets `cancelRequested`: its owner
     * aborts it on the next poll (within claimTtlMs / 3), and a recovered
     * execution settles it cancelled without a model call. Throws
     * InvalidRunStateError for a settled run, and when the local execution lost
     * its lease meanwhile: the run was not cancelled and may execute on another
     * owner now.
     */
    async cancel(runId: string): Promise<void> {
        return this.cancelRun(runId);
    }

    /**
     * cancel() with a reason the run stores as its `error` (the registry's
     * `agent_replaced`/`agent_removed`); a run on another replica gets it with
     * `cancelRequested`, and the owner's settle keeps it.
     */
    protected async cancelRun(runId: string, reason?: CancelReason): Promise<void> {
        const execution = this.executions.get(runId);

        if (execution) {
            execution.stop ??= 'cancel';

            if (reason) {
                execution.cancelReason ??= reason;
            }

            execution.controller.abort();
            await execution.done;

            if (execution.stop === 'lease-lost') {
                throw new InvalidRunStateError(`Run "${runId}" lost its claim while being cancelled; it is no longer executing here.`);
            }

            // the abort cannot stop a pause that was already writing: cancel the run it left waiting
            const run = await this.store.runs.findOne(runId);

            if (run?.status === RunStatus.WAITING || run?.status === RunStatus.QUEUED) {
                await this.cancelStored(runId, [run.status], execution.cancelReason);
            }

            return;
        }

        for (let attempt = 0; ; attempt++) {
            const run = await this.store.runs.findOneOrFail(runId);

            const { status } = run;

            if (status !== RunStatus.QUEUED && status !== RunStatus.WAITING && status !== RunStatus.RUNNING && status !== RunStatus.INTERRUPTED) {
                throw new InvalidRunStateError(`Run "${runId}" is ${status}; it cannot be cancelled.`);
            }

            try {
                if (status === RunStatus.QUEUED || status === RunStatus.WAITING) {
                    await this.cancelStored(runId, [status], reason);
                } else {
                    const updated = await this.store.runs.update(runId, {
                        cancelRequested: true,
                        ...(reason && { error: reason }),
                        updatedAt: this.clock.now(),
                    }, { expectStatus: [status] });

                    this.emit({ type: 'run.updated', run: updated });
                }

                return;
            } catch (error) {
                // the run moved on since it was read (started, paused, settled): decide again
                if (!(error instanceof InvalidRunStateError) || attempt >= 2) {
                    throw error;
                }
            }
        }
    }

    /** Settles a run nobody executes (`expectStatus`) as cancelled, storing `reason` as its error. */
    protected async cancelStored(runId: string, expectStatus: Run['status'][], reason?: CancelReason): Promise<void> {
        await this.conversations?.idle(runId);

        const now = this.clock.now();
        const updated = await this.store.runs.update(
            runId,
            {
                status: RunStatus.CANCELLED,
                ...(reason && { error: reason }),
                waiting: undefined,
                finishedAt: now,
                updatedAt: now,
            },
            { expectStatus },
        );

        this.emit({ type: 'run.updated', run: updated });
        await this.reconcileConversation(updated);
    }

    /**
     * Answers the current wait point of a `waiting` run (the caller authorized
     * the approver) and requeues it. Single use: a second answer of the same
     * wait point throws InvalidRunStateError, as does a run that is not
     * waiting, waits on another approval or whose wait point expired
     * (`tick()` denies that one).
     */
    async approve(runId: string, answer: ApprovalAnswer): Promise<void> {
        const decision: ApprovalDecisionInput = {
            approved: answer.approved,
            ...(answer.reason !== undefined ? { reason: answer.reason } : {}),
            ...(answer.approver !== undefined ? { approver: toInvoker(answer.approver, 'approver') } : {}),
        };

        assertSelectionShape(answer.selected);

        const run = await this.store.runs.findOneOrFail(runId);

        if (run.status !== RunStatus.WAITING || !run.waiting) {
            throw new InvalidRunStateError(`Run "${run.id}" is ${run.status} and not waiting for an approval.`);
        }

        if (run.waiting.approvalId !== answer.approvalId) {
            throw new InvalidRunStateError(`Run "${run.id}" does not wait on approval "${answer.approvalId}".`);
        }

        if (this.clock.now().getTime() >= run.waiting.expiresAt.getTime()) {
            throw new InvalidRunStateError(`Approval "${answer.approvalId}" of run "${run.id}" expired.`);
        }

        const selected = toSelection(run.waiting, answer.approved, answer.selected);

        await this.answer(
            run,
            run.waiting,
            { ...decision, ...(selected !== undefined ? { selected } : {}) },
            () => new InvalidRunStateError(`Run "${run.id}" moved on to another approval.`),
        );
    }

    /**
     * Denies every approval past its expiresAt ('approval timed out') and
     * re-sends the approval message of every other approval not delivered
     * yet (a failed send, or a crash between the pause and the send). Also
     * runs on every poll.
     */
    async tick(): Promise<void> {
        const now = this.clock.now().getTime();
        let resumed = false;
        const { data } = await this.store.runs.find({ status: [RunStatus.WAITING] });

        for (const listed of data) {
            if (!listed.waiting) {
                continue;
            }

            if (listed.waiting.expiresAt.getTime() > now) {
                if (!listed.waiting.notifiedAt) {
                    await this.deliverApproval(listed, listed.waiting);
                }

                continue;
            }

            try {
                // the listing may be stale by now: the run could wait on a newer approval
                const run = await this.store.runs.findOne(listed.id);

                if (run?.status !== RunStatus.WAITING || !run.waiting || run.waiting.expiresAt.getTime() > now) {
                    continue;
                }

                await this.answer(
                    run,
                    run.waiting,
                    { approved: false, reason: APPROVAL_TIMED_OUT },
                    () => new InvalidRunStateError(`Run "${run.id}" moved on to another approval.`),
                );
                resumed = true;
            } catch (error) {
                // answered meanwhile (approve, another replica)
                if (!(error instanceof InvalidRunStateError)) {
                    this.onError(error, listed);
                }
            }
        }

        // A one-shot job may drain next; finish admission of resumed approvals first.
        if (resumed && this.started) {
            await this.queue.pump();
        }
    }

    /**
     * waiting → queued, then the decision is recorded under
     * `approval:<runId>:<approvalId>` (where the suspended approve() finds it
     * when its call runs again) and the `wait` step appended. The transition
     * comes first and is guarded by expectStatus, so only one answer ever
     * records; the run stays claimed by us until the decision landed, so no
     * pass executes it before.
     *
     * `waiting` survives the transition and is cleared only after the decision
     * landed: if we die in between, the run re-pauses on the same wait point, so
     * the approval the owner was asked stays answerable.
     */
    protected async answer(
        run: Run,
        waiting: WaitPoint,
        decision: ApprovalDecisionInput,
        stale: () => Error,
    ): Promise<void> {
        const now = this.clock.now();
        const transitioned = await this.store.runs.update(run.id, {
            status: RunStatus.QUEUED,
            claim: { owner: this.owner, expiresAt: new Date(now.getTime() + this.claimTtlMs) },
            updatedAt: now,
        }, { expectStatus: [RunStatus.WAITING] });

        let queued: Run;

        try {
            // the run may have moved on to another approval since `waiting` was read
            if (transitioned.waiting?.approvalId !== waiting.approvalId) {
                throw stale();
            }

            await this.store.effects.save(approvalDecisionKey(run.id, waiting.approvalId), {
                approved: decision.approved,
                ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
                ...(decision.approver ? { approver: decision.approver } : {}),
                ...(decision.selected !== undefined ? { selected: decision.selected } : {}),
            });

            const step: Step = {
                runId: run.id,
                index: (await this.store.steps.find(run.id)).length,
                kind: 'wait',
                name: waiting.toolName,
                input: {
                    toolCallId: waiting.toolCallId,
                    title: waiting.title,
                    ...(waiting.body !== undefined ? { body: waiting.body } : {}),
                    ...(waiting.options !== undefined ? { options: waiting.options } : {}),
                    ...(waiting.multiple === true ? { multiple: true } : {}),
                },
                output: {
                    approvalId: waiting.approvalId,
                    approved: decision.approved,
                    reason: decision.reason,
                    ...(decision.approver ? { approver: decision.approver } : {}),
                    ...(decision.selected !== undefined ? { selected: decision.selected } : {}),
                },
                startedAt: run.updatedAt,
                finishedAt: now,
            };

            await this.store.steps.insert(step);
            this.emit({ type: 'step.appended', step });
            queued = await this.store.runs.update(run.id, {
                waiting: undefined,
                claim: undefined,
                updatedAt: this.clock.now(),
            }, { expectStatus: [RunStatus.QUEUED] });
        } catch (error) {
            // undo, so the wait point (still on the run) stays answerable
            await this.store.runs.update(run.id, {
                status: RunStatus.WAITING,
                claim: undefined,
                updatedAt: this.clock.now(),
            }, { expectStatus: [RunStatus.QUEUED] }).catch((undoError: unknown) => this.onError(undoError, run));

            throw error;
        }

        this.emit({ type: 'run.updated', run: queued });

        if (this.started) {
            void this.queue.pump();
        }
    }

    /**
     * running → waiting on `request`, releasing claim and slot (a keyed run keeps
     * its key blocked while waiting). Re-pausing on the same approval keeps the
     * wait point, so tokens handed out earlier stay valid.
     */
    protected async pause(run: Run, request: ApprovalRequest, usage: Usage): Promise<void> {
        await this.conversations?.idle(run.id);

        const now = this.clock.now();
        const { timeoutMs, ...asked } = request;
        const waiting: WaitPoint = run.waiting?.approvalId === request.approvalId ?
            run.waiting :
            {
                kind: 'approval',
                ...asked,
                expiresAt: new Date(now.getTime() + timeoutMs),
            };
        const updated = await this.ownedUpdate(run.id, {
            status: RunStatus.WAITING,
            waiting,
            usage,
            claim: undefined,
            updatedAt: now,
        });

        if (!updated) {
            return;
        }

        this.emit({ type: 'run.updated', run: updated });

        // a cancel arrived while pausing (an abort cannot interrupt this write): settle, do not deliver
        const execution = this.executions.get(run.id);

        if (updated.cancelRequested || execution?.stop === 'cancel') {
            await this.cancelStored(run.id, [RunStatus.WAITING], execution?.cancelReason).catch((error: unknown) => {
                if (!(error instanceof InvalidRunStateError)) {
                    this.onError(error, run);
                }
            });

            return;
        }

        if (waiting.notifiedAt) {
            return;
        }

        // detached: the execution ends with the waiting write, so a resume
        // during a slow send starts the next execution cleanly
        const delivery: Promise<void> = this.deliverApproval(updated, waiting)
            .catch((error: unknown) => this.onError(error, updated))
            .finally(() => this.deliveries.delete(delivery));

        this.deliveries.add(delivery);
    }

    /**
     * Sends the approval message of `waiting` through the channel it names
     * (none: inbox and API only, nothing to send) unless it was delivered
     * already: a successful send records `waiting.notifiedAt`. Its key
     * `<runId>:<approvalId>` is fixed once the wait point is stored, so the
     * channel dedupes a send whose record was lost. A store lock `notify:<runId>:<approvalId>` held for one
     * attempt keeps replicas from sending concurrently; the attempt is aborted
     * after claimTtlMs (the lock's TTL). A failed attempt, or a channel the
     * engine does not have, goes to onError and is retried by tick() on the
     * next poll; the run keeps waiting.
     */
    protected async deliverApproval(run: Run, waiting: WaitPoint): Promise<void> {
        if (waiting.channel === undefined) {
            return;
        }

        const channel = this.channels.get(waiting.channel);

        if (!channel || typeof channel.out !== 'function') {
            this.onError(new ChannelNotFoundError(waiting.channel), run);

            return;
        }

        const key = `${run.id}:${waiting.approvalId}`;
        const lockKey = `notify:${key}`;
        const attempt = randomUUID();
        let acquired = false;
        const isCurrent = (current: Run | undefined) => current?.status === RunStatus.WAITING &&
            current.waiting?.approvalId === waiting.approvalId;
        const controller = new AbortController();

        this.deliveryControllers.add(controller);

        const timer = this.clock.setTimeout(() => controller.abort(new ChamviError({
            message: `Channel "${channel.name}" did not deliver approval "${waiting.approvalId}" within ${this.claimTtlMs}ms.`,
            code: ErrorCode.TIMEOUT,
        })), this.claimTtlMs);

        try {
            acquired = await this.store.locks.acquire(lockKey, attempt, this.claimTtlMs);

            if (!acquired) {
                return;
            }

            // another attempt may have delivered it since `run` was read
            const current = await this.store.runs.findOne(run.id);

            if (!isCurrent(current) || current?.waiting?.notifiedAt) {
                return;
            }

            controller.signal.throwIfAborted();

            const aborted = new Promise<never>((_, reject) => {
                if (controller.signal.aborted) {
                    reject(controller.signal.reason);
                }

                controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
            });

            // a transport that ignores the signal must not hold the pause (or tick) forever
            await Promise.race([
                channel.out({
                    kind: 'approval',
                    key,
                    runId: run.id,
                    agent: run.agent,
                    title: waiting.title,
                    body: waiting.body ?? '',
                    approvalId: waiting.approvalId,
                    expiresAt: waiting.expiresAt,
                    ...(waiting.options !== undefined ? { options: waiting.options } : {}),
                    ...(waiting.multiple === true ? { multiple: true } : {}),
                }, waiting.address ?? '', { signal: controller.signal, trigger: run.trigger }),
                aborted,
            ]);

            // answered meanwhile: nothing left to record
            if (!isCurrent(await this.store.runs.findOne(run.id))) {
                return;
            }

            controller.signal.throwIfAborted();

            const notified = await this.store.runs.update(
                run.id,
                { waiting: { ...waiting, notifiedAt: this.clock.now() } },
                { expectStatus: [RunStatus.WAITING] },
            );

            this.emit({ type: 'run.updated', run: notified });
        } catch (error) {
            if (!(error instanceof InvalidRunStateError) && (!this.draining || !controller.signal.aborted)) {
                this.onError(error, run);
            }
        } finally {
            this.deliveryControllers.delete(controller);
            timer.clear();

            if (acquired) {
                await this.store.locks.release(lockKey, attempt).catch((releaseError: unknown) => this.onError(releaseError, run));
            }
        }
    }

    /**
     * The single execution seam: runs one claimed, `running` run to a settled
     * state. `signal` aborts on cancel.
     */
    protected async execute(run: Run, signal: AbortSignal): Promise<void> {
        // cancel() asked for it while it ran elsewhere (or was interrupted): also for an agent unknown here
        if (run.cancelRequested) {
            await this.finish(run.id, { status: RunStatus.CANCELLED });

            return;
        }

        const agent = this.agents.get(run.agent);
        const skills = agent ? this.skills.get(agent) : undefined;

        if (!agent || !skills || !await this.isCurrent(run.agent)) {
            // removed or replaced since the claim: left for a replica that runs the agent's current revision
            // guarded by status and owner (`expectStatus: [RUNNING]`, `expectOwner`): a taken-over run is left alone
            const released = await this.ownedUpdate(run.id, {
                status: RunStatus.QUEUED,
                claim: undefined,
                startedAt: undefined,
            });

            if (released) {
                this.emit({ type: 'run.updated', run: released });
            }

            return;
        }

        let conversation;

        if (run.conversation) {
            const capability = this.conversationCapability();
            const key = conversationKey(agent.definition);

            if (key === undefined) {
                throw new InvalidRunStateError('The agent has disabled conversations.');
            }

            if (key !== run.conversation.scope.identity.agent) {
                throw new InvalidRunStateError('The agent conversation key has changed.');
            }

            const admitted = await capability.admit(structuredClone(run));

            if (admitted.kind === 'busy') {
                this.queue.defer(run.id);

                const released = await this.ownedUpdate(run.id, {
                    status: RunStatus.QUEUED,
                    claim: undefined,
                    startedAt: undefined,
                });

                if (released) {
                    this.emit({ type: 'run.updated', run: released });
                }

                return;
            }

            if (!await this.ownsRun(run.id)) {
                return;
            }

            if (signal.aborted) {
                await this.finish(run.id, { status: RunStatus.CANCELLED });

                return;
            }

            conversation = { capability, snapshot: admitted.snapshot };
        }

        await executeRun({
            engine: this,
            conversation,
            run,
            agent,
            skills,
            model: agent.definition.model ?? this.model,
            models: this.models,
            store: this.store,
            clock: this.clock,
            signal,
            finish: (patch) => this.finish(run.id, patch),
            update: async (patch) => {
                const updated = await this.ownedUpdate(run.id, patch);

                if (!updated) {
                    throw new InvalidRunStateError(`Run "${run.id}" was taken over by another owner.`);
                }

                this.emit({ type: 'run.updated', run: updated });

                return updated;
            },
            onStepAppended: (step) => this.emit({ type: 'step.appended', step }),
            onDelta: (delta) => this.emit({ type: 'run.delta', delta }),
            pause: (request, usage) => this.pause(run, request, usage),
            ownsRun: () => this.ownsRun(run.id),
            provided: this.provided,
        });
    }

    /**
     * The start guard of one scheduling pass, built from one read of the
     * revision markers (skipped while no folder agent is registered): a run
     * may start when cancel asked for it, or when its agent is registered
     * here and is a code agent or loaded at the stored marker's hash.
     */
    protected async prepareStart(): Promise<(run: Run) => boolean> {
        const folder = this.revisions.values().some((revision) => revision !== undefined);
        const markers = folder ?
            new Map((await this.store.agentRevisions.find()).map((marker) => [marker.agent, marker.hash])) :
            new Map<string, string>();

        return (run) => {
            if (!this.started || this.startup?.signal.aborted) {
                return false;
            }

            if (run.cancelRequested) {
                return true;
            }

            const agent = this.agents.get(run.agent);

            if (!agent || !this.skills.get(agent) || !this.agents.has(run.agent) || this.syncing.has(run.agent)) {
                return false;
            }

            const revision = this.revisions.get(run.agent);

            return revision === undefined || revision === markers.get(run.agent);
        };
    }

    /** Whether the registered agent is a code agent or loaded at the stored marker's hash. */
    protected async isCurrent(name: string): Promise<boolean> {
        if (this.syncing.has(name)) {
            return false;
        }

        const revision = this.revisions.get(name);

        if (revision === undefined) {
            return true;
        }

        return (await this.store.agentRevisions.findOne(name))?.hash === revision;
    }

    /** A throwing execution fails the run (and releases its claim) instead of leaking. */
    protected guardedExecute(run: Run): Promise<void> {
        const controller = new AbortController();
        const { promise: done, resolve: release } = Promise.withResolvers<void>();
        const entry = { controller, done };

        this.executions.set(run.id, entry);

        return (async () => {
            try {
                await this.execute(run, controller.signal);
            } catch (error) {
                // the run belongs to another owner now: its failure is not ours to record
                if (this.executions.get(run.id)?.stop === 'lease-lost') {
                    return;
                }

                await this.finish(run.id, { status: RunStatus.FAILED, error: toRunError(error) });
                this.onError(error, run);
            } finally {
                // a later execution of the same run may hold the entry by now
                if (this.executions.get(run.id) === entry) {
                    this.executions.delete(run.id);
                }

                release();
            }
        })();
    }

    /**
     * Settles a `running` run this engine holds the claim of. A run aborted by
     * drain() is marked `interrupted` (claim released, not finished) instead of
     * `cancelled`; after a lost lease nothing is written and undefined resolves.
     */
    protected async finish(id: string, patch: Partial<Run>): Promise<Run | undefined> {
        // Another replica may repair a terminal owner immediately after this write.
        await this.conversations?.idle(id);

        const execution = this.executions.get(id);
        const stop = execution?.stop;

        if (stop === 'lease-lost') {
            return undefined;
        }

        const now = this.clock.now();
        const settled: Partial<Run> = stop === 'drain' && patch.status === RunStatus.CANCELLED ?
            {
                status: RunStatus.INTERRUPTED,
                usage: patch.usage,
                claim: undefined,
                updatedAt: now,
            } :
            {
                claim: undefined,
                // a run resumed after a crash may still carry its answered wait point
                waiting: undefined,
                finishedAt: now,
                updatedAt: now,
                // a registry cancel's reason; a remote one is already stored and kept
                ...(patch.status === RunStatus.CANCELLED && execution?.cancelReason && { error: execution.cancelReason }),
                // completed despite a cancel request: the stored reason no longer applies
                ...(patch.status === RunStatus.COMPLETED && { error: undefined }),
                ...patch,
            };

        if (settled.usage === undefined) {
            delete settled.usage;
        }

        const updated = await this.ownedUpdate(id, settled);

        if (updated) {
            this.emit({ type: 'run.updated', run: updated });
            await this.reconcileConversation(updated);
        }

        return updated;
    }

    protected async reconcileConversation(run: Run): Promise<void> {
        if (!run.conversation || !['completed', 'failed', 'cancelled'].includes(run.status)) {
            return;
        }

        try {
            await this.conversationCapability().reconcile(run.conversation.scope, run.id);
            this.queue.retryDeferred();

            if (this.started) {
                void this.queue.pump();
            }
        } catch (error) {
            this.onError(error, run);
        }
    }

    /**
     * Updates a `running` run only while this engine holds its claim. Resolves
     * undefined (and aborts the execution) when another owner took it over.
     */
    protected async ownedUpdate(id: string, patch: Partial<Run>): Promise<Run | undefined> {
        try {
            return await this.store.runs.update(id, patch, { expectStatus: [RunStatus.RUNNING], expectOwner: this.owner });
        } catch (error) {
            if (error instanceof InvalidRunStateError && !await this.ownsRun(id)) {
                return undefined;
            }

            throw error;
        }
    }

    /** Whether this engine still holds the run's claim; aborts its execution when not. */
    protected async ownsRun(id: string): Promise<boolean> {
        const run = await this.store.runs.findOne(id);

        if (run?.claim?.owner === this.owner) {
            return true;
        }

        this.loseLease(id);

        return false;
    }

    /**
     * Aborts the local execution of a run another owner may hold now; it writes
     * nothing more. Reported once per execution as a LeaseLostError.
     */
    protected loseLease(id: string): void {
        const execution = this.executions.get(id);

        if (!execution || execution.stop === 'lease-lost') {
            return;
        }

        execution.stop = 'lease-lost';
        execution.controller.abort();
        this.onError(new LeaseLostError(id));
    }

    /**
     * What putAgent() refuses before any store read or write: a model that
     * does not resolve, a subscription to a channel the engine does not have
     * (InvalidAgentDefinitionError). Registers nothing.
     */
    checkAgent(agent: Agent): void {
        this.assertRegistrable(agent);
    }

    /** Refuses an agent the engine cannot run: one subscribing to a channel it does not have. */
    protected assertRegistrable(agent: Agent): void {
        // first: putAgent refuses before syncing, the lock and any store write
        checkAgentModel(agent, { model: this.model, models: this.models });
        assertConcurrencyMaxRuns(agent.definition.concurrencyMaxRuns, `Agent "${agent.name}" concurrencyMaxRuns`);

        for (const subscription of agent.definition.channels ?? []) {
            assertConcurrencyMaxRuns(subscription.concurrencyMaxRuns, `Agent "${agent.name}" subscription "${subscription.id}" concurrencyMaxRuns`);

            if (!this.channels.has(subscription.channel)) {
                throw new InvalidAgentDefinitionError(`Agent "${agent.name}" subscribes to unknown channel "${subscription.channel}".`);
            }
        }

        assertHandoffSubscription(agent);

        if (conversationKey(agent.definition) !== undefined && !this.conversations) {
            throw new InvalidAgentDefinitionError('The agent enables conversations but the engine has no conversation capability.');
        }

        this.skills.checkAgent(agent);
    }

    protected registry(): RegistryContext {
        return {
            store: this.store,
            clock: this.clock,
            claimTtlMs: this.claimTtlMs,
            cancel: (runId, reason) => this.cancelRun(runId, reason),
            onError: (error, run) => this.onError(error, run),
        };
    }

    protected emit(event: EngineEvent): void {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch (error) {
                this.onError(error);
            }
        }
    }

    /** Strictly increasing per process, so FIFO order survives identical clock readings. */
    protected nextCreatedAt(): Date {
        const t = Math.max(this.clock.now().getTime(), this.lastCreatedAt + 1);

        this.lastCreatedAt = t;

        return new Date(t);
    }
}
