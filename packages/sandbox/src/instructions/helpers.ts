/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { posix } from 'node:path';
import { SandboxError } from '@chamvi/core';
import type { ExecResult } from '../workspace/types.ts';
import {
    INSTRUCTION_DIAGNOSTICS_MAX,
    INSTRUCTION_DIAGNOSTICS_MAX_BYTES,
    INSTRUCTION_PATH_MAX_BYTES,
    INSTRUCTION_SOURCE_MAX_BYTES,
    MISSING_UTILITY_EXIT,
    PROTOCOL,
} from './constants.ts';
import type {
    DiagnosticList,
    IncludeTarget,
    InspectionStatus,
    ReadOutcome,
    RepositoryInstructionDiagnostic,
} from './types.ts';

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const INCLUDE_PATTERN = /^@(\S+)$/;
const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const STATUS_PATTERN = /^(absent|file|dir|special|(link|denied) ([1-9]\d*))$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export const byteLength = (text: string): number => Buffer.byteLength(text, 'utf8');

/**
 * The include references of an instruction text in order: lines that are
 * `@<path>` alone (surrounding whitespace allowed, none inside the path),
 * outside backtick and tilde fences of three or more characters.
 */
export function parseIncludes(text: string): string[] {
    const includes: string[] = [];
    let fence: { char: string; length: number } | undefined;
    for (const line of text.split(/\r?\n/)) {
        const match = FENCE_PATTERN.exec(line);
        const marker = match?.[1] ?? '';
        const rest = match?.[2] ?? '';
        if (fence) {
            if (match && marker[0] === fence.char && marker.length >= fence.length && rest.trim() === '') {
                fence = undefined;
            }
            continue;
        }
        // an info string of a backtick fence holds no backtick
        if (match && !(marker[0] === '`' && rest.includes('`'))) {
            fence = { char: marker.charAt(0), length: marker.length };
            continue;
        }
        const include = INCLUDE_PATTERN.exec(line.trim())?.[1];
        if (include) includes.push(include);
    }
    return includes;
}

/** Whether a normalized relative path names `.git` (any case) or something below it. */
export function isGitPath(path: string): boolean {
    return path.split('/').some((component) => component.toLowerCase() === '.git');
}

/** The first `count` components of a normalized relative path (`.` for none). */
export function pathPrefix(path: string, count: number): string {
    return count <= 0 ? '.' : path.split('/').slice(0, count).join('/');
}

/** The directories from the root down to `dir` (both included). */
export function directoryChain(dir: string): string[] {
    if (dir === '.') return ['.'];
    const components = dir.split('/');
    return ['.', ...components.map((_, index) => components.slice(0, index + 1).join('/'))];
}

/** Resolves an include reference against the file holding it, lexically and inside the workspace only. */
export function resolveInclude(including: string, reference: string): IncludeTarget {
    if (byteLength(reference) > INSTRUCTION_PATH_MAX_BYTES) {
        return {
            kind: 'diagnostic',
            code: 'limit',
            message: `The reference is longer than ${INSTRUCTION_PATH_MAX_BYTES} bytes.`,
        };
    }
    if (
        reference.includes('\0') ||
        SCHEME_PATTERN.test(reference) ||
        reference.startsWith('/') ||
        reference.startsWith('~') ||
        reference.startsWith('\\')
    ) {
        return {
            kind: 'diagnostic',
            code: 'outside-workspace',
            message: 'Only relative paths inside the workspace can be included.',
        };
    }
    let path = posix.normalize(posix.join(posix.dirname(including), reference));
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    if (path === '..' || path.startsWith('../')) {
        return {
            kind: 'diagnostic',
            code: 'outside-workspace',
            message: 'The reference leaves the workspace.',
        };
    }
    if (byteLength(path) > INSTRUCTION_PATH_MAX_BYTES) {
        return {
            kind: 'diagnostic',
            code: 'limit',
            message: `The path is longer than ${INSTRUCTION_PATH_MAX_BYTES} bytes.`,
        };
    }
    if (isGitPath(path)) {
        return {
            kind: 'diagnostic',
            code: 'unsupported-file',
            message: 'Paths in .git are never read.',
        };
    }
    return { kind: 'path', path };
}

