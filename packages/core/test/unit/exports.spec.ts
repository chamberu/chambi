/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import {
    describe,
    expect,
    expectTypeOf,
    it,
} from 'vitest';
import * as core from '@chamvi/core';
import type * as sdk from 'ai';
import * as persistence from '@chamvi/core/conversation/persistence';

describe('public api', () => {
    it('keeps the engine interface aligned with the public class contract', () => {
        expectTypeOf<keyof core.Engine>().toEqualTypeOf<keyof core.IEngine>();
        expectTypeOf<InstanceType<typeof core.Engine>>().toExtend<core.IEngine>();
        expectTypeOf<core.IEngine>().toExtend<Pick<core.Engine, keyof core.IEngine>>();
    });

    it('types the store as a collection of repositories with conversation support from the memory factory', () => {
        expectTypeOf<core.EngineOptions['store']>().toEqualTypeOf<core.IStore>();
        expectTypeOf<core.IEngine['store']>().toEqualTypeOf<core.IStore>();
        expectTypeOf<ReturnType<typeof core.createMemoryStore>['conversations']>()
            .toEqualTypeOf<core.IConversationRepository>();
        expect(core).not.toHaveProperty('createMemoryRepositories');
    });

    it('publishes conversation persistence separately from the agent api', () => {
        const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

        expect(manifest.exports['./conversation/persistence']).toEqual({
            types: './dist/conversation/persistence.d.mts',
            import: './dist/conversation/persistence.mjs',
        });
    });

    it('exposes only store persistence rules from its dedicated entry', () => {
        const names = [
            'assertConversationScope',
            'assertConversationText',
            'assertEmitItem',
            'assertNoteOperationContent',
            'assertNoteOperationShape',
            'assertPage',
            'assertRunId',
            'buildSnapshotContent',
            'identityId',
            'isSameEmit',
            'userItemId',
        ];

        expect(Object.keys(persistence).sort()).toEqual(names);

        for (const name of names) {
            expect(persistence[name as keyof typeof persistence]).toBeTypeOf('function');
            expect(core).not.toHaveProperty(name);
        }
    });

    it('exports native message aliases and role-specific instruction types', () => {
        expectTypeOf<core.SystemModelMessage>().toEqualTypeOf<sdk.SystemModelMessage>();
        expectTypeOf<core.UserModelMessage>().toEqualTypeOf<sdk.UserModelMessage>();
        expectTypeOf<core.AssistantModelMessage>().toEqualTypeOf<sdk.AssistantModelMessage>();
        expectTypeOf<core.ModelMessage>().toEqualTypeOf<sdk.ModelMessage>();
        expectTypeOf<core.SystemModelMessage['content']>().toEqualTypeOf<string>();
        expectTypeOf<core.UserContent>().toEqualTypeOf<sdk.UserContent>();
        expectTypeOf<core.AssistantContent>().toEqualTypeOf<sdk.AssistantContent>();
        expectTypeOf<core.TextPart>().toEqualTypeOf<sdk.TextPart>();
        expectTypeOf<core.FilePart>().toEqualTypeOf<sdk.FilePart>();
        expectTypeOf<core.AgentInstruction>().toEqualTypeOf<sdk.SystemModelMessage | sdk.UserModelMessage | sdk.AssistantModelMessage>();
        expectTypeOf<core.AgentDefinition['instructions']>().toEqualTypeOf<string | readonly core.AgentInstruction[]>();
        expectTypeOf<core.SkillContribution['instructions']>().toEqualTypeOf<core.AgentInstructions>();
        expectTypeOf<sdk.ToolModelMessage>().not.toExtend<core.AgentInstruction>();
        expect(core).not.toHaveProperty('normalizeInstructions');
        expect(core).not.toHaveProperty('splitInstructions');
    });

    it.each([
        'createMemoryStore',
        'defineAgent',
        'Engine',
        'MemoryAgentRevisionRepository',
        'MemoryArtifactRepository',
        'MemoryCheckpointRepository',
        'MemoryEffectRepository',
        'MemoryIdempotencyRepository',
        'MemoryLockRepository',
        'MemoryRunRepository',
        'MemoryStateRepository',
        'MemoryStepRepository',
        'defineEffectTool',
        'defineTool',
        'effectMarker',
        'approve',
        'outboundApproved',
        'ChamviError',
        'BudgetExceededError',
        'ArtifactNotFoundError',
        'RepositoryNotFoundError',
        'ToolNotAllowedError',
        'ToolDeniedError',
        'IncompleteResponseError',
        'SandboxError',
        'hasPermission',
        'matchesPermission',
        'toolPermission',
        'requireToolPermission',
        'isArtifactMediaType',
        'artifactFilePart',
        'assertTriggerKey',
        'assertConcurrencyMaxRuns',
        'normalizeEnvelope',
        'consoleChannel',
        'ChannelNotFoundError',
        'defineContextKey',
        'inject',
        'tryInject',
        'ContextNotProvidedError',
        'AgentNotFoundError',
        'checkAgentModel',
        'resolveModel',
        'extract',
        'agentChannel',
        'startHandoff',
    ])('exports %s', (name) => {
        expect(core).toHaveProperty(name);
        expect(core[name as keyof typeof core]).toBeTypeOf('function');
    });

    it('exports passive skill contracts', () => {
        expectTypeOf<core.AgentDefinition['skills']>().toEqualTypeOf<readonly core.SkillInput[] | undefined>();
        expectTypeOf<core.EngineOptions['skills']>().toEqualTypeOf<readonly core.SkillInput[] | undefined>();
        expectTypeOf<core.SkillInput['runtime']>().toEqualTypeOf<core.ISkillRuntimeProvider>();
        expectTypeOf<ReturnType<core.ISkillRuntimeProvider['create']>>().toEqualTypeOf<core.ISkillRuntime>();
        expect(core).not.toHaveProperty('createSkillCatalog');
        expectTypeOf<core.IEngine['prepare']>().parameter(0).toEqualTypeOf<{ signal?: AbortSignal; agents?: readonly core.Agent[] } | undefined>();
    });

    it('keeps the artifact uri prefix internal', () => {
        expect(core).not.toHaveProperty('ARTIFACT_URI_PREFIX');
    });

    it('exports the tool context schema', () => {
        expect(core.toolContextSchema['~standard'].vendor).toBe('chamvi');
    });

    it('exports the hand-off api', () => {
        expect(core.AGENT_CHANNEL_NAME).toBe('agent');
        expect(core.HANDOFF_SUBSCRIPTION_ID).toBe('handoff');
        expect(core.DEFAULT_MAX_HANDOFFS_PER_RUN).toBe(100);
        expect(core.MAX_HANDOFF_DEPTH).toBe(1);
        expect(core.handoff.on).toBeTypeOf('function');
        expect(core).not.toHaveProperty('HANDOFF_CONTEXT');
        expect(core).not.toHaveProperty('claimKey');
        expectTypeOf<core.TriggerEnvelope>().toHaveProperty('parent').toEqualTypeOf<core.TriggerParent | undefined>();
        expectTypeOf<core.HandoffResult>().toEqualTypeOf<{ runId: string; deduplicated: boolean }>();
    });

    it('exports the conversation contract', () => {
        expect(core.CONVERSATION_FIELD_MAX_LENGTH).toBe(255);
        expect(core.DEFAULT_CONVERSATION_LIMITS.maxItems).toBe(20);
        expect(core.CONVERSATION_LIMITS_MAX.maxItems).toBe(100);
        expect(Object.isFrozen(core.DEFAULT_CONVERSATION_LIMITS)).toBe(true);
        expect(Object.isFrozen(core.CONVERSATION_LIMITS_MAX)).toBe(true);
        expect(core.CONVERSATION_NOTE_KEY_MAX_LENGTH).toBe(128);
        expect(core.CONVERSATION_NOTE_TEXT_MAX_BYTES).toBe(2048);
        expect(core.CONVERSATION_NOTES_MAX).toBe(100);
        expect(core.MemoryConversationRepository).toBeTypeOf('function');
        expectTypeOf<core.MemoryConversationRepositoryOptions>().toEqualTypeOf<{ clock?: core.IClock }>();
        expectTypeOf<core.MemoryConversationRepository>().toMatchTypeOf<core.IConversationRepository>();

        for (const name of [
            'normalizeConversationLimits',
            'identityId',
            'conversationConcurrencyKey',
            'assertConversationIdentity',
            'assertConversationText',
            'assertConversationScope',
            'buildSnapshotContent',
            'userItemId',
            'isSameEmit',
            'assertNoteOperationShape',
            'assertNoteOperationContent',
        ]) {
            expect(core).not.toHaveProperty(name);
        }

        expectTypeOf<core.ConversationIdentity>().toEqualTypeOf<{
            agent: string;
            channel: string;
            account: string;
            chat: string;
            audience: string;
        }>();
        expectTypeOf<core.ConversationScope>().toEqualTypeOf<{
            id: string;
            generation: number;
            identity: core.ConversationIdentity;
        }>();
        expectTypeOf<core.ConversationTarget>().toEqualTypeOf<{
            account: string;
            chat: string;
            audience: string;
            text: string;
        }>();
        expectTypeOf<core.ConversationBinding>().toEqualTypeOf<{ scope: core.ConversationScope; text: string }>();
        expectTypeOf<core.ConversationAccess>().toEqualTypeOf<{
            agent: string;
            operation: 'dispatch' | 'recall' | 'notes';
            identity: core.ConversationIdentity;
            invoker?: core.Invoker;
        }>();
        expectTypeOf<core.ConversationOptions>().toEqualTypeOf<{
            authorize: (access: core.ConversationAccess) => boolean | Promise<boolean>;
            limits?: core.ConversationLimits;
        }>();
        expectTypeOf<core.EngineOptions['conversations']>().toEqualTypeOf<core.ConversationOptions | undefined>();
        expectTypeOf<core.ResolvedConversationLimits>().toEqualTypeOf<{
            readonly maxItems: number;
            readonly maxHistoryBytes: number;
            readonly maxNotesBytes: number;
            readonly maxItemBytes: number;
            readonly retentionMs: number;
            readonly maxStoredItems: number;
        }>();
        expectTypeOf<core.ConversationNoteResult>().toEqualTypeOf<
            {
                kind: 'set';
                key: string;
                updatedAt: Date
            } | {
                kind: 'remove';
                key: string;
                removed: boolean
            }
        >();
        expectTypeOf<core.ConversationNoteOperation>().toHaveProperty('kind').toEqualTypeOf<'set' | 'remove'>();
        expectTypeOf<core.IConversationRepository['findOne']>()
            .toEqualTypeOf<(identity: core.ConversationIdentity) => Promise<core.ConversationScope | undefined>>();
        expectTypeOf<core.IStore>().not.toHaveProperty('resolve');
    });

    it('exports the trigger key bound', () => {
        expect(core.TRIGGER_KEY_MAX_LENGTH).toBe(255);
    });

    it('removes the trigger factories', () => {
        expect(core).not.toHaveProperty('cron');
        expect(core).not.toHaveProperty('http');
        expect(core).not.toHaveProperty('webhook');
    });

    it('keeps the channel context factory internal', () => {
        expect(core).not.toHaveProperty('createChannelContext');
        expect(core.memoryTools).toBeTypeOf('function');
        expect(core.hasConversation).toBeTypeOf('function');
        expect(core).not.toHaveProperty('conversationFor');
        expect(core).not.toHaveProperty('bindConversationRun');
        expect(core).not.toHaveProperty('assertChannelName');
        expect(core).not.toHaveProperty('createChannelHandle');
        expect(core).not.toHaveProperty('runToolCall');
        expect(core).not.toHaveProperty('currentToolCall');
    });

    it('exports the approval timeout bounds', () => {
        expect(core.DEFAULT_APPROVAL_TIMEOUT_MS).toBe(24 * 60 * 60 * 1000);
        expect(core.APPROVAL_TIMEOUT_MAX_MS).toBe(2 ** 31 - 1);
    });

    it('exports the approval option limits', () => {
        expect(core.APPROVAL_OPTIONS_MAX).toBe(20);
        expect(core.APPROVAL_OPTION_ID_PATTERN).toBeInstanceOf(RegExp);
        expect(core.APPROVAL_OPTION_LABEL_MAX_LENGTH).toBe(200);
        expect(core.APPROVAL_OPTION_DETAIL_MAX_LENGTH).toBe(20_000);
        expect(core.APPROVAL_OPTIONS_DETAIL_MAX_LENGTH).toBe(100_000);
        expect(core).not.toHaveProperty('toApprovalOptions');
    });

    it('exports the approval option types', () => {
        expectTypeOf<core.ApprovalOption>().toEqualTypeOf<{
            id: string;
            label: string;
            detail?: string
        }>();
        expectTypeOf<core.ApprovalRequestInput['options']>().toEqualTypeOf<core.ApprovalOption[] | undefined>();
        expectTypeOf<core.ApprovalRequestInput['multiple']>().toEqualTypeOf<boolean | undefined>();
    });

    it('keeps the approval internals internal', () => {
        expect(core).not.toHaveProperty('SuspendSignal');
        expect(core).not.toHaveProperty('requestApproval');
        expect(core).not.toHaveProperty('SUSPENDED_RESULT');
    });

    it('removes the notifiers', () => {
        expect(core).not.toHaveProperty('consoleNotifier');
    });

    it('removes the resume tokens', () => {
        expect(core).not.toHaveProperty('createResumeToken');
        expect(core).not.toHaveProperty('verifyResumeToken');
        expect(core).not.toHaveProperty('InvalidResumeTokenError');
        expect(core.ErrorCode).not.toHaveProperty('INVALID_RESUME_TOKEN');
    });

    it('exports the channel types', () => {
        expectTypeOf<core.ChannelRequest>().toEqualTypeOf<{ request: Request; subpath: string }>();
        expectTypeOf<core.ChannelDispatchEnvelope>().toEqualTypeOf<Omit<core.DispatchEnvelope, 'channel'>>();
        expectTypeOf<core.ChannelContext['dispatch']>().returns.toEqualTypeOf<Promise<core.DispatchResult>>();
        expectTypeOf<core.ChannelSendOptions>().toEqualTypeOf<{ signal: AbortSignal; trigger: core.TriggerEnvelope }>();
        expectTypeOf<core.ChannelMessage['kind']>().toEqualTypeOf<'message' | 'approval'>();
        expectTypeOf<core.ChannelSubscription>().toHaveProperty('channel').toEqualTypeOf<string>();
        expectTypeOf<core.IChannel>().toHaveProperty('name').toEqualTypeOf<string>();
        expectTypeOf<core.TriggerEnvelope>().toHaveProperty('channel').toEqualTypeOf<string>();
        expectTypeOf<core.Run>().toHaveProperty('address').toEqualTypeOf<string | undefined>();
        expectTypeOf<core.EngineStartOptions>().toEqualTypeOf<{ channels?: boolean; signal?: AbortSignal }>();
        expectTypeOf<core.EmitMessage>().toEqualTypeOf<{
            title?: string;
            body: string;
            key?: string;
            slot?: string
        }>();
        expectTypeOf<core.ChannelHandle['emit']>().returns.toEqualTypeOf<Promise<void>>();
        expectTypeOf<core.ChannelHandle['approve']>().returns.toEqualTypeOf<Promise<core.ApprovalDecision>>();
        expectTypeOf<Parameters<core.ChannelHandle['approve']>[0]>().toEqualTypeOf<core.ApprovalRequestInput & { address?: string; slot?: string }>();
        expectTypeOf<core.ChannelMessage['slot']>().toEqualTypeOf<string | undefined>();
        expectTypeOf<core.WaitPoint['slot']>().toEqualTypeOf<string | undefined>();
        expectTypeOf<core.ConsoleChannelOptions>().toHaveProperty('name').toEqualTypeOf<string | undefined>();
    });

    it('exports the sandbox error code', () => {
        expect(core.ErrorCode.SANDBOX).toBe('sandbox_error');
    });

    it('exports the context error code', () => {
        expect(core.ErrorCode.CONTEXT_NOT_PROVIDED).toBe('context_not_provided');
    });

    it('exports the agent not found error code', () => {
        expect(core.ErrorCode.AGENT_NOT_FOUND).toBe('agent_not_found');
    });

    it('exports the agent cancel reason codes', () => {
        expect(core.ErrorCode.AGENT_REPLACED).toBe('agent_replaced');
        expect(core.ErrorCode.AGENT_REMOVED).toBe('agent_removed');
    });

    it('keeps the agent registry internals internal', () => {
        expect(core).not.toHaveProperty('AGENT_LOCK_TTL_MS');
        expect(core).not.toHaveProperty('cancelAgentRuns');
        expect(core).not.toHaveProperty('syncRevision');
    });

    it('exports the agent change event types', () => {
        expectTypeOf<core.AgentChange>().toEqualTypeOf<{
            type: 'agents.changed';
            name: string;
            kind: 'added' | 'replaced' | 'removed';
        }>();
        expectTypeOf<core.EngineEvent>().toEqualTypeOf<core.RunEvent | core.AgentChange | core.AgentRunsCancelled>();
        expectTypeOf<core.AgentRunsCancelled>().toEqualTypeOf<{
            type: 'agents.cancelled';
            name: string;
            reason: 'agent_replaced' | 'agent_removed';
            revision?: string;
            runIds: string[];
        }>();
    });

    it('exports the agent folder types', () => {
        expectTypeOf<core.AgentRevision>().toHaveProperty('hash').toEqualTypeOf<string>();
    });

    it('keeps the context binding internal', () => {
        expect(core).not.toHaveProperty('isContextKey');
        expect(core).not.toHaveProperty('bindProvided');
        expect(core).not.toHaveProperty('providedOf');
        expect(core).not.toHaveProperty('registerContextKey');
    });

    it('exports conversation operation and turn enums with literal-compatible types', () => {
        expect(core.ConversationOperation).toEqual({
            DISPATCH: 'dispatch',
            RECALL: 'recall',
            NOTES: 'notes',
        });
        expect(core.ConversationTurnKind).toEqual({
            READY: 'ready',
            BUSY: 'busy',
            STALE: 'stale',
        });
        expectTypeOf<core.ConversationOperationLiteral>().toEqualTypeOf<'dispatch' | 'recall' | 'notes'>();
        expectTypeOf<core.BeginTurnResult['kind']>().toEqualTypeOf<'ready' | 'busy' | 'stale'>();
    });

    it('exports the RunStatus enum', () => {
        expect(core.RunStatus.QUEUED).toBe('queued');
    });

    it('exports the ApprovalAnswer type', () => {
        expectTypeOf<core.ApprovalAnswer>().toEqualTypeOf<{
            approvalId: string;
            approved: boolean;
            reason?: string;
            approver?: core.Invoker;
            selected?: string[];
        }>();
    });

    it('exports the ApprovalDecision type', () => {
        expectTypeOf<core.ApprovalDecision>().toEqualTypeOf<{
            approved: boolean;
            reason?: string;
            approver?: core.Invoker;
            selected?: string[];
        }>();
    });
});
