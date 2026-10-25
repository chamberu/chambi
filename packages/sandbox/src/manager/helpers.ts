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
import type { IWorkspace } from '../workspace/types.ts';
import type { WorkspaceManagerOptions, WorkspaceToolResult } from './types.ts';

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
    if (options.maxWorkspacesPerRun !== undefined && (!Number.isSafeInteger(options.maxWorkspacesPerRun) || options.maxWorkspacesPerRun < 1)) {
        throw new InvalidAgentDefinitionError(`maxWorkspacesPerRun must be an integer of at least 1, got ${JSON.stringify(options.maxWorkspacesPerRun)}.`);
    }
    if (options.gcIntervalMs !== undefined && (!Number.isSafeInteger(options.gcIntervalMs) || options.gcIntervalMs < 0)) {
        throw new InvalidAgentDefinitionError(`gcIntervalMs must be an integer of at least 0, got ${JSON.stringify(options.gcIntervalMs)}.`);
    }
    if (options.onError !== undefined && typeof options.onError !== 'function') {
        throw new InvalidAgentDefinitionError('onError must be a function.');
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

export function toToolResult(workspace: IWorkspace, reused: boolean): WorkspaceToolResult {
    const { info } = workspace;
    return {
        workspace: workspace.id,
        root: WORKSPACE_ROOT,
        repo: info.repo ?? null,
        ref: info.ref ?? null,
        commit: info.commit ?? null,
        expiresAt: info.expiresAt.toISOString(),
        reused,
    };
}
