/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { jsonSchema } from 'ai';
import type { JSONSchema7 } from 'ai';
import {
    ChamviError,
    InvalidAgentDefinitionError,
    ValidationError,
    systemClock,
} from '@chamvi/core';
import type { IClock, ToolContext } from '@chamvi/core';
import { createClient, isClient, isHttpResponseError } from 'hapic';
import type { IClient } from 'hapic';
import { isObject } from 'smob';
import { isBlockedAddress } from '../address/module.ts';
import {
    TIMER_MAX_MS,
    WEB_FETCH_MAX_BYTES,
    WEB_MAX_REDIRECTS,
    WEB_REQUEST_ERROR_CODE,
    WEB_TIMEOUT_MS,
} from './constants.ts';
import type {
    WebLookup,
    WebToolsOptions,
    WebUrlPolicy,
} from './types.ts';

export type ResolvedWebOptions = {
    client: IClient;
    lookup: WebLookup;
    allowUrl?: WebUrlPolicy;
    maxBytes: number;
    timeoutMs: number;
    clock: IClock;
};

export type WebResponse = {
    url: URL;
    status: number;
    contentType: string | null;
    bytes: Uint8Array;
    truncated: boolean;
};

function positiveInteger(value: unknown, name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
        throw new InvalidAgentDefinitionError(`webTools() ${name} must be an integer from 1 to ${max}.`);
    }
    return value;
}

/** `dns.lookup` with every address; the signal ends the wait, not the lookup. */
export const systemLookup: WebLookup = async (hostname, signal) => {
    signal.throwIfAborted();
    const answers = await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
        const onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        dnsLookup(hostname, { all: true, verbatim: true })
            .then(resolve, reject)
            .finally(() => signal.removeEventListener('abort', onAbort));
    });
    return answers.map((answer) => ({ address: answer.address, family: answer.family }));
};

/** The options checked, with their defaults (InvalidAgentDefinitionError). */
export function resolveOptions(options: WebToolsOptions): ResolvedWebOptions {
    if (!isObject(options)) {
        throw new InvalidAgentDefinitionError('webTools() options must be an object.');
    }
    if (options.client !== undefined && !isClient(options.client)) {
        throw new InvalidAgentDefinitionError('webTools() client must be a hapic client.');
    }
    for (const name of ['lookup', 'allowUrl'] as const) {
        if (options[name] !== undefined && typeof options[name] !== 'function') {
            throw new InvalidAgentDefinitionError(`webTools() ${name} must be a function.`);
        }
    }
    const clock = options.clock ?? systemClock;
    if (!isObject(clock) || typeof clock.now !== 'function' || typeof clock.setTimeout !== 'function') {
        throw new InvalidAgentDefinitionError('webTools() clock must have now() and setTimeout().');
    }
    return {
        client: options.client ?? createClient(),
        lookup: options.lookup ?? systemLookup,
        allowUrl: options.allowUrl,
        maxBytes: positiveInteger(options.maxBytes, 'maxBytes', WEB_FETCH_MAX_BYTES),
        timeoutMs: positiveInteger(options.timeoutMs, 'timeoutMs', WEB_TIMEOUT_MS, TIMER_MAX_MS),
        clock,
    };
}

/** A failed request as a tool error (code `web_request`). */
export function requestError(message: string): ChamviError {
    return new ChamviError({ message, code: WEB_REQUEST_ERROR_CODE });
}

/** An error's message (its `code` for a bare system error). */
export function messageOf(error: unknown): string {
    if (error instanceof Error) {
        const { cause } = (error as { cause?: unknown });
        const message = error.message || String((error as { code?: unknown }).code ?? error.name);
        return cause instanceof Error && cause.message && !message.includes(cause.message) ? `${message} (${cause.message})` : message;
    }
    return String(error);
}

/** An absolute http(s) URL without credentials, else a ValidationError. */
export function parseWebUrl(input: string | URL): URL {
    let url: URL;
    try {
        url = new URL(input);
    } catch {
        throw new ValidationError('url must be an absolute http or https URL.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new ValidationError(`Only http and https URLs can be fetched, not ${url.protocol}.`);
    }
    if (url.username || url.password) {
        throw new ValidationError('A URL with credentials cannot be fetched.');
    }
    return url;
}

/**
 * Refuses `url` when `allowUrl` says so, or (unless it allows the URL) when
 * its host is or resolves to an address that is not public (loopback,
 * private, link-local, metadata, ...). The request resolves the name again,
 * so a host answering differently the second time (DNS rebinding) is not
 * covered; `allowUrl` and a network policy are the operator's tools for that.
 */
export async function checkUrl(url: URL, options: ResolvedWebOptions, signal: AbortSignal): Promise<void> {
    const decision = options.allowUrl?.(url);
    if (decision === false) {
        throw new ValidationError(`${url.href} is not allowed.`);
    }
    if (decision === true) return;
    const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
    let addresses: string[];
    if (isIP(host) !== 0) {
        addresses = [host];
    } else {
        try {
            addresses = (await options.lookup(host, signal)).map((entry) => entry.address);
        } catch (error) {
            if (signal.aborted) throw error;
            throw requestError(`${host} could not be resolved: ${messageOf(error)}`);
        }
        if (addresses.length === 0) throw requestError(`${host} has no address.`);
    }
    if (addresses.some((address) => isBlockedAddress(address))) {
        throw new ValidationError(`${host} is no public address; web_fetch reaches public addresses only.`);
    }
}

/** Reads `body` up to `max` bytes; `truncated` when more followed (the rest is cancelled). */
export async function readCapped(
    body: ReadableStream<Uint8Array> | null | undefined,
    max: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
    if (!body) return { bytes: new Uint8Array(0), truncated: false };
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    let truncated = false;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const room = max - length;
            if (value.byteLength > room) {
                chunks.push(value.subarray(0, room));
                length = max;
                truncated = true;
                break;
            }
            chunks.push(value);
            length += value.byteLength;
        }
    } finally {
        if (truncated) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.byteLength;
    }
    return { bytes, truncated };
}

