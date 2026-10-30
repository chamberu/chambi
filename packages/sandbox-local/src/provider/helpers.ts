/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { constants } from 'node:os';
import { join } from 'node:path';
import {
    DEFAULT_DEPLOYMENT,
    SANDBOX_ENV,
    assertSandboxEnv,
    cacheEnv,
} from '@chamvi/sandbox';
import type { WorkspaceInfo } from '@chamvi/sandbox';
import { isObject } from 'smob';
import { FALLBACK_PATH, LOCAL_PROVIDER_NAME } from './constants.ts';
import type { ParsedRecord, WorkspaceRecord } from './types.ts';

/** Kills the process group led by `pid`. Best effort: a gone group (ESRCH) is fine. */
export function killGroup(pid: number): void {
    try {
        process.kill(-pid, 'SIGKILL');
    } catch {
        // ESRCH: the group is gone already
    }
}

/**
 * Whether the process group led by `pid` still has a member this user may
 * signal. A group of another user (EPERM) is not ours: its id was reused.
 */
export function groupAlive(pid: number): boolean {
    try {
        process.kill(-pid, 0);

        return true;
    } catch {
        return false;
    }
}

/** The exit code a shell reports: the code, or 128 + the signal number. */
export function exitCodeOf(code: number | null, signal: NodeJS.Signals | null): number {
    if (code !== null) {
        return code;
    }

    const number = signal ? constants.signals[signal] : undefined;

    return 128 + (number ?? 0);
}

/**
 * The whole environment of a local exec: the host PATH, `SANDBOX_ENV`
 * without its container-only entries (HOME and `safe.directory`), HOME and
 * TMPDIR inside the workspace folder, with `cacheDir` the package caches
 * under it, then the configured `env`.
 */
export function buildEnv(dir: string, env: Record<string, string>, cacheDir?: string): Record<string, string> {
    const base: Record<string, string> = { PATH: process.env.PATH || FALLBACK_PATH };

    for (const [key, value] of Object.entries(SANDBOX_ENV)) {
        if (key === 'HOME' || (key.startsWith('GIT_CONFIG_') && key !== 'GIT_CONFIG_NOSYSTEM')) {
            continue;
        }

        base[key] = value;
    }

    return {
        ...base,
        HOME: join(dir, 'home'),
        TMPDIR: join(dir, 'tmp'),
        ...(cacheDir !== undefined && cacheEnv(cacheDir)),
        ...env,
    };
}

export function errnoCode(error: unknown): string | undefined {
    const { code } = (error ?? {}) as { code?: unknown };

    return typeof code === 'string' ? code : undefined;
}

/** The `workspace.json` of a workspace. */
export function toRecord(info: WorkspaceInfo, deployment: string, env?: Record<string, string>): WorkspaceRecord {
    const record: WorkspaceRecord = {
        runId: info.runId,
        deployment,
        createdAt: info.createdAt.toISOString(),
        expiresAt: info.expiresAt.toISOString(),
    };

    if (info.repo !== undefined) {
        record.repo = info.repo;
    }

    if (info.ref !== undefined) {
        record.ref = info.ref;
    }

    if (env !== undefined && Object.keys(env).length > 0) {
        record.env = env;
    }

    return record;
}

function readTime(value: unknown): Date | undefined {
    const time = typeof value === 'string' ? Date.parse(value) : NaN;

    return Number.isNaN(time) ? undefined : new Date(time);
}

/**
 * A parsed `workspace.json`; undefined without a run or a readable expiry.
 * A record of an earlier version (no deployment, no creation time) reads as
 * the default deployment, created at its expiry.
 */
export function parseRecord(value: unknown): ParsedRecord | undefined {
    if (!isObject(value)) {
        return undefined;
    }

    const {
        runId,
        deployment,
        repo,
        ref,
        env,
    } = value;
    const expiresAt = readTime(value.expiresAt);

    if (typeof runId !== 'string' || runId.length === 0 || !expiresAt) {
        return undefined;
    }

    const info: WorkspaceInfo = {
        runId,
        provider: LOCAL_PROVIDER_NAME,
        createdAt: readTime(value.createdAt) ?? expiresAt,
        expiresAt,
    };

    if (typeof repo === 'string') {
        info.repo = repo;
    }

    if (typeof ref === 'string') {
        info.ref = ref;
    }

    const parsed: ParsedRecord = {
        runId,
        deployment: typeof deployment === 'string' ? deployment : DEFAULT_DEPLOYMENT,
        info,
    };

    if (env !== undefined) {
        try {
            assertSandboxEnv(env as Record<string, string>);
            parsed.env = env as Record<string, string>;
        } catch {
            return undefined;
        }
    }

    return parsed;
}
