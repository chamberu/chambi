/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createPrivateKey, createSign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { JWT_BACKDATE_SECONDS, JWT_TTL_SECONDS } from './constants.ts';

/** The App's private key (PKCS#1 or PKCS#8 PEM); literal "\n" sequences become newlines. */
export function normalizePrivateKey(pem: string): KeyObject {
    try {
        const key = createPrivateKey(pem.replaceAll('\\n', '\n'));

        if (key.asymmetricKeyType !== 'rsa') {
            throw new TypeError('not an RSA key');
        }

        return key;
    } catch {
        // never echo the key
        throw new InvalidAgentDefinitionError('privateKey must be the GitHub App\'s RSA private key in PEM form.');
    }
}

function base64Url(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** An RS256 App JWT: `iat` backdated by JWT_BACKDATE_SECONDS, `exp` JWT_TTL_SECONDS ahead. */
export function createAppJwt(appId: string, key: KeyObject, now: Date): string {
    const seconds = Math.floor(now.getTime() / 1000);
    const unsigned = `${base64Url({ alg: 'RS256', typ: 'JWT' })}.${base64Url({
        iat: seconds - JWT_BACKDATE_SECONDS,
        exp: seconds + JWT_TTL_SECONDS,
        iss: appId,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(key).toString('base64url');

    return `${unsigned}.${signature}`;
}
