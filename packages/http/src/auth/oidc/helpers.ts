/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ServiceUnavailableError, UnauthorizedError } from '@ebec/http';
import { VouchlyErrorCode, isVouchlyError } from 'vouchly';
import type { VouchlyError } from 'vouchly';
import { isObject } from 'smob';

/** jose codes of a `kid` the issuer does not publish: the client's fault. */
const CLIENT_KEY_CODES = new Set(['ERR_JWKS_NO_MATCHING_KEY', 'ERR_JWKS_MULTIPLE_MATCHING_KEYS']);

function isClientKeyError(error: VouchlyError): boolean {
    const { cause } = error;

    return isObject(cause) && typeof cause.code === 'string' && CLIENT_KEY_CODES.has(cause.code);
}

function unreachable(cause: unknown): ServiceUnavailableError {
    return new ServiceUnavailableError({ message: 'The token issuer is unreachable.', cause });
}

/**
 * Maps a verification failure: `undefined` for a token another
 * authenticator may accept, 503 for an issuer outage, 401 otherwise.
 * Non-vouchly errors are rethrown.
 */
export function mapVerifyError(error: unknown): undefined {
    if (!isVouchlyError(error)) {
        throw error;
    }

    switch (error.code) {
        case VouchlyErrorCode.TOKEN_MALFORMED:
        case VouchlyErrorCode.ISSUER_UNTRUSTED:
            return undefined;
        case VouchlyErrorCode.INTROSPECTION_FAILED:
            throw unreachable(error);
        case VouchlyErrorCode.KEY_UNAVAILABLE:
            if (!isClientKeyError(error)) {
                throw unreachable(error);
            }

            break;
        default:
            break;
    }

    throw new UnauthorizedError({
        message: 'The access token is invalid.',
        code: error.code,
        cause: error,
    });
}
