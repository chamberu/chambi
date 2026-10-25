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

    it('lists releases newest first, a page at a time', async () => {
        const clock = new ControllableClock(new Date('2026-10-21T09:00:00Z'));
        const fake = createFakeGithub({ appId: '123', clock });
        const exchange = await fake.fetch('https://api.github.com/app/installations/42/access_tokens', {
            method: 'POST',
            headers: { authorization: `Bearer ${appJwt(fake.privateKey, '123', clock.now())}` },
        });
        const { token } = await exchange.json() as { token: string };
        fake.releases.set('octo/demo', [{ tag_name: 'v1' }, { tag_name: 'v2' }, { tag_name: 'v3' }]);

        const response = await fake.fetch('https://api.github.com/repos/octo/demo/releases?per_page=2', { headers: { authorization: `token ${token}` } });
        expect(await response.json()).toEqual([{ tag_name: 'v3' }, { tag_name: 'v2' }]);
        expect(response.headers.get('link')).toContain('page=2');
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
});
