/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import { InvalidAgentDefinitionError, SandboxError, ValidationError } from '@chamvi/core';
import { isObject } from 'smob';
import { assertSandboxEnv } from '../limits/module.ts';
import { isNormalizedRepo } from '../repo/helpers.ts';
import type { WorkspaceInfo } from '../workspace/types.ts';
import {
    CREATED_AT_KEY,
    DEFAULT_DEPLOYMENT,
    DEPLOYMENT_LABEL,
    EXPIRES_AT_KEY,
    IMAGE_KEY,
    REF_KEY,
    REPO_KEY_LABEL,
    REPO_URL_KEY,
    RUN_LABEL,
    SANDBOX_LABELS,
    WORKSPACE_LABEL,
} from './constants.ts';
import {
    DEPLOYMENT_PATTERN,
    REPO_KEY_LENGTH,
    isName,
    readEpoch,
} from './helpers.ts';
import type { WorkspaceCreateOptions } from './types.ts';

/**
 * Checks a create input: a non-empty `runId`, with `image: true` an
 * `image` that is undefined or a non-empty string without NUL (ValidationError),
 * then the `env` (`assertSandboxEnv`).
 */
export function assertCreateInput(input: WorkspaceCreateOptions, options: { image?: boolean } = {}): void {
    if (typeof input?.runId !== 'string' || input.runId.length === 0) {
        throw new ValidationError('runId must be a non-empty string.');
    }
    if (options.image && input.image !== undefined && !isName(input.image)) {
        throw new ValidationError('image must be a non-empty string.');
    }
    assertSandboxEnv(input.env);
}

/** The error of a create that its signal stopped. */
export function abortedCreate(cause?: unknown): SandboxError {
    return new SandboxError('workspace creation aborted', cause === undefined ? undefined : { cause });
}

/** An `image` option is undefined or a non-empty string without NUL; InvalidAgentDefinitionError otherwise. */
export function assertImageOption(image: unknown): void {
    if (image !== undefined && !isName(image)) {
        throw new InvalidAgentDefinitionError('image must be a non-empty string.');
    }
}

/** A `clock` option is undefined or an IClock; InvalidAgentDefinitionError otherwise. */
export function assertClockOption(clock: unknown): void {
    if (clock !== undefined && (!isObject(clock) || typeof clock.now !== 'function' || typeof clock.setTimeout !== 'function')) {
        throw new InvalidAgentDefinitionError('clock must be an IClock.');
    }
}

/**
 * The info of a workspace `provider` creates for `input` at `createdAt`:
 * it expires `maxLifetimeMs` later and names the requested repo and ref.
 */
export function buildWorkspaceInfo(
    input: WorkspaceCreateOptions,
    provider: string,
    createdAt: Date,
    maxLifetimeMs: number,
): WorkspaceInfo {
    const info: WorkspaceInfo = {
        runId: input.runId,
        provider,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + maxLifetimeMs),
    };
    if (input.repo !== undefined) info.repo = input.repo;
    if (input.ref !== undefined) info.ref = input.ref;
    return info;
}

/** True when an `EXPIRES_AT_KEY` value (epoch ms as a string) is at or before `now`. */
export function isExpiredAt(value: string | undefined, now: number): boolean {
    const expiresAt = Number(value);
    return !!value && Number.isFinite(expiresAt) && expiresAt <= now;
}

/**
 * One SandboxError for the removals a garbage collection could not do (the
 * others went on): the count, the first message, every failure in the cause.
 */
export function collectionError(count: number, failures: readonly unknown[]): SandboxError {
    const [first] = failures;
    const message = first instanceof Error ? first.message : String(first);
    return new SandboxError(
        `garbage collection removed ${count} workspaces, ${failures.length} failed (first: ${message})`,
        { cause: new AggregateError(failures) },
    );
}

/**
 * A deployment name: a Kubernetes label value (at most 63 alphanumerics, `-`,
 * `_` or `.`, alphanumeric ends). Returns `DEFAULT_DEPLOYMENT` for undefined;
 * ValidationError otherwise.
 */
export function assertDeployment(value: unknown): string {
    if (value === undefined) return DEFAULT_DEPLOYMENT;
    if (typeof value !== 'string' || !DEPLOYMENT_PATTERN.test(value)) {
        throw new ValidationError('deployment must be at most 63 letters, digits, `-`, `_` or `.`, starting and ending with a letter or digit.');
    }
    return value;
}

/** A label value for a normalized repository URL: the first 32 hex characters of its sha256. */
export function repoKey(repo: string): string {
    return createHash('sha256').update(repo).digest('hex').slice(0, REPO_KEY_LENGTH);
}

/**
 * The labels of a workspace (all label values): the managed labels, run,
 * workspace, deployment and, with a repository, its `repoKey`.
 */
export function workspaceLabels(input: {
    id: string;
    runId: string;
    deployment: string;
    repo?: string;
}): Record<string, string> {
    const labels: Record<string, string> = {
        ...SANDBOX_LABELS,
        [RUN_LABEL]: input.runId,
        [WORKSPACE_LABEL]: input.id,
        [DEPLOYMENT_LABEL]: input.deployment,
    };
    if (input.repo !== undefined) labels[REPO_KEY_LABEL] = repoKey(input.repo);
    return labels;
}

/**
 * The rest of what a found workspace's info is rebuilt from (Docker labels,
 * Kubernetes annotations): created and expiry in epoch ms, repo, ref and image
 * when set.
 */
export function workspaceMetadata(info: WorkspaceInfo): Record<string, string> {
    const metadata: Record<string, string> = {
        [CREATED_AT_KEY]: String(info.createdAt.getTime()),
        [EXPIRES_AT_KEY]: String(info.expiresAt.getTime()),
    };
    if (info.repo !== undefined) metadata[REPO_URL_KEY] = info.repo;
    if (info.ref !== undefined) metadata[REF_KEY] = info.ref;
    if (info.image !== undefined) metadata[IMAGE_KEY] = info.image;
    return metadata;
}

/**
 * The info of a found workspace from its labels and metadata (`commit` is
 * read separately, `readCheckoutCommit`); undefined when the run, a time or
 * the repository is missing or unreadable.
 */
export function readWorkspaceInfo(values: Readonly<Record<string, string | undefined>>, provider: string): WorkspaceInfo | undefined {
    const runId = values[RUN_LABEL];
    const createdAt = readEpoch(values[CREATED_AT_KEY]);
    const expiresAt = readEpoch(values[EXPIRES_AT_KEY]);
    if (!isName(runId) || createdAt === undefined || expiresAt === undefined) return undefined;
    const repo = values[REPO_URL_KEY];
    if (repo !== undefined && !isNormalizedRepo(repo)) return undefined;

    const info: WorkspaceInfo = {
        runId: runId as string,
        provider,
        createdAt: new Date(createdAt),
        expiresAt: new Date(expiresAt),
    };
    if (repo !== undefined) info.repo = repo;
    if (isName(values[REF_KEY])) info.ref = values[REF_KEY];
    if (isName(values[IMAGE_KEY])) info.image = values[IMAGE_KEY];
    return info;
}
