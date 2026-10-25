/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { createRegistryFixture, rejection } from '../../utils/registry.ts';
import { json } from '../../utils/web.ts';

const PACKUMENT = {
    name: '@scope/lib',
    description: 'A library',
    'dist-tags': { latest: '2.0.0', next: '3.0.0-beta.1' },
    time: {
        created: '2020-01-01T00:00:00.000Z',
        modified: '2026-01-01T00:00:00.000Z',
        '1.0.0': '2024-01-01T00:00:00.000Z',
        '2.0.0': '2025-06-01T00:00:00.000Z',
        '3.0.0-beta.1': '2025-09-01T00:00:00.000Z',
    },
    repository: { type: 'git', url: 'git+https://github.com/scope/lib.git' },
    homepage: 'https://lib.dev',
    versions: {
        '1.0.0': {
            version: '1.0.0',
            dependencies: { tslib: '^2.0.0' },
            deprecated: 'Use 2.x',
            license: 'MIT',
        },
        '2.0.0': {
            version: '2.0.0',
            dependencies: { tslib: '^2.6.0', fsevents: '^2.3.0' },
            optionalDependencies: { fsevents: '^2.3.0' },
            peerDependencies: { react: '>=18' },
            engines: { node: '>=20' },
            license: 'MIT',
            repository: 'github:scope/lib',
        },
        '3.0.0-beta.1': { version: '3.0.0-beta.1', engines: ['node >= 0.4'] },
    },
};

describe('package_info for npm', () => {
    it('reads tags, versions and the latest version', async () => {
        const { web, info } = createRegistryFixture();
        web.routes.set('https://registry.npmjs.org/@scope%2Flib', json(PACKUMENT));

        expect(await info({ ecosystem: 'npm', name: '@scope/lib' })).toEqual({
            ecosystem: 'npm',
            name: '@scope/lib',
            description: 'A library',
            latest: '2.0.0',
            tags: { latest: '2.0.0', next: '3.0.0-beta.1' },
            versions: [
                { version: '3.0.0-beta.1', publishedAt: '2025-09-01T00:00:00.000Z' },
                { version: '2.0.0', publishedAt: '2025-06-01T00:00:00.000Z' },
                {
                    version: '1.0.0', 
                    publishedAt: '2024-01-01T00:00:00.000Z', 
                    deprecated: true, 
                },
            ],
            totalVersions: 3,
            version: {
                version: '2.0.0',
                publishedAt: '2025-06-01T00:00:00.000Z',
                dependencies: [
                    {
                        name: 'tslib', 
                        requirement: '^2.6.0', 
                        kind: 'runtime', 
                    },
                    {
                        name: 'react', 
                        requirement: '>=18', 
                        kind: 'peer', 
                    },
                    {
                        name: 'fsevents', 
                        requirement: '^2.3.0', 
                        kind: 'optional', 
                    },
                ],
                engines: { node: '>=20' },
                deprecated: null,
                license: 'MIT',
            },
            homepage: 'https://lib.dev',
            repository: 'https://github.com/scope/lib',
            changelog: null,
            source: 'https://registry.npmjs.org/@scope%2Flib',
        });
        expect(web.calls[0]!.headers.accept).toBe('application/json');
    });

    it('reads a version by number or dist-tag', async () => {
        const { web, info } = createRegistryFixture();
        web.routes.set('https://registry.npmjs.org/@scope%2Flib', json(PACKUMENT));

        const old = await info({
            ecosystem: 'npm', 
            name: '@scope/lib', 
            version: '1.0.0', 
        });
        expect(old.version).toMatchObject({
            version: '1.0.0', 
            deprecated: 'Use 2.x', 
            engines: {}, 
        });
        expect(old.repository).toBe('https://github.com/scope/lib');

        const next = await info({
            ecosystem: 'npm', 
            name: '@scope/lib', 
            version: 'next', 
        });
        expect(next.version?.version).toBe('3.0.0-beta.1');
        expect(next.version?.engines).toEqual({});
    });

    it('names a missing package or version', async () => {
        const { web, info } = createRegistryFixture();
        web.routes.set('https://registry.npmjs.org/@scope%2Flib', json(PACKUMENT));

        const missing = await rejection(info({ ecosystem: 'npm', name: 'nope' }));
        expect(missing.code).toBe('web_request');
        expect(missing.message).toBe('npm has no package nope.');

        const version = await rejection(info({
            ecosystem: 'npm', 
            name: '@scope/lib', 
            version: '9.9.9', 
        }));
        expect(version.message).toBe('npm has no version 9.9.9 of @scope/lib.');
    });
});
