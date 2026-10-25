/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { jsonSchema } from 'ai';
import type { JSONSchema7, ModelMessage, ToolExecutionOptions } from 'ai';
import { ChamviError, FatalToolError, ValidationError } from '@chamvi/core';
import type { ToolContext } from '@chamvi/core';
import { isObject } from 'smob';
import { isChannelOf } from '../app/helpers.ts';
import type { GithubOctokit, IGithubApp } from '../app/types.ts';
import { GITHUB_CHANNEL_NAME } from '../channel/constants.ts';
import type { NumberInput, RepoInput } from './types.ts';
import { GITHUB_REQUEST_ERROR_CODE, REPO_PATTERN } from './constants.ts';

/**
 * The installation a tool acts as: the delivery's for a run a GitHub
 * channel of this app started (the default `github`, or any name a
 * githubChannel({ app }) took), else the app's `installationId`. A payload
 * of another channel never chooses the installation, since its caller could
 * name any. Neither is a FatalToolError, since every GitHub tool of the run
 * would fail.
 */
export function installationIdOf(ctx: ToolContext, app: IGithubApp): number {
    const { trigger } = ctx.run;
    const fromGithub = trigger.channel === GITHUB_CHANNEL_NAME || isChannelOf(app, trigger.channel);
    if (fromGithub && isObject(trigger.payload)) {
        const { installationId } = trigger.payload;
        if (typeof installationId === 'number') return installationId;
    }
    if (app.installationId !== undefined) return app.installationId;
    throw new FatalToolError('The run has no GitHub installation: start it from a GitHub delivery or set installationId on createGithubApp().');
}

const REPO = new RegExp(REPO_PATTERN);

/** `owner/name`; a ValidationError (a tool error the model can correct) otherwise. */
export function parseRepo(repo: unknown): { owner: string; repo: string } {
    const match = typeof repo === 'string' ? REPO.exec(repo) : null;
    if (!match?.[1] || !match[2]) {
        throw new ValidationError(`repo must look like "owner/name", got ${JSON.stringify(repo)}.`);
    }
    return { owner: match[1], repo: match[2] };
}

/** An integer in `[min, max]`, else a ValidationError. */
export function requireInteger(value: unknown, name: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
        throw new ValidationError(`${name} must be an integer from ${min} to ${max}.`);
    }
    return value;
}

/** A non-empty string, else a ValidationError. */
export function requireString(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new ValidationError(`${name} must be a non-empty string.`);
    }
    return value;
}

function hasPart(message: ModelMessage, type: string, toolCallId: string): boolean {
    return Array.isArray(message.content) &&
        message.content.some((part: unknown) => isObject(part) && part.type === type && part.toolCallId === toolCallId);
}

/**
 * The model step a call belongs to. On the approval path the AI SDK passes
 * messages that already hold the requesting assistant message: the one
 * carrying a tool-call with `options.toolCallId` whose result is not among
 * the tool messages after it, so a provider that reuses call ids across
 * steps never points the call at an earlier step. Its step is the number of
 * assistant messages before it; without one (the normal path) all of them.
 */
export function stepOf(options: Pick<ToolExecutionOptions<unknown>, 'toolCallId' | 'messages'>): number {
    const { messages, toolCallId } = options;
    let step = 0;
    for (const [index, message] of messages.entries()) {
        if (message.role !== 'assistant') continue;
        if (hasPart(message, 'tool-call', toolCallId)) {
            let answered = false;
            for (let next = index + 1; next < messages.length && messages[next]!.role !== 'assistant'; next++) {
                if (messages[next]!.role === 'tool' && hasPart(messages[next]!, 'tool-result', toolCallId)) answered = true;
            }
            if (!answered) return step;
        }
        step++;
    }
    return step;
}

/** The HTTP status of an Octokit RequestError, else undefined. */
export function statusOf(error: unknown): number | undefined {
    if (error instanceof Error && error.name === 'HttpError' && typeof (error as { status?: unknown }).status === 'number') {
        return (error as unknown as { status: number }).status;
    }
    return undefined;
}

