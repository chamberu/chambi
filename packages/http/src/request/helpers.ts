/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { assertTriggerKey } from '@chamvi/core';
import { flattenIssueItems } from '@ebec/core';
import type { Issue } from '@ebec/core';
import {
    BadRequestError,
    RequestEntityTooLargeError,
    UnsupportedMediaTypeError,
} from '@ebec/http';
import { createURLCodec } from '@rapiq/codec-url';
import {
    CodecError,
    isFilter,
    isFilters,
    isParseError,
} from '@rapiq/core';
import type { Schema } from '@rapiq/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { buildIssuesForStandardSchemaIssues } from '@validup/standard-schema';
import type { IAppEvent } from 'routup';
import { isObject } from 'smob';
import type { Container } from 'validup';
import { MAX_PAGE_LIMIT } from '../app/constants.ts';
import { KEY_MAX_LENGTH, RECEIVED_MAX_LENGTH } from './constants.ts';
import type { DecodedQuery, ReadRequestBodyOptions } from './types.ts';

/** `application/json` or a `+json` media type (parameters ignored). */
export function isJsonMediaType(contentType: string | null): boolean {
    if (!contentType) {
        return false;
    }

    const type = (contentType.split(';')[0] ?? '').trim().toLowerCase();

    return type === 'application/json' || /^[a-z0-9.+-]+\/[a-z0-9.+-]+\+json$/.test(type);
}

function tooLarge(limit: number): RequestEntityTooLargeError {
    return new RequestEntityTooLargeError({ message: `The request body exceeds ${limit} bytes.` });
}

function unsupported(): UnsupportedMediaTypeError {
    return new UnsupportedMediaTypeError({ message: 'The request body must be application/json.' });
}

/**
 * Discards the rest of a refused body, at most `max` bytes, so a keep-alive
 * connection can serve the next request; false when the body is longer
 * (or the read fails) and the connection must close instead.
 */
async function drain(reader: ReadableStreamDefaultReader<Uint8Array>, max: number): Promise<boolean> {
    let size = 0;

    try {
        for (;;) {
            const { done, value } = await reader.read();

            if (done) {
                return true;
            }

            size += value.byteLength;

            if (size > max) {
                await reader.cancel().catch(() => {});

                return false;
            }
        }
    } catch {
        return false;
    }
}

/**
 * `value` when its JSON has at most `RECEIVED_MAX_LENGTH` characters, else
 * `undefined`: what a validation issue may carry as `received`.
 */
export function boundReceived(value: unknown): unknown {
    if (value === undefined) {
        return undefined;
    }

    try {
        const json = JSON.stringify(value);

        return json !== undefined && json.length <= RECEIVED_MAX_LENGTH ? value : undefined;
    } catch {
        return undefined;
    }
}

/** `issues` (groups walked) without a `received` value over `RECEIVED_MAX_LENGTH`. */
export function boundIssues(issues: readonly Issue[]): Issue[] {
    return issues.map((issue) => {
        if (issue.type === 'group') {
            return { ...issue, issues: boundIssues(issue.issues) };
        }

        if (!('received' in issue) || boundReceived(issue.received) !== undefined) {
            return issue;
        }

        const bounded = { ...issue };

        delete bounded.received;

        return bounded;
    });
}

/**
 * Answers with `connection: close`: a refused body left unread would stall
 * the next request on a keep-alive connection.
 */
function closeAfterResponse(event: IAppEvent): void {
    event.response.headers.set('connection', 'close');
}

/**
 * Reads at most `limit` bytes; `json: false` throws 415 at the first
 * non-empty chunk. A refused body is drained (at most `limit` more bytes),
 * else the connection closes after the answer.
 */
export async function readBodyBytes(event: IAppEvent, limit: number, json: boolean): Promise<Uint8Array<ArrayBuffer>> {
    const { body } = event.request;

    if (!body) {
        return new Uint8Array(0);
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;

    for (;;) {
        const { done, value } = await reader.read();

        if (done) {
            break;
        }

        size += value.byteLength;

        if ((size > 0 && !json) || size > limit) {
            if (!await drain(reader, limit)) {
                closeAfterResponse(event);
            }

            throw json ? tooLarge(limit) : unsupported();
        }

        chunks.push(value);
    }

    return concatChunks(chunks, size);
}

function concatChunks(chunks: readonly Uint8Array[], size: number): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(size);
    let offset = 0;

    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }

    return bytes;
}

/**
 * Reads a channel request's body of at most `limit` bytes: a
 * `content-length` above it is refused unread, a body without one is read
 * until it passes the limit. A refusal is a RequestEntityTooLargeError (413);
 * the channel mount then closes the connection. Media-type checks stay with
 * the caller.
 */
export async function readRequestBody(request: Request, options: ReadRequestBodyOptions): Promise<Uint8Array<ArrayBuffer>> {
    const { limit } = options;
    const length = request.headers.get('content-length');

    if (length !== null && /^\d+$/.test(length) && Number(length) > limit) {
        throw tooLarge(limit);
    }

    if (!request.body) {
        return new Uint8Array(0);
    }

    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;

    try {
        for (;;) {
            const { done, value } = await reader.read();

            if (done) {
                break;
            }

            size += value.byteLength;

            if (size > limit) {
                throw tooLarge(limit);
            }

            chunks.push(value);
        }
    } catch (error) {
        await reader.cancel().catch(() => {});

        throw error;
    } finally {
        reader.releaseLock();
    }

    return concatChunks(chunks, size);
}

/**
 * 413 when `content-length` already exceeds `limit`; the body is left
 * unread, which the server discards itself.
 */
