/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import { ChamviError, InvalidAgentDefinitionError, systemClock } from '@chamvi/core';
import type { ChannelMessage } from '@chamvi/core';
import {
    APPROVAL_HINT,
    CHOICE_HINT,
    DEFAULT_HOOKS_PATH,
    ERROR_TEXT_MAX_LENGTH,
    IDEMPOTENCY_KEY_MAX_LENGTH,
    MESSAGE_BODY_MAX_LENGTH,
    OPENCLAW_CHANNEL_NAME,
    OPENCLAW_REQUEST_ERROR_CODE,
    OPENCLAW_TIMEOUT_MS,
} from './constants.ts';
import type { OpenclawChannelOptions, ResolvedOpenclawOptions } from './types.ts';

function invalid(message: string): InvalidAgentDefinitionError {
    return new InvalidAgentDefinitionError(`openclawChannel: ${message}`);
}

function isNonEmpty(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function optionalNonEmpty(value: unknown, label: string): string | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (!isNonEmpty(value)) {
        throw invalid(`${label} must be a non-empty string.`);
    }

    return value;
}

/** A value `fetch` sends as a header as is: Latin-1, no control character, no surrounding whitespace. */
function isHeaderSafe(value: string): boolean {
    // eslint-disable-next-line no-control-regex
    return !/[\x00-\x1F\x7F]|[^\x00-\xFF]/.test(value) && value.trim() === value;
}

function assertBaseUrl(value: unknown): string {
    if (!isNonEmpty(value)) {
        throw invalid('baseUrl must be an absolute http(s) URL.');
    }

    let url: URL;

    try {
        url = new URL(value);
    } catch {
        throw invalid('baseUrl must be an absolute http(s) URL.');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw invalid('baseUrl must be an absolute http(s) URL.');
    }

    if (url.username || url.password) {
        throw invalid('baseUrl must not carry credentials; pass hooksToken.');
    }

    if (url.search || url.hash || value.includes('?') || value.includes('#')) {
        throw invalid('baseUrl must not have a query or hash.');
    }

    return url.href;
}

/** `<baseUrl><hooksPath>/agent`, a base path of `baseUrl` kept. */
export function hookUrl(baseUrl: string, hooksPath: string): string {
    return `${baseUrl.replace(/\/+$/, '')}${hooksPath}/agent`;
}

export function resolveOptions(options: OpenclawChannelOptions): ResolvedOpenclawOptions {
    const name = options.name ?? OPENCLAW_CHANNEL_NAME;

    if (!isNonEmpty(name)) {
        throw invalid('name must be a non-empty string.');
    }

    if (!isNonEmpty(options.hooksToken)) {
        throw invalid('hooksToken must be a non-empty string.');
    }

    if (!isHeaderSafe(options.hooksToken)) {
        // fetch would refuse it on every send, with the token in its message
        throw invalid('hooksToken must not hold control characters, characters above U+00FF or surrounding whitespace.');
    }

    const baseUrl = assertBaseUrl(options.baseUrl);
    const rawHooksPath = options.hooksPath ?? DEFAULT_HOOKS_PATH;

    if (typeof rawHooksPath !== 'string' || !rawHooksPath.startsWith('/')) {
        throw invalid('hooksPath must start with "/" and must not be "/".');
    }

    // `/hooks/` would build `/hooks//agent`
    const hooksPath = rawHooksPath.replace(/\/+$/, '');

    if (hooksPath === '') {
        throw invalid('hooksPath must start with "/" and must not be "/".');
    }

    const agentId = optionalNonEmpty(options.agentId, 'agentId');
    const deliver = options.deliver as Partial<OpenclawChannelOptions['deliver']> | undefined;

    if (!isNonEmpty(deliver?.channel) || deliver.channel === 'last') {
        throw invalid('deliver.channel must name a channel ("last" is refused by OpenClaw hooks).');
    }

    if (!isNonEmpty(deliver.to)) {
        throw invalid('deliver.to must be a non-empty string.');
    }

    const accountId = optionalNonEmpty(deliver.accountId, 'deliver.accountId');

    if (options.approvalUrl !== undefined && typeof options.approvalUrl !== 'function') {
        throw invalid('approvalUrl must be a function.');
    }

    const timeoutMs = options.timeoutMs ?? OPENCLAW_TIMEOUT_MS;

    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
        throw invalid('timeoutMs must be a positive integer.');
    }

    return {
        name,
        url: hookUrl(baseUrl, hooksPath),
        hooksToken: options.hooksToken,
        ...(agentId === undefined ? {} : { agentId }),
        deliver: {
            channel: deliver.channel,
            to: deliver.to,
            ...(accountId === undefined ? {} : { accountId }),
        },
        ...(options.approvalUrl ? { approvalUrl: options.approvalUrl } : {}),
        timeoutMs,
        clock: options.clock ?? systemClock,
        fetch: options.fetch ?? globalThis.fetch,
    };
}

