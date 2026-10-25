/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { jsonSchema } from 'ai';
import type { JSONSchema7 } from 'ai';
import { SandboxError, ValidationError } from '@chamvi/core';
import type { ToolContext } from '@chamvi/core';
import { resolveWorkspacePath } from '@chamvi/sandbox';
import type { ExecResult, IWorkspace } from '@chamvi/sandbox';
import { isObject } from 'smob';
import { GIT_ERROR_MAX_CHARS, HOME_LOG_PATTERN, WORKSPACE_PROPERTY } from './constants.ts';
import type { CodingWorkspaces } from './types.ts';

/** The tool input as an object, else a ValidationError (a tool error the model can correct). */
export function inputObject(input: unknown): Record<string, unknown> {
    if (!isObject(input)) {
        throw new ValidationError('The tool input must be an object.');
    }
    return input;
}

/** A non-empty string, else a ValidationError. */
export function requireString(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new ValidationError(`${name} must be a non-empty string.`);
    }
    return value;
}

/** A string (empty allowed), else a ValidationError. */
export function requireText(value: unknown, name: string): string {
    if (typeof value !== 'string') {
        throw new ValidationError(`${name} must be a string.`);
    }
    return value;
}

/** A non-empty string or undefined, else a ValidationError. */
export function optionalString(value: unknown, name: string): string | undefined {
    if (value === undefined) return undefined;
    return requireString(value, name);
}

/** A boolean or undefined, else a ValidationError. */
export function optionalBoolean(value: unknown, name: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') {
        throw new ValidationError(`${name} must be a boolean.`);
    }
    return value;
}

/** An integer in `[min, max]` or undefined, else a ValidationError. */
export function optionalInteger(value: unknown, name: string, min: number, max: number): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
        throw new ValidationError(`${name} must be an integer from ${min} to ${max}.`);
    }
    return value;
}

/** A workspace-relative path ('.' for the root); ValidationError for escapes. */
export function requirePath(value: unknown, name = 'path'): string {
    return resolveWorkspacePath(requireString(value, name));
}

/**
 * The path below `$HOME` of an output log (`~/.chamvi/out/<id>.stdout.log`,
 * `~/.chamvi/jobs/<id>/output`), undefined for any other path.
 */
export function homeLogPath(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    return HOME_LOG_PATTERN.exec(value)?.[1];
}

/** An optional workspace-relative path, '.' when omitted. */
export function optionalPath(value: unknown, name = 'path'): string {
    if (value === undefined) return '.';
    return requirePath(value, name);
}

/** The calling run's workspace named by `input.workspace`, or its only one (found again after a restart). */
export async function workspaceOf(
    workspaces: CodingWorkspaces,
    body: Record<string, unknown>,
    context: ToolContext,
): Promise<IWorkspace> {
    const id = optionalString(body.workspace, 'workspace');
    return workspaces.get(context.run.runId, id);
}

/** The call's abort signal combined with the run's. */
export function signalOf(abortSignal: AbortSignal | undefined, context: ToolContext): AbortSignal {
    const { signal } = context.run;
    if (!abortSignal || abortSignal === signal) return signal;
    return AbortSignal.any([abortSignal, signal]);
}

/** git's stderr (else stdout), trimmed and cut. */
export function gitMessage(result: ExecResult): string {
    const text = (result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`);
    return text.length > GIT_ERROR_MAX_CHARS ? `${text.slice(0, GIT_ERROR_MAX_CHARS)}...` : text;
}

/** A SandboxError for a git command that failed in the workspace. */
export function gitFailure(what: string, result: ExecResult): SandboxError {
    if (result.timedOut) {
        return new SandboxError(`${what} timed out.`);
    }
    return new SandboxError(`${what} failed: ${gitMessage(result)}`);
}

/** `text` cut to at most `max` UTF-16 units, never inside a surrogate pair. */
export function cutText(text: string, max: number): string {
    if (text.length <= max) return text;
    const code = text.charCodeAt(max - 1);
    const end = code >= 0xD800 && code <= 0xDBFF ? max - 1 : max;
    return text.slice(0, end);
}

/** The lines of `text`; a trailing newline ends the last line, it opens none. */
export function linesOf(text: string): string[] {
    if (text.length === 0) return [];
    const lines = text.split('\n');
    if (lines.at(-1) === '') lines.pop();
    return lines;
}

/** The media type of a png, jpeg, gif or webp image by its first bytes, else undefined. */
export function imageTypeOf(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | undefined {
    const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
    if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 8) === 'PNG\r\n\x1A\n') return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
    if (bytes.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'image/gif';
    if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
    return undefined;
}

/** The queue key of a file: workspace ids are UUIDs, so no two workspaces share one. */
export function fileKey(workspaceId: string, path: string): string {
    return `${workspaceId}:${path}`;
}

/**
 * A queue per key: each call runs `fn` once every earlier call with the same
 * key settled. The AI SDK runs the tool calls of one step at once, so this
 * keeps two edits of one file from reading the same content.
 */
export function createKeyedQueue(): <T>(key: string, fn: () => Promise<T>) => Promise<T> {
    const tails = new Map<string, Promise<void>>();
    return <T>(key: string, fn: () => Promise<T>): Promise<T> => {
        const run = (tails.get(key) ?? Promise.resolve()).then(fn);
        const tail = run.then(() => undefined, () => undefined);
        tails.set(key, tail);
        tail.then(() => {
            if (tails.get(key) === tail) tails.delete(key);
        });
        return run;
    };
}

/** An object schema of `properties` (plus `workspace`), `required` ones required. */
export function objectSchema<T>(properties: Record<string, JSONSchema7>, required: string[] = []) {
    return jsonSchema<T>({
        type: 'object',
        properties: { ...properties, workspace: WORKSPACE_PROPERTY },
        required,
        additionalProperties: false,
    });
}

/** `text` through the workspace's credential redaction (`IWorkspace.redact`), when it has one. */
export function redactText(workspace: IWorkspace, text: string): string {
    return workspace.redact ? workspace.redact(text) : text;
}
