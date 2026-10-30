/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ITokenVerifier } from '@authup/server-adapter-kit';
import { InvalidAgentDefinitionError, defineAgent } from '@chamvi/core';
import { http } from '@chamvi/http';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    AUTHENTICATOR_ORDER,
    AppToken,
    configModule,
    engineModule,
    httpModule,
    staticTokensModule,
    storeModule,
} from '@chamvi/app';
import { authupModule, oidcModule } from '@chamvi/app/authup';
import { resolveAuthenticators } from '../../../src/modules/http/helpers.ts';
import {
    TOKEN,
    TOKENS,
} from '../../utils/app.ts';
import { createHarness } from '../../utils/harness.ts';
import type { Harness } from '../../utils/harness.ts';
import { createRecordingLogger } from '../../utils/logger.ts';
import { textModel } from '@chamvi/test-kit';
import { freePort } from '../../utils/port.ts';

const AUTHUP_ENV = {
    AUTHUP_URL: 'https://auth.example.com/api',
    AUTHUP_CLIENT_ID: 'chamvi',
    AUTHUP_CLIENT_SECRET: 'client-secret-value',
};

function fakeVerifier() {
    const verify = vi.fn<ITokenVerifier['verify']>(async (token) => {
        if (token === 'authup-token') {
            return {
                sub: 'user-1',
                scope: 'global',
                permissions: [{ name: 'run:read' }],
            } as Awaited<ReturnType<ITokenVerifier['verify']>>;
        }
        throw new Error('invalid_token');
    });
    return { verify };
}

const ISSUER = {
    id: 'ci',
    issuer: 'https://issuer.test',
    audience: 'chamvi',
};

let harnesses: Harness[] = [];

afterEach(async () => {
    await Promise.all(harnesses.map((h) => h.stop()));
    harnesses = [];
});

async function served(verifier: ITokenVerifier) {
    const port = await freePort();
    const harness = await createHarness({
        env: {
            CHAMVI_TOKENS: TOKENS,
            HOST: '127.0.0.1',
            PORT: String(port),
        },
        agents: [defineAgent({
            name: 'triage',
            model: textModel(),
            instructions: 'triage',
            channels: [http.on()],
        })],
        modules: [
            configModule({ logger: createRecordingLogger() }),
            // authup contributes first: only the authenticator order puts static tokens ahead
            authupModule({ verifier }),
            storeModule(),
            staticTokensModule(),
            engineModule(),
            httpModule({ metrics: false, rateLimit: false }),
        ],
    });
    harnesses.push(harness);
    return (token: string) => fetch(`http://127.0.0.1:${port}/me`, { headers: { authorization: `Bearer ${token}` } });
}

describe('authupModule', () => {
    it('is named chamvi:authup', () => {
        expect(authupModule({ verifier: fakeVerifier(), env: {} }).name).toBe('chamvi:authup');
    });

    it.each(Object.keys(AUTHUP_ENV))('requires %s without a verifier', (name) => {
        expect(() => authupModule({ env: { ...AUTHUP_ENV, [name]: '' } }))
            .toThrow(new InvalidAgentDefinitionError(`${name} is required.`));
    });

    it('builds a verifier from the three variables', () => {
        expect(() => authupModule({ env: AUTHUP_ENV })).not.toThrow();
        expect(() => authupModule({
            env: {},
            url: AUTHUP_ENV.AUTHUP_URL,
            clientId: 'c',
            clientSecret: 's',
        })).not.toThrow();
    });

    it('a given verifier is used', async () => {
        const verifier = fakeVerifier();
        const me = await served(verifier);

        const response = await me('authup-token');
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            id: 'user-1',
            kind: 'authup',
            permissions: ['run:read'],
        });
        expect(verifier.verify).toHaveBeenCalledTimes(1);
    });

    it('static tokens run before authup', async () => {
        const verifier = fakeVerifier();
        const me = await served(verifier);

        const response = await me(TOKEN);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ id: 'ops' });
        expect(verifier.verify).not.toHaveBeenCalled();
    });
});

describe('oidcModule', () => {
    it('is named chamvi:oidc', () => {
        expect(oidcModule({ issuers: [ISSUER], principal: () => undefined }).name).toBe('chamvi:oidc');
    });

    it('validates its options when called', () => {
        expect(() => oidcModule({ issuers: [], principal: () => undefined })).toThrow(InvalidAgentDefinitionError);
    });

    it('contributes after authup', async () => {
        const harness = await createHarness({
            env: {},
            modules: [
                configModule({ logger: createRecordingLogger() }),
                oidcModule({ issuers: [ISSUER], principal: () => undefined }),
                authupModule({ verifier: fakeVerifier() }),
            ],
        });
        harnesses.push(harness);

        const entries = harness.container.resolveAll(AppToken.AUTHENTICATORS);
        expect(entries.map((entry) => [entry.name, entry.order])).toEqual([
            ['oidc', AUTHENTICATOR_ORDER.OIDC],
            ['authup', AUTHENTICATOR_ORDER.AUTHUP],
        ]);
        const byName = new Map(entries.map((entry) => [entry.name, entry.authenticator]));
        expect(resolveAuthenticators(harness.container)).toEqual([byName.get('authup'), byName.get('oidc')]);
    });
});
