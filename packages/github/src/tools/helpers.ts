/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { jsonSchema } from 'ai';
import type { JSONSchema7, ModelMessage, ToolExecutionOptions } from 'ai';
import { ChamviError, ValidationError } from '@chamvi/core';
import type { ToolContext } from '@chamvi/core';
import { isObject } from 'smob';
import { isChannelOf } from '../app/helpers.ts';
import type { GithubOctokit, IGithubApp } from '../app/types.ts';
import { GITHUB_CHANNEL_NAME } from '../channel/constants.ts';
import type { NumberInput, RepoInput, RepoTarget } from './types.ts';
import { GITHUB_REQUEST_ERROR_CODE, REF_PATTERN, REPO_PATTERN } from './constants.ts';

function isGithubRun(ctx: ToolContext, app: IGithubApp): boolean {
    const { channel } = ctx.run.trigger;
    return channel === GITHUB_CHANNEL_NAME || isChannelOf(app, channel);
}

/** The delivery's installation of a run a GitHub channel of this app started, else undefined. */
function eventInstallation(ctx: ToolContext, app: IGithubApp): { id: number; repository?: string } | undefined {
    const { payload } = ctx.run.trigger;
    if (!isGithubRun(ctx, app) || !isObject(payload) || typeof payload.installationId !== 'number') return undefined;
    const event = isObject(payload.payload) ? payload.payload : {};
    const repository = isObject(event.repository) && typeof event.repository.full_name === 'string' ?
        event.repository.full_name :
        undefined;
    return { id: payload.installationId, ...(repository ? { repository } : {}) };
}

/**
 * The installation a tool acts as for `target`: (1) the delivery's for a
 * run a GitHub channel of this app started (the default `github`, or any
 * name a githubChannel({ app }) took) on the same repository (compared
 * case-insensitively, no request); (2) the App's installation on the
 * repository (`app.installationFor`); (3) the delivery's installation for
 * any repository, else the app's `installationId`, so a public repository
 * the App is not installed on is still readable. A payload of another
 * channel never chooses the installation, since its caller could name any.
 * Without `target` only (3). Without any, a `github_request` ChamviError (a
 * tool error, never a FatalToolError, since every GitHub tool of the run
 * would fail).
 */
export async function installationOf(app: IGithubApp, ctx: ToolContext, target?: RepoTarget): Promise<number> {
    const event = eventInstallation(ctx, app);
    if (target) {
        const name = `${target.owner}/${target.repo}`.toLowerCase();
        if (event?.repository?.toLowerCase() === name) return event.id;
        const found = await app.installationFor(target);
        if (found !== undefined) return found;
    }
    if (event) return event.id;
    if (app.installationId !== undefined) return app.installationId;
    const where = target ? ` on ${target.owner}/${target.repo}` : '';
    throw new ChamviError({
        code: GITHUB_REQUEST_ERROR_CODE,
        message: `The GitHub App is not installed${where} and the run has no default installation ` +
            '(start it from a GitHub delivery or set installationId on createGithubApp()).',
    });
}

/** A user's login, else null (a deleted account). */
export function login(user: unknown): string | null {
    return isObject(user) && typeof user.login === 'string' ? user.login : null;
}

/** A label's name (GitHub sends objects, older payloads strings). */
export function labelName(label: unknown): string {
    if (typeof label === 'string') return label;
    return isObject(label) && typeof label.name === 'string' ? label.name : '';
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

/** The repository of a search query's single `repo:owner/name` qualifier (an unparsable one ignored), else undefined. */
export function searchTarget(query: string): RepoTarget | undefined {
    const targets: RepoTarget[] = [];
    for (const match of query.matchAll(/(?:^|\s)repo:(\S+)/g)) {
        try {
            targets.push(parseRepo(match[1]));
        } catch {
            // not a repository: no target from it
        }
    }
    return targets.length === 1 ? targets[0] : undefined;
}

const REF = new RegExp(REF_PATTERN);

/** A branch, tag or commit (REF_PATTERN, no `..`), else a ValidationError. */
export function requireRef(value: unknown, name: string): string {
    const ref = requireString(value, name);
    if (!REF.test(ref) || ref.includes('..')) {
        throw new ValidationError(`${name} must be a branch, tag or commit, got ${JSON.stringify(ref)}.`);
    }
    return ref;
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

/** Binds every request of `octokit` to `signal` (cancel, drain and the run timeout abort a stalled GitHub call). */
export function bindSignal(octokit: GithubOctokit, signal: AbortSignal): GithubOctokit {
    octokit.hook.before('request', (options) => {
        options.request = { ...options.request, signal };
    });
    return octokit;
}

/**
 * Runs `fn` with the Octokit of the installation `installationOf()`
 * resolves for `target`, every request bound to the run's signal; every
 * failure through `toolError`.
 */
/**
 * `promise`, or a rejection with the signal's reason once it aborts. For a
 * shared request (the single-flight installation lookup) one caller's
 * signal must not abort, so the caller only stops waiting.
 */
export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
}

export async function withOctokit<T>(
    app: IGithubApp,
    ctx: ToolContext,
    target: RepoTarget | undefined,
    fn: (octokit: GithubOctokit) => Promise<T>,
): Promise<T> {
    try {
        const { signal } = ctx.run;
        const installationId = await untilAborted(installationOf(app, ctx, target), signal);
        const octokit = bindSignal(await app.octokit(installationId), signal);
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
