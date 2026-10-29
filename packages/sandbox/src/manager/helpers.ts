/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { jsonSchema } from 'ai';
import type { JSONSchema7 } from 'ai';
import {
    ChamviError,
    InvalidAgentDefinitionError,
    RunStatus,
    SandboxError,
    ValidationError,
} from '@chamvi/core';
import { isObject } from 'smob';
import { assertSandboxEnv, resolveLimits } from '../limits/module.ts';
import { assertDeployment, assertImageOption } from '../provider/module.ts';
import { WORKSPACE_ROOT } from '../workspace/constants.ts';
import { GC_INTERVAL_MAX_MS } from './constants.ts';
import type { IGitCredentials } from '../credentials/types.ts';
import type { RepositoryInstructions } from '../instructions/types.ts';
import type { IWorkspace } from '../workspace/types.ts';
import type { ISandboxProvider } from '../provider/types.ts';
import type {
    GitAuthor,
    PushPolicy,
    WorkspaceManagerOptions,
    WorkspaceToolResult,
} from './types.ts';

/** The name of the local provider, which runs no images. */
const LOCAL_PROVIDER = 'local';

/**
 * Whether `create_workspace` offers an `image`: only with an allow-list and
 * never on the local provider (it runs no images).
 */
export function offersImage(
    provider: Pick<ISandboxProvider, 'name'>,
    allowImage: WorkspaceManagerOptions['allowImage'],
): boolean {
    return allowImage !== undefined && provider.name !== LOCAL_PROVIDER;
}

/** Why a requested image is refused when the manager offers none. */
export function imageNotOfferedMessage(provider: Pick<ISandboxProvider, 'name'>): string {
    return provider.name === LOCAL_PROVIDER ?
        'image is not offered: the local provider runs no images.' :
        'image is not offered: the operator configured no image allow-list.';
}

/** Checks the manager options; InvalidAgentDefinitionError for a misconfiguration. */
export function assertManagerOptions(options: WorkspaceManagerOptions): void {
    if (!isObject(options)) {
        throw new InvalidAgentDefinitionError('createWorkspaceManager() needs an options object.');
    }
    const { provider } = options;
    if (
        !isObject(provider) ||
        typeof provider.create !== 'function' ||
        typeof provider.find !== 'function' ||
        typeof provider.collectGarbage !== 'function'
    ) {
        throw new InvalidAgentDefinitionError('provider must be an ISandboxProvider (create, find, collectGarbage).');
    }
    if (options.deployment !== undefined) {
        try {
            assertDeployment(options.deployment);
        } catch (error) {
            throw new InvalidAgentDefinitionError((error as Error).message);
        }
    }
    if (options.isSettled !== undefined && typeof options.isSettled !== 'function') {
        throw new InvalidAgentDefinitionError('isSettled must be a function.');
    }
    assertImageOption(options.image);
    assertSandboxEnv(options.env);
    resolveLimits(options.limits);
    if (options.allowRepo !== undefined && typeof options.allowRepo !== 'function') {
        throw new InvalidAgentDefinitionError('allowRepo must be a function.');
    }
    if (options.allowImage !== undefined && typeof options.allowImage !== 'function') {
        throw new InvalidAgentDefinitionError('allowImage must be a function.');
    }
    if (options.repositoryInstructions !== undefined && typeof options.repositoryInstructions !== 'boolean') {
        throw new InvalidAgentDefinitionError('repositoryInstructions must be a boolean.');
    }
    if (options.maxWorkspacesPerRun !== undefined && (!Number.isSafeInteger(options.maxWorkspacesPerRun) || options.maxWorkspacesPerRun < 1)) {
        throw new InvalidAgentDefinitionError(`maxWorkspacesPerRun must be an integer of at least 1, got ${JSON.stringify(options.maxWorkspacesPerRun)}.`);
    }
    if (options.gcIntervalMs !== undefined && (
        !Number.isSafeInteger(options.gcIntervalMs) ||
        options.gcIntervalMs < 0 ||
        options.gcIntervalMs > GC_INTERVAL_MAX_MS
    )) {
        // a Node timer above 2^31 - 1 fires after 1 ms, so the collector would run back to back
        throw new InvalidAgentDefinitionError(`gcIntervalMs must be an integer from 0 to ${GC_INTERVAL_MAX_MS}, got ${JSON.stringify(options.gcIntervalMs)}.`);
    }
    if (options.onError !== undefined && typeof options.onError !== 'function') {
        throw new InvalidAgentDefinitionError('onError must be a function.');
    }
    credentialSources(options.credentials);
    if (options.depth !== undefined && (!Number.isSafeInteger(options.depth) || options.depth < 1)) {
        throw new InvalidAgentDefinitionError('depth must be an integer of at least 1.');
    }
    authorEnv(options.author);
    assertPushPolicy(options.push);
}

