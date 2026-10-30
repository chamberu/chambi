/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError, hasPermission } from '@chamvi/core';
import type { Invoker } from '@chamvi/core';
import { ForbiddenError, UnauthorizedError } from '@ebec/http';
import type { IAppEvent } from 'routup';
import type { HttpContext } from '../app/types.ts';
import { PRINCIPAL } from './constants.ts';
import type { Authenticator, Principal } from './types.ts';

/**
 * Claims read as the invoker's display name, first non-empty string wins.
 * Never `email`: the name reaches every reader of the run.
 */
const NAME_CLAIMS = ['name', 'preferred_username'] as const;

/**
 * The run invoker (or approver) for a principal: a snapshot of `id`,
 * `kind` and `permissions`, plus a display `name` from the claims (`name`,
 * then `preferred_username`; never `email`). Never carries the claims themselves.
 */
export function toInvoker(principal: Principal): Invoker {
    const name = NAME_CLAIMS
        .map((key) => principal.claims?.[key])
        .find((value): value is string => typeof value === 'string' && value.length > 0);

    return {
        id: principal.id,
        kind: principal.kind,
        ...(name !== undefined ? { name } : {}),
        permissions: [...principal.permissions],
    };
}

/**
 * The bearer token of a request: `undefined` without an authorization
 * header, 401 for another scheme or an empty value.
 */
export function readBearerToken(request: Request): string | undefined {
    const header = request.headers.get('authorization');

    if (header === null) {
        return undefined;
    }

    const match = /^bearer +(\S+) *$/i.exec(header);

    if (!match?.[1]) {
        throw new UnauthorizedError({ message: 'The authorization header is malformed.' });
    }

    return match[1];
}

/** True for a principal every route can rely on: a non-empty `id` and `kind`, `permissions` an array of strings. */
export function isPrincipal(value: Principal): boolean {
    return typeof value.id === 'string' &&
        value.id.length > 0 &&
        typeof value.kind === 'string' &&
        value.kind.length > 0 &&
        Array.isArray(value.permissions) &&
        value.permissions.every((permission) => typeof permission === 'string');
}

/**
 * Runs `authenticators` in order over `request`: the first principal wins;
 * a throw is remembered (and rethrown when no later one resolves), so the
 * chain goes on; none at all is a 401. A principal without a non-empty `id`
 * and `kind` and a `permissions` array of strings is a server
 * misconfiguration (InvalidAgentDefinitionError).
 */
export async function resolvePrincipal(request: Request, authenticators: readonly Authenticator[]): Promise<Principal> {
    let rejection: unknown;

    for (const authenticator of authenticators) {
        let principal: Principal | undefined;

        try {
            principal = await authenticator(request);
        } catch (error) {
            rejection ??= error;

            continue;
        }

        if (!principal) {
            continue;
        }

        // a server misconfiguration (500 and onError), never a client error nor a reason to try the next authenticator
        if (!isPrincipal(principal)) {
            throw new InvalidAgentDefinitionError('An authenticator resolved a principal without a non-empty id and kind and a permissions array of strings.');
        }

        return principal;
    }

    throw rejection ?? new UnauthorizedError({ message: 'Authentication required.' });
}

/** Runs the authenticator chain once per request; the first principal wins. */
export function authenticate(event: IAppEvent, ctx: HttpContext): Promise<Principal> {
    let pending = event.store[PRINCIPAL] as Promise<Principal> | undefined;

    if (!pending) {
        pending = resolvePrincipal(event.request, ctx.authenticators);
        event.store[PRINCIPAL] = pending;
    }

    return pending;
}

/** `authenticate`, then 403 when `permission` is given and not granted. */
export async function authorize(event: IAppEvent, ctx: HttpContext, permission?: string): Promise<Principal> {
    const principal = await authenticate(event, ctx);

    if (permission !== undefined && !hasPermission(principal.permissions, permission)) {
        throw new ForbiddenError({ message: `Missing permission "${permission}".` });
    }

    return principal;
}
