/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { INSTALLATION_CACHE_TTL_MS } from '@chamvi/github';
import { createGithubFixture } from '../../utils/app.ts';

function setup() {
    const fixture = createGithubFixture();
    const lookups = (path = '/repos/acme/api/installation') => fixture.fake.requests
        .filter((r) => r.path.toLowerCase() === path).length;
    return { ...fixture, lookups };
}

describe('IGithubApp.repositoryInstallation', () => {
    it('answers the installation with its permissions, sharing the installationFor cache', async () => {
        const {
            fake, 
            gh, 
            lookups, 
        } = setup();
        fake.installations.set('acme/api', 9);
        fake.appInstallations.set(9, {
            id: 9,
            account: { login: 'acme', type: 'Organization' },
            repository_selection: 'selected',
            permissions: { contents: 'write', metadata: 'read' },
        });
        expect(await gh.repositoryInstallation({ owner: 'acme', repo: 'api' })).toEqual({
            id: 9,
            account: 'acme',
            accountType: 'Organization',
            repositorySelection: 'selected',
            permissions: { contents: 'write', metadata: 'read' },
        });
        expect(await gh.installationFor({ owner: 'Acme', repo: 'Api' })).toBe(9);
        expect(lookups()).toBe(1);
        expect(await gh.repositoryInstallation({ owner: 'acme', repo: 'other' })).toBeUndefined();
    });
});

describe('IGithubApp.installationFor', () => {
    it('looks up the installation of a repository once per TTL', async () => {
        const {
            fake, 
            gh, 
            clock, 
            lookups, 
        } = setup();
        fake.installations.set('acme/api', 9);
        expect(await gh.installationFor({ owner: 'Acme', repo: 'API' })).toBe(9);
        expect(await gh.installationFor({ owner: 'acme', repo: 'api' })).toBe(9);
        expect(lookups()).toBe(1);
        clock.advance(INSTALLATION_CACHE_TTL_MS);
        await gh.installationFor({ owner: 'acme', repo: 'api' });
        expect(lookups()).toBe(2);
    });

    it('shares one lookup between concurrent callers', async () => {
        const {
            fake, 
            gh, 
            lookups, 
        } = setup();
        fake.installations.set('acme/api', 9);
        const ids = await Promise.all([
            gh.installationFor({ owner: 'acme', repo: 'api' }),
            gh.installationFor({ owner: 'Acme', repo: 'Api' }),
        ]);
        expect(ids).toEqual([9, 9]);
        expect(lookups()).toBe(1);
    });

    it('answers undefined for an uninstalled repository and does not cache it', async () => {
        const {
            fake, 
            gh, 
            lookups, 
        } = setup();
        expect(await gh.installationFor({ owner: 'acme', repo: 'api' })).toBeUndefined();
        fake.installations.set('acme/api', 9);
        expect(await gh.installationFor({ owner: 'acme', repo: 'api' })).toBe(9);
        expect(lookups()).toBe(2);
    });

    it('rejects with github_request on a failed lookup and retries next time', async () => {
        const {
            fake, 
            gh, 
            lookups, 
        } = setup();
        fake.installations.set('acme/api', 9);
        fake.failNext('GET', '/repos/acme/api/installation', 500);
        await expect(gh.installationFor({ owner: 'acme', repo: 'api' })).rejects.toMatchObject({ code: 'github_request' });
        expect(await gh.installationFor({ owner: 'acme', repo: 'api' })).toBe(9);
        expect(lookups()).toBe(2);
    });

    it('shares its cache with repositoryToken', async () => {
        const {
            fake, 
            gh, 
            lookups, 
        } = setup();
        fake.installations.set('acme/api', 9);
        await gh.installationFor({ owner: 'acme', repo: 'api' });
        await gh.repositoryToken({ owner: 'acme', repo: 'api' }, { permissions: { contents: 'read' } });
        expect(lookups()).toBe(1);
    });
});

describe('IGithubApp.installations', () => {
    it('lists every installation', async () => {
        const { fake, gh } = setup();
        fake.appInstallations.set(42, {
            id: 42, 
            account: { login: 'tada5hi', type: 'User' }, 
            repository_selection: 'all', 
            permissions: { contents: 'write' }, 
        });
        fake.appInstallations.set(43, {
            id: 43, 
            account: { login: 'chamvi', type: 'Organization' }, 
            repository_selection: 'selected', 
            permissions: { issues: 'read' }, 
        });
        expect(await gh.installations()).toEqual([
            {
                id: 42, 
                account: 'tada5hi', 
                accountType: 'User', 
                repositorySelection: 'all', 
                permissions: { contents: 'write' }, 
            },
            {
                id: 43, 
                account: 'chamvi', 
                accountType: 'Organization', 
                repositorySelection: 'selected', 
                permissions: { issues: 'read' }, 
            },
        ]);
    });

    it('pages through installations', async () => {
        const { fake, gh } = setup();
        for (let id = 1; id <= 101; id++) fake.appInstallations.set(id, { id, account: { login: `o${id}`, type: 'User' } });
        const list = await gh.installations();
        expect(list).toHaveLength(101);
        expect(list[0]).toEqual({
            id: 1, 
            account: 'o1', 
            accountType: 'User', 
            repositorySelection: 'selected', 
            permissions: {}, 
        });
    });

    it('rejects with github_request on a failure', async () => {
        const { fake, gh } = setup();
        fake.failNext('GET', '/app/installations', 500);
        await expect(gh.installations()).rejects.toMatchObject({ code: 'github_request' });
    });
});
