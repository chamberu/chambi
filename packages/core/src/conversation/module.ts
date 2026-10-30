/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';
import type { Invoker } from '../trigger/types.ts';
import type { Run } from '../run/types.ts';
import type {
    ConversationIdentity,
    ConversationInspection,
    ConversationOperationLiteral,
    ConversationOptions,
    ConversationScope,
    IConversationRepository,
} from './types.ts';
import type { IEffectRepository, IRunRepository } from '../repository/types.ts';
import { InvalidAgentDefinitionError, InvalidRunStateError, ValidationError } from '../errors/index.ts';
import { ConversationOperation, ConversationTurnKind } from './constants.ts';
import { RunStatus } from '../run/constants.ts';
import { matchesEmitReceipt, normalizeConversationLimits } from './helpers.ts';
import { assertPage } from './persistence/module.ts';

function settled(run: Run | undefined): boolean {
    return !run || run.status === RunStatus.COMPLETED || run.status === RunStatus.FAILED || run.status === RunStatus.CANCELLED;
}

/** Optional engine capability; no ordinary run calls it. */
export class Conversations {
    readonly repository;

    readonly limits;

    protected readonly authorize;

    protected readonly pending = new Map<string, Set<Promise<void>>>();

    protected readonly runs: IRunRepository;

    protected readonly effects: IEffectRepository;

    constructor(options: ConversationOptions, repository: IConversationRepository, runs: IRunRepository, effects: IEffectRepository) {
        if (!isObject(options) || typeof options.authorize !== 'function' || !isObject(repository)) {
            throw new InvalidAgentDefinitionError('Conversations need a repository and an authorizer.');
        }

        for (const method of ['resolve', 'findOne', 'beginTurn', 'activeRun', 'endTurn', 'prepareEmit', 'confirmEmit', 'pendingEmits', 'findItems', 'findNotes', 'findOneNote', 'applyNote', 'reset', 'delete', 'prune'] as const) {
            if (typeof repository[method] !== 'function') {
                throw new InvalidAgentDefinitionError(`The conversation repository needs ${method}().`);
            }
        }

        this.repository = repository;
        this.runs = runs;
        this.effects = effects;
        this.authorize = options.authorize;
        this.limits = normalizeConversationLimits(options.limits);
    }

    async allow(operation: ConversationOperationLiteral, identity: ConversationIdentity, agent: string, invoker?: Invoker): Promise<void> {
        if (await this.authorize(structuredClone({
            operation,
            identity,
            agent,
            ...(invoker ? { invoker } : {}),
        })) !== true) {
            throw new ValidationError('Conversation access was denied.');
        }
    }

    async check(run: Run, operation: `${ConversationOperation.RECALL | ConversationOperation.NOTES}` = ConversationOperation.RECALL): Promise<void> {
        const { scope } = run.conversation!;

        await this.allow(operation, scope.identity, run.trigger.agent, run.trigger.invoker);

        const current = await this.repository.findOne(scope.identity);

        if (!current || current.id !== scope.id || current.generation !== scope.generation) {
            throw new InvalidRunStateError('The conversation scope is stale: it was reset or deleted.');
        }
    }

    async admit(run: Run) {
        await this.check(run);

        const { scope, text } = run.conversation!;
        let result = await this.repository.beginTurn(scope, run.id, text, this.limits);

        if (result.kind === ConversationTurnKind.BUSY && settled(await this.runs.findOne(result.runId))) {
            await this.reconcile(scope, result.runId);
            result = await this.repository.beginTurn(scope, run.id, text, this.limits);
        }

        if (result.kind === ConversationTurnKind.STALE) {
            throw new InvalidRunStateError('The conversation scope is stale: it was reset or deleted.');
        }

        return result;
    }

    track(runId: string, work: Promise<void>): Promise<void> {
        const pending = this.pending.get(runId) ?? new Set<Promise<void>>();

        this.pending.set(runId, pending);
        pending.add(work);

        const remove = () => {
            pending.delete(work);

            if (pending.size === 0 && this.pending.get(runId) === pending) {
                this.pending.delete(runId);
            }
        };

        void work.then(remove, remove);

        return work;
    }

    async idle(runId?: string): Promise<void> {
        for (;;) {
            const pending = runId === undefined ?
                this.pending.values().toArray().flatMap((entries) => Array.from(entries)) :
                Array.from(this.pending.get(runId) ?? []);

            if (pending.length === 0) {
                return;
            }

            await Promise.allSettled(pending);
        }
    }

    async reconcile(scope: ConversationScope, runId: string): Promise<void> {
        // Terminal repair never fabricates success for an unrecorded external send.
        await this.idle(runId);
        await this.track(runId, (async () => {
            const pending = await this.repository.pendingEmits(scope, runId);
            const confirmed: string[] = [];

            for (const item of pending) {
                const effect = item.effectKey ? await this.effects.findOne(item.effectKey) : undefined;

                if (effect && matchesEmitReceipt(effect.result, item.target)) {
                    confirmed.push(item.id);
                }
            }

            await this.repository.endTurn(scope, runId, confirmed);
        })());
    }

    async repair(identity: ConversationIdentity): Promise<void> {
        const scope = await this.repository.findOne(identity);

        if (!scope) {
            return;
        }

        const owner = await this.repository.activeRun(scope);

        if (owner && settled(await this.runs.findOne(owner))) {
            await this.reconcile(scope, owner);
        }
    }

    async inspect(identity: ConversationIdentity, query: { limit?: number; offset?: number } = {}): Promise<ConversationInspection | undefined> {
        const page = { limit: query.limit ?? 50, offset: query.offset ?? 0 };

        assertPage(page);

        if (page.limit > 100) {
            throw new ValidationError('Conversation inspection limit must be at most 100.');
        }

        const scope = await this.repository.findOne(identity);

        if (!scope) {
            return undefined;
        }

        const [items, notes] = await Promise.all([this.repository.findItems(scope, page), this.repository.findNotes(scope, page)]);

        return {
            scope,
            items,
            notes,
        };
    }

    async prune(): Promise<void> {
        await this.repository.prune(this.limits, { isSettled: async (id) => settled(await this.runs.findOne(id)) });
    }
}