/**
 * GETs `input` through the hapic client, checking the URL and every
 * redirect target (at most `WEB_MAX_REDIRECTS`) before the request, and
 * reads at most `maxBytes` of the body. A 4xx or 5xx status, a network
 * failure and the timeout are `web_request` tool errors.
 */
export async function getPage(input: string, options: ResolvedWebOptions, signal: AbortSignal): Promise<WebResponse> {
    const timeout = new AbortController();
    const timer = options.clock.setTimeout(() => {
        timeout.abort(requestError(`The request did not finish within ${options.timeoutMs}ms.`));
    }, options.timeoutMs);
    const combined = AbortSignal.any([signal, timeout.signal]);
    try {
        let url = parseWebUrl(input);
        for (let hop = 0; ; hop++) {
            await checkUrl(url, options, combined);
            let response: Response & { data?: ReadableStream<Uint8Array> };
            try {
                response = await options.client.get(url.href, {
                    redirect: 'manual',
                    responseType: 'stream',
                    signal: combined,
                });
            } catch (error) {
                if (timeout.signal.aborted) throw timeout.signal.reason;
                if (signal.aborted) throw error;
                if (isHttpResponseError(error)) {
                    await error.response?.body?.cancel().catch(() => undefined);
                    throw requestError(`${url.href} answered ${error.status ?? error.response?.status}.`);
                }
                throw requestError(`Fetching ${url.href} failed: ${messageOf(error)}`);
            }
            const location = response.headers.get('location');
            if (response.status >= 300 && response.status < 400 && location) {
                await response.body?.cancel().catch(() => undefined);
                if (hop >= WEB_MAX_REDIRECTS) {
                    throw requestError(`${input} redirected more than ${WEB_MAX_REDIRECTS} times.`);
                }
                let target: URL;
                try {
                    target = new URL(location, url);
                } catch {
                    throw requestError(`${url.href} redirected to an invalid location.`);
                }
                url = parseWebUrl(target);
                continue;
            }
            const { bytes, truncated } = await readCapped(response.data ?? response.body, options.maxBytes);
            return {
                url,
                status: response.status,
                contentType: response.headers.get('content-type'),
                bytes,
                truncated,
            };
        }
    } catch (error) {
        if (timeout.signal.aborted && !signal.aborted) throw timeout.signal.reason;
        throw error;
    } finally {
        timer.clear();
    }
}

/** The tool input as an object, else a ValidationError (a tool error the model can correct). */
export function inputObject(input: unknown): Record<string, unknown> {
    if (!isObject(input)) {
        throw new ValidationError('The tool input must be an object.');
    }
    return input;
}



/** A non-empty string, else a ValidationError. */
export function requireString(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new ValidationError(`${name} must be a non-empty string.`);
    }
    return value;
}

/** An integer in `[min, max]` or undefined, else a ValidationError. */
export function optionalInteger(value: unknown, name: string, min: number, max = Number.MAX_SAFE_INTEGER): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
        throw new ValidationError(`${name} must be an integer from ${min} to ${max}.`);
    }
    return value;
}

/** One of `allowed` or undefined, else a ValidationError. */
export function optionalOneOf<T extends string>(value: unknown, name: string, allowed: readonly T[]): T | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
        throw new ValidationError(`${name} must be one of ${allowed.join(', ')}.`);
    }
    return value as T;
}

/** The call's abort signal combined with the run's. */
export function signalOf(abortSignal: AbortSignal | undefined, context: ToolContext): AbortSignal {
    const { signal } = context.run;
    if (!abortSignal || abortSignal === signal) return signal;
    return AbortSignal.any([abortSignal, signal]);
}

/** `text` from `offset`, at most `max` UTF-16 units, never ending inside a surrogate pair. */
export function cutText(text: string, offset: number, max: number): string {
    const end = offset + max;
    if (end >= text.length) return text.slice(offset);
    const code = text.charCodeAt(end - 1);
    return text.slice(offset, code >= 0xD800 && code <= 0xDBFF ? end - 1 : end);
}

/** An object schema of `properties`, the `required` ones required. */
export function objectSchema<T>(properties: Record<string, JSONSchema7>, required: string[] = []) {
    return jsonSchema<T>({
        type: 'object',
        properties,
        required,
        additionalProperties: false,
    });
}
