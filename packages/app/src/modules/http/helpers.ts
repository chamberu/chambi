/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import type { Authenticator } from '@chamvi/http';
import type { IContainer } from 'eldin';
import { isObject } from 'smob';
import { AppToken } from '../../module/constants.ts';

/** `httpModule({ untrusted })`: absent, or an object whose `http` and `mcp` are booleans when given. */
export function assertUntrustedOptions(value: unknown): void {
    if (value === undefined) {
        return;
    }

    const valid = isObject(value) && Object.entries(value).every(([key, flag]) =>
        (key === 'http' || key === 'mcp') && (flag === undefined || typeof flag === 'boolean'));

    if (!valid) {
        throw new InvalidAgentDefinitionError('httpModule({ untrusted }) must be an object with optional boolean http and mcp.');
    }
}

/** Every `AUTHENTICATORS` contribution, lowest `order` first (stable); none is an error. */
export function resolveAuthenticators(container: IContainer): Authenticator[] {
    const entries = container.resolveAll(AppToken.AUTHENTICATORS)
        .map((entry, index) => ({ entry, index }))
        .sort((a, b) => a.entry.order - b.entry.order || a.index - b.index);

    if (entries.length === 0) {
        throw new InvalidAgentDefinitionError('No authenticator: set CHAMVI_TOKENS, or add staticTokensModule(), authupModule() or oidcModule().');
    }

    return entries.map(({ entry }) => entry.authenticator);
}

/**
 * An authenticator running the app's chain once it is resolved (the http
 * module's `onReady`), with the chain's rules: the first principal wins, an
 * authenticator answering `undefined` lets the next one try, the first
 * rejection is rethrown when none resolved a principal. Before `chain` is
 * set it answers `undefined` (a 401). The webhook channel is built in
 * `setup`, before the authenticators are known.
 */
export function createDeferredAuthenticator(): { authenticator: Authenticator; resolve(chain: readonly Authenticator[]): void } {
    let authenticators: readonly Authenticator[] = [];

    return {
        authenticator: async (request) => {
            let rejection: { error: unknown } | undefined;

            for (const authenticator of authenticators) {
                try {
                    const principal = await authenticator(request);

                    if (principal) {
                        return principal;
                    }
                } catch (error) {
                    rejection ??= { error };
                }
            }

            if (rejection) {
                throw rejection.error;
            }

            return undefined;
        },
        resolve(chain) {
            authenticators = [...chain];
        },
    };
}