export function assertContentLength(event: IAppEvent, limit: number): void {
    const length = Number(event.request.headers.get('content-length'));

    if (Number.isFinite(length) && length > limit) {
        throw tooLarge(limit);
    }
}

/**
 * Reads a JSON body of at most `limit` bytes: `undefined` when empty, 413
 * when too large, 415 for another media type, 400 when unparsable. Call it
 * only after `authorize`.
 */
export async function readJsonBody(event: IAppEvent, limit: number): Promise<unknown> {
    const { request } = event;

    assertContentLength(event, limit);

    const bytes = await readBodyBytes(event, limit, isJsonMediaType(request.headers.get('content-type')));

    if (bytes.byteLength === 0) {
        return undefined;
    }

    try {
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        throw new BadRequestError({ message: 'The request body is not valid JSON.' });
    }
}

/**
 * Validates a JSON object body with a validup container. A missing body
 * reads as `{}` unless `required`; unknown keys are dropped.
 */
export async function validateBody<T extends Record<string, any>>(
    container: Container<T>,
    body: unknown,
    options: { required?: boolean } = {},
): Promise<T> {
    if (body === undefined) {
        if (options.required) {
            throw new BadRequestError({ message: 'The request needs a JSON body.' });
        }

        body = {};
    }

    if (!isObject(body)) {
        throw new BadRequestError({ message: 'The request body must be a JSON object.' });
    }

    return container.run(body as Partial<T>);
}

function describeIssues(issues: readonly Issue[]): string {
    return flattenIssueItems(issues).map((issue) => {
        const path = issue.path.map(String).join('.');

        return path ? `${path}: ${issue.message}` : issue.message;
    }).join('; ');
}

/** Validates a trigger payload (any JSON) with the trigger's Standard Schema. */
export async function validatePayload(schema: StandardSchemaV1 | undefined, payload: unknown): Promise<unknown> {
    if (!schema) {
        return payload;
    }

    const result = await schema['~standard'].validate(payload);

    if (result.issues) {
        const issues = buildIssuesForStandardSchemaIssues(result.issues);
        throw new BadRequestError({ message: `Invalid payload: ${describeIssues(issues)}`, issues });
    }

    return result.value;
}

const codec = createURLCodec();

// rapiq's Schema is invariant in its record type; the codec takes any of them
type AnySchema = Schema<any>;

function decodeWithCodec(searchParams: URLSearchParams, schema: AnySchema) {
    try {
        return codec.decode(searchParams.toString(), {
            schema,
            fields: false,
            relations: false,
        });
    } catch (error) {
        if (isParseError(error) || error instanceof CodecError) {
            const { issues } = error;
            const message = issues.length > 0 ? flattenIssueItems(issues).map((issue) => issue.message).join('; ') : error.message;
            throw new BadRequestError({ message, issues });
        }

        throw error;
    }
}

/**
 * Decodes a rapiq URL query (bracket or expression dialect) against
 * `schema` (built with `throwOnFailure: true` and without `maxLimit`):
 * 400 for a rejected query, a compound filter or a limit above 100.
 */
export function decodeQuery(searchParams: URLSearchParams, schema: AnySchema): DecodedQuery {
    const query = decodeWithCodec(searchParams, schema);

    // rapiq reads page values with parseInt ('1e2' -> 1, '50.5' -> 50); checked
    // after the codec, so its own rejections keep their issues
    for (const key of ['limit', 'offset']) {
        for (const value of searchParams.getAll(`page[${key}]`)) {
            if (!/^\d+$/.test(value.trim())) {
                throw new BadRequestError({ message: `page[${key}] takes a non-negative integer.` });
            }
        }
    }

    if (!query) {
        return { filters: [], sorts: [] };
    }

    const root = query.filters;
    const children = isFilters(root) && root.operator === 'and' ? root.value : [root];
    const filters = children.filter((child) => isFilter(child));

    if (filters.length !== children.length) {
        throw new BadRequestError({ message: 'Only top-level filters joined with "and" are supported.' });
    }

    const { limit, offset } = query.pagination;

    if (limit !== undefined && limit > MAX_PAGE_LIMIT) {
        throw new BadRequestError({ message: `The pagination limit must not exceed the value of ${MAX_PAGE_LIMIT}.` });
    }

    return {
        filters,
        ...(limit !== undefined ? { limit } : {}),
        ...(offset !== undefined ? { offset } : {}),
        sorts: query.sorts.value,
    };
}

/** An `Idempotency-Key` header: 1 to `KEY_MAX_LENGTH` characters, else 400. */
export function readIdempotencyHeader(request: Request): string | undefined {
    const value = request.headers.get('idempotency-key');

    if (value === null) {
        return undefined;
    }

    if (value.length < 1 || value.length > KEY_MAX_LENGTH) {
        throw new BadRequestError({ message: `The Idempotency-Key header must have 1 to ${KEY_MAX_LENGTH} characters.` });
    }

    return value;
}

/** A key a trigger derived from the payload: core's `assertTriggerKey` (400 `validation_error`). */
export function assertDerivedKey(name: string, value: string | undefined): void {
    assertTriggerKey(`${name} derived from the payload`, value);
}

/**
 * 400 for a NUL character (`%00`) in the path or the query: Postgres text
 * columns refuse it, so a lookup by such an id, key or filter would fail
 * as a 500 instead of a 404.
 */
export function assertNoNul(event: IAppEvent): void {
    let found = /%00/i.test(event.path);

    for (const [key, value] of event.searchParams) {
        if (key.includes('\0') || value.includes('\0')) {
            found = true;
        }
    }

    if (found) {
        throw new BadRequestError({ message: 'The request URL must not contain a NUL character.' });
    }
}
