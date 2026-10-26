/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ControllableClock, createFakeGithub } from '@chamvi/test-kit';

function appJwt(privateKey: string, appId: string, now: Date): string {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const iat = Math.floor(now.getTime() / 1000) - 60;
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
        iat, 
        exp: iat + 540, 
        iss: appId, 
    })}`;
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    return `${unsigned}.${signer.sign(privateKey).toString('base64url')}`;
}

describe('createFakeGithub', () => {
    it('exchanges an installation token for an App JWT', async () => {
        const clock = new ControllableClock(new Date('2026-10-21T09:00:00Z'));
        const fake = createFakeGithub({ appId: '123', clock });
        const response = await fake.fetch('https://api.github.com/app/installations/42/access_tokens', {
            method: 'POST',
            headers: { authorization: `Bearer ${appJwt(fake.privateKey, '123', clock.now())}` },
        });
        expect(response.status).toBe(201);
        expect(await response.json()).toMatchObject({ token: 'ghs_1' });
        expect(fake.tokenInstallations).toEqual([42]);
    });

    it('refuses a JWT of another app', async () => {
        const clock = new ControllableClock(new Date('2026-10-21T09:00:00Z'));
        const fake = createFakeGithub({ appId: '123', clock });
        const response = await fake.fetch('https://api.github.com/app', { headers: { authorization: `Bearer ${appJwt(fake.privateKey, '999', clock.now())}` } });
        expect(response.status).toBe(401);
    });

    it('rejects a pending request when its signal aborts', async () => {
        const clock = new ControllableClock(new Date('2026-10-21T09:00:00Z'));
        const fake = createFakeGithub({ appId: '123', clock });
        const exchange = await fake.fetch('https://api.github.com/app/installations/42/access_tokens', {
            method: 'POST',
            headers: { authorization: `Bearer ${appJwt(fake.privateKey, '123', clock.now())}` },
        });
        const { token } = await exchange.json() as { token: string };
        fake.route('GET', '/hang', () => new Promise(() => {}));
        const controller = new AbortController();
        const pending = fake.fetch('https://api.github.com/hang', {
            headers: { authorization: `token ${token}` },
            signal: controller.signal,
        });
        const reason = new Error('stop');
        controller.abort(reason);
        await expect(pending).rejects.toBe(reason);
    });

    it('rejects a request whose signal is already aborted', async () => {
        const clock = new ControllableClock(new Date('2026-10-21T09:00:00Z'));
        const fake = createFakeGithub({ appId: '123', clock });
        const reason = new Error('gone');
        await expect(fake.fetch('https://api.github.com/rate_limit', { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    });

    it('finds the installation of a repository with an App JWT and answers users without credentials', async () => {
        const clock = new ControllableClock(new Date('2026-10-21T09:00:00Z'));
        const fake = createFakeGithub({ appId: '123', clock });
        fake.installations.set('octo/demo', 42);
        fake.users.set('chamvi-test[bot]', 7);
        const jwt = { authorization: `Bearer ${appJwt(fake.privateKey, '123', clock.now())}` };
        const found = await fake.fetch('https://api.github.com/repos/Octo/Demo/installation', { headers: jwt });
        expect(await found.json()).toEqual({ id: 42 });
        expect((await fake.fetch('https://api.github.com/repos/octo/other/installation', { headers: jwt })).status).toBe(404);
        expect((await fake.fetch('https://api.github.com/repos/octo/demo/installation')).status).toBe(401);
        const user = await fake.fetch('https://api.github.com/users/chamvi-test%5Bbot%5D');
        expect(await user.json()).toEqual({
            login: 'chamvi-test[bot]', 
            id: 7, 
            type: 'Bot', 
        });
    });
});