/** The credential sources as a list, else InvalidAgentDefinitionError. */
export function credentialSources(credentials: WorkspaceManagerOptions['credentials']): IGitCredentials[] {
    if (credentials === undefined) return [];
    const sources = Array.isArray(credentials) ? credentials : [credentials];
    if (sources.some((source) => !isObject(source) || typeof (source as Partial<IGitCredentials>).get !== 'function')) {
        throw new InvalidAgentDefinitionError('credentials must be git credential sources (an object with get()), or a list of them.');
    }
    return sources;
}

/** The `GIT_AUTHOR_*`/`GIT_COMMITTER_*` variables of `author`, else InvalidAgentDefinitionError. */
export function authorEnv(author: GitAuthor | undefined): Record<string, string> {
    if (author === undefined) return {};
    const valid = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && !/[\0\r\n<>]/.test(value);
    if (!isObject(author) || !valid(author.name) || !valid(author.email)) {
        throw new InvalidAgentDefinitionError('author must be { name, email }: non-empty strings without NUL, line breaks, < or >.');
    }
    return {
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_COMMITTER_NAME: author.name,
        GIT_COMMITTER_EMAIL: author.email,
    };
}

function assertPushPolicy(push: PushPolicy | undefined): void {
    if (push === undefined) return;
    const fail = (rule: string) => new InvalidAgentDefinitionError(`push ${rule}`);
    if (!isObject(push)) throw fail('must be an object { mode?, allowForce?, allowBranch?, channel? }.');
    if (push.mode !== undefined && push.mode !== 'auto' && push.mode !== 'approve') throw fail('mode must be "auto" or "approve".');
    if (push.allowForce !== undefined && typeof push.allowForce !== 'boolean') throw fail('allowForce must be a boolean.');
    if (push.allowBranch !== undefined && typeof push.allowBranch !== 'function') throw fail('allowBranch must be a function.');
    if (push.channel !== undefined && (typeof push.channel !== 'string' || push.channel.length === 0)) {
        throw fail('channel must be a non-empty channel name.');
    }
}

/** True for the statuses after which a run never executes again. */
export function isTerminal(status: string): boolean {
    return status === RunStatus.COMPLETED || status === RunStatus.FAILED || status === RunStatus.CANCELLED;
}

export function isExpired(workspace: IWorkspace, now: Date): boolean {
    return workspace.info.expiresAt.getTime() <= now.getTime();
}

/** chamvi errors pass through; anything else becomes a SandboxError `<what>: <message>` with the cause. */
export function toSandboxError(error: unknown, what: string): ChamviError {
    if (error instanceof ChamviError) return error;
    const message = error instanceof Error ? error.message : String(error);
    return new SandboxError(`${what}: ${message}`, { cause: error });
}

/** A string or undefined, else a ValidationError (a tool error the model can correct). */
export function optionalString(value: unknown, name: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') {
        throw new ValidationError(`${name} must be a string.`);
    }
    return value;
}

/** A boolean or undefined, else a ValidationError. */
export function optionalBoolean(value: unknown, name: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') {
        throw new ValidationError(`${name} must be a boolean.`);
    }
    return value;
}

/** The tool input as an object, else a ValidationError. */
export function inputObject(input: unknown): Record<string, unknown> {
    if (!isObject(input)) {
        throw new ValidationError('The tool input must be an object.');
    }
    return input;
}

/** An object schema of optional `properties`. */
export function optionalObjectSchema<T>(properties: Record<string, JSONSchema7>) {
    return jsonSchema<T>({
        type: 'object',
        properties,
        additionalProperties: false,
    });
}

/** Redact strings after collection too, including metadata and nested instruction context. */
export function redactToolResult<T>(workspace: IWorkspace, result: T): T {
    if (!workspace.redact) return result;
    return JSON.parse(JSON.stringify(result, (_key, value: unknown) => (
        typeof value === 'string' ? workspace.redact!(value) : value
    ))) as T;
}

export function toToolResult(workspace: IWorkspace, reused: boolean, instructions: RepositoryInstructions | null): WorkspaceToolResult {
    const { info } = workspace;
    return redactToolResult(workspace, {
        workspace: workspace.id,
        root: WORKSPACE_ROOT,
        repo: info.repo ?? null,
        ref: info.ref ?? null,
        commit: info.commit ?? null,
        defaultBranch: info.defaultBranch ?? null,
        image: info.image ?? null,
        expiresAt: info.expiresAt.toISOString(),
        reused,
        instructions,
    });
}