/**
 * What a tool throws for a failed GitHub call: `GitHub <status>: <message>`,
 * never the request (an Octokit RequestError carries its headers).
 * chamvi errors (FatalToolError, ValidationError) pass through.
 */
export function toolError(error: unknown): Error {
    if (error instanceof ChamviError) return error;
    const status = statusOf(error);
    const message = error instanceof Error ? error.message : String(error);
    return new ChamviError({
        message: status !== undefined ? `GitHub ${status}: ${message}` : `GitHub request failed: ${message}`,
        code: GITHUB_REQUEST_ERROR_CODE,
    });
}

/**
 * Runs `fn` with the run's installation Octokit, every request bound to the
 * run's signal (cancel, drain and the run timeout abort a stalled GitHub
 * call); every failure through `toolError`.
 */
export async function withOctokit<T>(
    app: IGithubApp,
    ctx: ToolContext,
    fn: (octokit: GithubOctokit) => Promise<T>,
): Promise<T> {
    try {
        const octokit = await app.octokit(installationIdOf(ctx, app));
        const { signal } = ctx.run;
        octokit.hook.before('request', (options) => {
            options.request = { ...options.request, signal };
        });
        return await fn(octokit);
    } catch (error) {
        throw toolError(error);
    }
}

export const REPO_PROPERTY: JSONSchema7 = {
    type: 'string',
    pattern: REPO_PATTERN,
    description: 'The repository as "owner/name".',
};

/** An object schema of `properties`, all required unless listed in `optional`. */
export function objectSchema<T>(properties: Record<string, JSONSchema7>, optional: string[] = []) {
    return jsonSchema<T>({
        type: 'object',
        properties,
        required: Object.keys(properties).filter((key) => !optional.includes(key)),
        additionalProperties: false,
    });
}

/** `{ repo, number }` for an issue or a pull request. */
export function numberSchema<T extends NumberInput = NumberInput>(what: string, extra: Record<string, JSONSchema7> = {}, optional: string[] = []) {
    return objectSchema<T>({
        repo: REPO_PROPERTY,
        number: {
            type: 'integer', 
            minimum: 1, 
            description: `The ${what} number.`, 
        },
        ...extra,
    }, optional);
}

/** `{ repo }`. */
export function repoSchema() {
    return objectSchema<RepoInput>({ repo: REPO_PROPERTY });
}

type Version = { core: number[]; pre: string[] };

/** The version a release tag names: `tagPrefix` and a leading `v` removed, else undefined (no version). */
export function versionOf(tag: string, tagPrefix = ''): Version | undefined {
    if (!tag.startsWith(tagPrefix)) return undefined;
    const match = /^v?(\d+(?:\.\d+){0,3})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(tag.slice(tagPrefix.length));
    if (!match?.[1]) return undefined;
    return { core: match[1].split('.').map(Number), pre: match[2] ? match[2].split('.') : [] };
}

function comparePre(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) return b.length - a.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i];
        const y = b[i];
        if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
        const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
        if (numeric && Number(x) !== Number(y)) return Number(x) - Number(y);
        if (!numeric && x !== y) return x < y ? -1 : 1;
    }
    return 0;
}

/** Semver order; missing components count as 0 (`1.2` equals `1.2.0`). */
export function compareVersions(a: Version, b: Version): number {
    for (let i = 0; i < Math.max(a.core.length, b.core.length); i++) {
        const diff = (a.core[i] ?? 0) - (b.core[i] ?? 0);
        if (diff !== 0) return diff;
    }
    return comparePre(a.pre, b.pre);
}

/** A version bound of the input (`from`, `to`), else a ValidationError. */
export function versionBound(value: unknown, name: string, tagPrefix: string): Version | undefined {
    if (value === undefined) return undefined;
    const text = requireString(value, name);
    const version = versionOf(text.startsWith(tagPrefix) ? text : `${tagPrefix}${text}`, tagPrefix);
    if (!version) {
        throw new ValidationError(`${name} must be a version like 1.2.3 or v1.2.3, got ${JSON.stringify(text)}.`);
    }
    return version;
}

/** `text` cut after `max` characters. */
export function cut(text: string, max: number): { text: string; truncated: boolean } {
    return text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false };
}
