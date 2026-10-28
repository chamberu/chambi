/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock } from '@chamvi/core';

/** One instruction file, read whole: an entrypoint (`AGENTS.md`, `CLAUDE.md`) or a file one includes. */
export type RepositoryInstructionSource = {
    /** Workspace-relative path, the canonical one (no symbolic link is ever followed). */
    path: string;
    /** SHA-256 (hex) of the file's bytes as read, before any redaction of `content`. */
    sha256: string;
    /** The UTF-8 text, passed through the workspace's credential redaction. */
    content: string;
    /** The directories whose entrypoint reaches this file (`.` for the root), in discovery order. */
    scopes: string[];
    /** The files including it, in discovery order; empty for an entrypoint reached only as one. */
    includedBy: string[];
};

export type RepositoryInstructionDiagnosticCode = 'missing-include' | 'unreadable' | 'invalid-utf8' | 'outside-workspace' |
    'unsupported-file' | 'cycle' | 'limit';

/** Why a file, directory or reference was skipped; any diagnostic makes the result incomplete. */
export type RepositoryInstructionDiagnostic = {
    path: string;
    code: RepositoryInstructionDiagnosticCode;
    message: string;
};

/**
 * The development guidance a repository holds for some paths: guidance,
 * never authorization. It reflects the worktree when it was read, not a
 * frozen checkout.
 */
export type RepositoryInstructions = {
    /** The workspace's checkout commit, when known. */
    commit: string | null;
    /** The requested paths, normalized, that were looked at. */
    paths: string[];
    /** Root first, then each deeper directory; per directory `AGENTS.md`, then `CLAUDE.md`, each followed by what it includes. */
    sources: RepositoryInstructionSource[];
    diagnostics: RepositoryInstructionDiagnostic[];
    /** False once any diagnostic was reported. */
    complete: boolean;
};

export type ReadRepositoryInstructionsOptions = {
    signal?: AbortSignal;
    /** Measures the request's time bound; default `systemClock`. */
    clock?: IClock;
};

/** What the discovery script observed for one path. */
export type InspectionStatus = { kind: 'absent' | 'file' | 'dir' | 'special' } |
    /** Component `at` (1-based) is a symbolic link. */
    { kind: 'link'; at: number } |
    /** Component `at` (1-based) cannot be looked up: its parent is no searchable directory. */
    { kind: 'denied'; at: number };

/** What the discovery script read for one path. */
export type ReadOutcome = InspectionStatus |
    /** The file could not be opened or read. */
    { kind: 'unreadable' } |
    { kind: 'bytes'; bytes: Uint8Array };

export type IncludeTarget = { kind: 'path'; path: string } | {
    kind: 'diagnostic';
    code: RepositoryInstructionDiagnosticCode;
    message: string;
};

export type DiagnosticList = {
    readonly entries: RepositoryInstructionDiagnostic[];
    add(path: string, code: RepositoryInstructionDiagnosticCode, message: string): void;
};
