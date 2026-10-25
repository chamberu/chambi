/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    describe,
    expect,
    expectTypeOf,
    it,
} from 'vitest';
import * as core from '@chamvi/core';

describe('public api', () => {
    it.each([
        'defineAgent',
        'Engine',
        'MemoryStore',
        'defineEffectTool',
        'defineTool',
        'effectMarker',
        'approve',
        'ChamviError',
        'BudgetExceededError',
        'ArtifactNotFoundError',
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
        'normalizeEnvelope',
        'consoleChannel',
        'ChannelNotFoundError',
        'defineContextKey',
        'inject',
        'tryInject',
        'ContextNotProvidedError',
        'AgentNotFoundError',
    ])('exports %s', (name) => {
        expect(core).toHaveProperty(name);
        expect(core[name as keyof typeof core]).toBeTypeOf('function');
    });

    it('keeps the artifact uri prefix internal', () => {
        expect(core).not.toHaveProperty('ARTIFACT_URI_PREFIX');
    });

    it('exports the tool context schema', () => {
        expect(core.toolContextSchema['~standard'].vendor).toBe('chamvi');
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
        expect(core).not.toHaveProperty('assertChannelName');
        expect(core).not.toHaveProperty('createChannelHandle');
        expect(core).not.toHaveProperty('runToolCall');
        expect(core).not.toHaveProperty('currentToolCall');
    });

    it('exports the approval timeout bounds', () => {
        expect(core.DEFAULT_APPROVAL_TIMEOUT_MS).toBe(24 * 60 * 60 * 1000);
        expect(core.APPROVAL_TIMEOUT_MAX_MS).toBe(2 ** 31 - 1);
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
        expectTypeOf<core.EngineStartOptions>().toEqualTypeOf<{ channels?: boolean }>();
        expectTypeOf<core.EmitMessage>().toEqualTypeOf<{
            title?: string; 
            body: string; 
            key?: string 
        }>();
        expectTypeOf<core.ChannelHandle['emit']>().returns.toEqualTypeOf<Promise<void>>();
        expectTypeOf<core.ChannelHandle['approve']>().returns.toEqualTypeOf<Promise<core.ApprovalDecision>>();
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
        expectTypeOf<core.EngineEvent>().toEqualTypeOf<core.RunEvent | core.AgentChange>();
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

    it('exports the RunStatus enum', () => {
        expect(core.RunStatus.QUEUED).toBe('queued');
    });

    it('exports the ApprovalAnswer type', () => {
        expectTypeOf<core.ApprovalAnswer>().toEqualTypeOf<{
            approvalId: string;
            approved: boolean;
            reason?: string;
            approver?: core.Invoker;
        }>();
    });
});