/** Refuses an exec result that is no complete answer of the discovery script. */
export function assertScriptResult(result: ExecResult): void {
    if (result.timedOut) {
        throw new SandboxError('Repository instruction discovery timed out.');
    }
    if (result.stdoutTruncated || result.stderrTruncated) {
        throw new SandboxError('Repository instruction discovery printed more than the output cap.');
    }
    if (result.exitCode === MISSING_UTILITY_EXIT) {
        const missing = new RegExp(`^${PROTOCOL} missing (head|base64|tr)\\n$`).exec(result.stdout);
        if (missing) {
            throw new SandboxError(`Repository instruction discovery needs ${missing[1]} in /usr/bin or /bin of the workspace image.`);
        }
    }
    if (result.exitCode !== 0) {
        throw new SandboxError(`Repository instruction discovery failed (exit ${result.exitCode}).`);
    }
}

const malformed = () => new SandboxError('Repository instruction discovery answered with a malformed frame.');

function parseStatus(text: string): InspectionStatus {
    const match = STATUS_PATTERN.exec(text);
    if (!match) throw malformed();
    if (match[2] === 'link' || match[2] === 'denied') {
        return { kind: match[2], at: Number(match[3]) };
    }
    return { kind: match[1] as 'absent' | 'file' | 'dir' | 'special' };
}

/** The statuses of an `inspect` answer for `count` paths, in order. */
export function parseInspectOutput(result: ExecResult, count: number): InspectionStatus[] {
    assertScriptResult(result);
    const lines = result.stdout.split('\n');
    if (
        result.stderr !== '' ||
        lines.length !== count + 3 ||
        lines[0] !== `${PROTOCOL} inspect ${count}` ||
        lines[count + 1] !== `${PROTOCOL} end` ||
        lines[count + 2] !== ''
    ) {
        throw malformed();
    }
    return lines.slice(1, count + 1).map((line, index) => {
        const space = line.indexOf(' ');
        if (space < 0 || line.slice(0, space) !== String(index)) throw malformed();
        return parseStatus(line.slice(space + 1));
    });
}

function decodeBase64(data: string): Uint8Array {
    if (data.length % 4 !== 0 || !BASE64_PATTERN.test(data)) throw malformed();
    const bytes = Buffer.from(data, 'base64');
    // canonical only: a re-encoding gives the same text back
    if (bytes.toString('base64') !== data) throw malformed();
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** The outcome of a `read` answer. */
export function parseReadOutput(result: ExecResult): ReadOutcome {
    assertScriptResult(result);
    const lines = result.stdout.split('\n');
    const head = new RegExp(`^${PROTOCOL} read (.+)$`).exec(lines[0] ?? '')?.[1];
    if (head === undefined) throw malformed();
    if (head !== 'file') {
        if (result.stderr !== '' || lines.length !== 3 || lines[1] !== `${PROTOCOL} end` || lines[2] !== '') throw malformed();
        if (head === 'denied') return { kind: 'unreadable' };
        const status = parseStatus(head);
        if (status.kind === 'file') throw malformed();
        return status;
    }
    if (lines.length !== 4 || lines[2] !== `${PROTOCOL} end` || lines[3] !== '') throw malformed();
    const status = new RegExp(`^${PROTOCOL} head (\\d+)\\n$`).exec(result.stderr)?.[1];
    if (status === undefined) throw malformed();
    const bytes = decodeBase64(lines[1] ?? '');
    if (bytes.byteLength > INSTRUCTION_SOURCE_MAX_BYTES + 1) throw malformed();
    if (status !== '0') return { kind: 'unreadable' };
    return { kind: 'bytes', bytes };
}

/**
 * The bounded diagnostics: each path and code once, at most
 * `INSTRUCTION_DIAGNOSTICS_MAX` entries and `INSTRUCTION_DIAGNOSTICS_MAX_BYTES`
 * of paths and messages, the last slot a `limit` entry saying more were
 * dropped. Paths and messages pass through `redact` first.
 */
export function createDiagnosticList(redact: (text: string) => string): DiagnosticList {
    const entries: RepositoryInstructionDiagnostic[] = [];
    const seen = new Set<string>();
    const closing: RepositoryInstructionDiagnostic = {
        path: '.',
        code: 'limit',
        message: 'Further diagnostics were dropped.',
    };
    const reserve = byteLength(closing.path) + byteLength(closing.message);
    let bytes = 0;
    let full = false;
    return {
        entries,
        add(path, code, message) {
            if (full) return;
            const key = `${code}\0${path}`;
            if (seen.has(key)) return;
            seen.add(key);
            const entry = {
                path: redact(path),
                code,
                message: redact(message),
            };
            const size = byteLength(entry.path) + byteLength(entry.message);
            if (entries.length >= INSTRUCTION_DIAGNOSTICS_MAX - 1 || bytes + size > INSTRUCTION_DIAGNOSTICS_MAX_BYTES - reserve) {
                full = true;
                entries.push(closing);
                return;
            }
            bytes += size;
            entries.push(entry);
        },
    };
}