/**
 * `text` when it has at most `max` characters, else its first `max`
 * characters (one less when that would end on a high surrogate) and a note
 * of how many were cut.
 */
export function cutText(text: string, max: number): string {
    if (text.length <= max) {
        return text;
    }

    let end = max;
    const last = text.charCodeAt(end - 1);

    if (last >= 0xD800 && last <= 0xDBFF) {
        end--;
    }

    return `${text.slice(0, end)}\n… (cut, ${text.length - end} more characters)`;
}

/**
 * The text OpenClaw's agent turn relays: deterministic for one message (no
 * clock value, no random id), so a resend replays instead of starting a
 * second run. An approval links to the UI with `approvalUrl` (run and
 * approval id), else names where to answer; a choice approval lists its
 * options (`- <id>: <label>`, the details stay in the UI). It never carries
 * the resume token, which no channel message holds.
 */
export function renderMessage(
    message: ChannelMessage,
    options: Pick<ResolvedOpenclawOptions, 'approvalUrl'>,
): string {
    const { approvalUrl } = options;
    const sections = ['chamvi message. Relay it to the user; keep every link and id exactly as written.'];

    if (message.title) {
        sections.push(message.title);
    }

    // an approval asked without a body has none
    if (message.body) {
        sections.push(cutText(message.body, MESSAGE_BODY_MAX_LENGTH));
    }

    const choice = message.kind === 'approval' && message.options !== undefined && message.options.length > 0;

    if (choice) {
        const heading = message.multiple === true ? 'Options (choose one or more):' : 'Options (choose one):';

        sections.push([heading, ...(message.options ?? []).map((option) => `- ${option.id}: ${option.label}`)].join('\n'));
    }

    sections.push(`Agent: ${message.agent}\nRun: ${message.runId}`);

    if (message.kind === 'approval') {
        const lines: string[] = [];

        if (message.expiresAt) {
            lines.push(`Expires: ${message.expiresAt.toISOString()}`);
        }

        const link = approvalUrl && message.approvalId ?
            approvalUrl({
                runId: message.runId,
                approvalId: message.approvalId,
                agent: message.agent,
            }) :
            undefined;

        if (choice) {
            lines.push(link ? `Choose and approve or deny: ${link}` : CHOICE_HINT);
        } else {
            lines.push(link ? `Approve or deny: ${link}` : APPROVAL_HINT);
        }

        sections.push(lines.join('\n'));
    }

    return sections.join('\n\n');
}

/**
 * The key as OpenClaw uses it (visible ASCII, at most 256 characters), else a
 * stable `sha256:<hex>` stand-in: OpenClaw trims a key and ignores a longer
 * one, which would turn off its replay.
 */
export function transportKey(key: string): string {
    if (key.length <= IDEMPOTENCY_KEY_MAX_LENGTH && /^[\x21-\x7E]+$/.test(key)) {
        return key;
    }

    return `sha256:${createHash('sha256').update(key).digest('hex')}`;
}

/** Every occurrence of a non-empty secret replaced by `[redacted]`. */
export function redact(text: string, secrets: readonly (string | undefined)[]): string {
    let out = text;

    for (const secret of secrets) {
        if (secret) {
            out = out.split(secret).join('[redacted]');
        }
    }

    return out;
}

/** The message of a failed `fetch`, with its cause (undici keeps ECONNREFUSED, ENOTFOUND, TLS errors there), redacted. */
export function fetchErrorMessage(error: unknown, secrets: readonly (string | undefined)[]): string {
    let message = Error.isError(error) ? error.message : String(error);

    if (Error.isError(error) && Error.isError(error.cause) && error.cause.message) {
        message += ` (${error.cause.message})`;
    }

    return cutText(redact(message, secrets), ERROR_TEXT_MAX_LENGTH);
}

export function requestError(message: string): ChamviError {
    return new ChamviError({ message, code: OPENCLAW_REQUEST_ERROR_CODE });
}

/** `OpenClaw <status>: <text>`, redacted, then cut. */
export function responseError(
    status: number,
    text: string,
    retryAfter: string | null,
    secrets: readonly (string | undefined)[],
): ChamviError {
    const detail = cutText(redact(text.trim(), secrets), ERROR_TEXT_MAX_LENGTH) || 'no response body';
    const retry = retryAfter ? ` (retry after ${cutText(redact(retryAfter, secrets), 64)})` : '';

    return requestError(`OpenClaw ${status}: ${detail}${retry}`);
}
