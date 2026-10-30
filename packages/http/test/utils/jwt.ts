/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    SignJWT,
    exportJWK,
    generateKeyPair,
} from 'jose';
import type { CryptoKey, JWK, JWTPayload } from 'jose';

export async function createSigningKey(kid = 'k1'): Promise<{ privateKey: CryptoKey; jwk: JWK }> {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
    const jwk = await exportJWK(publicKey);

    return {
        privateKey,
        jwk: {
            ...jwk,
            kid,
            alg: 'RS256',
            use: 'sig',
        },
    };
}

export async function signToken(
    privateKey: CryptoKey,
    claims: JWTPayload,
    options: { expiresIn?: string | number; kid?: string } = {},
): Promise<string> {
    return new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? 'k1' })
        .setIssuedAt()
        .setExpirationTime(options.expiresIn ?? '5m')
        .sign(privateKey);
}
