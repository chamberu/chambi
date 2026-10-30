/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { TRIGGER_KEY_MAX_LENGTH } from '@chamvi/core';
import { BadRequestError } from '@ebec/http';
import { isObject } from 'smob';
import type { GithubEvent, GithubPayload } from '../subscription/types.ts';
import { EVENT_HEADER_PATTERN, SIGNATURE_PATTERN } from './constants.ts';

/**
 * True when `signature` is `sha256=<hex>` of the HMAC-SHA256 of the exact
 * body bytes under any of `secrets`, compared in constant time.
 */
export function verifySignature(secrets: readonly string[], body: Uint8Array, signature: string | null): boolean {
    const match = SIGNATURE_PATTERN.exec(signature ?? '');

    if (!match?.[1]) {
        return false;
    }

    const expected = Buffer.from(match[1], 'hex');
    let valid = false;

    for (const secret of secrets) {
        const actual = createHmac('sha256', secret).update(body).digest();

        // every secret is checked, so the timing does not tell which one matched
        if (actual.length === expected.length && timingSafeEqual(actual, expected)) {
            valid = true;
        }
    }

    return valid;
}

/** `X-GitHub-Event` and `X-GitHub-Delivery`, else 400. */
export function readHeaders(request: Request): { name: string; delivery: string } {
    const name = request.headers.get('x-github-event');

    if (name === null || !EVENT_HEADER_PATTERN.test(name)) {
        throw new BadRequestError({ message: 'The X-GitHub-Event header is missing or malformed.' });
    }

    const delivery = request.headers.get('x-github-delivery');

    if (delivery === null || delivery.length === 0 || delivery.length > TRIGGER_KEY_MAX_LENGTH || delivery.includes('\0')) {
        throw new BadRequestError({ message: `The X-GitHub-Delivery header must have 1 to ${TRIGGER_KEY_MAX_LENGTH} characters.` });
    }

    return { name, delivery };
}

/** The verified body as a `GithubEvent`; 400 for invalid JSON or a non-object. */
export function toGithubEvent(body: Uint8Array, name: string, delivery: string): GithubEvent {
    let payload: unknown;

    try {
        payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    } catch {
        throw new BadRequestError({ message: 'The delivery body is not valid JSON.' });
    }

    if (!isObject(payload)) {
        throw new BadRequestError({ message: 'The delivery body must be a JSON object.' });
    }

    const event: GithubEvent = {
        name,
        delivery,
        payload: payload as GithubPayload,
    };

    if (typeof payload.action === 'string') {
        event.action = payload.action;
    }

    const { installation } = payload;

    if (isObject(installation) && typeof installation.id === 'number') {
        event.installationId = installation.id;
    }

    return event;
}

/** True for `application/json` and `application/<x>+json`, parameters ignored. */
export function isJsonMediaType(header: string | null): boolean {
    const type = (header ?? '').split(';')[0]!.trim().toLowerCase();

    return type === 'application/json' || /^application\/[\w.!#$&^-]+\+json$/.test(type);
}
