/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { createRegistryFixture } from '../../utils/registry.ts';
import { json } from '../../utils/web.ts';

const CRATE = {
    crate: {
        name: 'serde',
        description: 'A serialization framework',
        homepage: 'https://serde.rs',
        repository: 'https://github.com/serde-rs/serde',
        max_stable_version: '1.0.200',
        max_version: '1.0.200',
    },
    versions: [
        {
            num: '1.0.199', 
            created_at: '2024-04-01T00:00:00Z', 
            yanked: true, 
            license: 'MIT OR Apache-2.0', 
            rust_version: null,
        },
        {
            num: '1.0.200', 
            created_at: '2024-05-01T00:00:00Z', 
            yanked: false, 
            license: 'MIT OR Apache-2.0', 
            rust_version: '1.31',
        },
    ],
};

describe('package_info for crates.io', () => {
    it('reads versions and the dependencies of the latest', async () => {
        const { web, info } = createRegistryFixture();
        web.routes.set('https://crates.io/api/v1/crates/serde', json(CRATE));
        web.routes.set('https://crates.io/api/v1/crates/serde/1.0.200/dependencies', json({
            dependencies: [
                {
                    crate_id: 'serde_derive', 
                    req: '=1.0.200', 
                    kind: 'normal', 
                    optional: true,
                },
                {
                    crate_id: 'serde_core', 
                    req: '^1', 
                    kind: 'normal', 
                    optional: false,
                },
                {
                    crate_id: 'cc', 
                    req: '^1', 
                    kind: 'build', 
                    optional: false,
                },
                {
                    crate_id: 'serde_json', 
                    req: '^1', 
                    kind: 'dev', 
                    optional: false,
                },
            ],
        }));

        const result = await info({ ecosystem: 'crates', name: 'serde' });

        expect(result).toMatchObject({
            latest: '1.0.200',
            description: 'A serialization framework',
            homepage: 'https://serde.rs',
            repository: 'https://github.com/serde-rs/serde',
            versions: [
                { version: '1.0.200', publishedAt: '2024-05-01T00:00:00Z' },
                {
                    version: '1.0.199', 
                    publishedAt: '2024-04-01T00:00:00Z', 
                    yanked: true, 
                },
            ],
            version: {
                version: '1.0.200',
                dependencies: [
                    {
                        name: 'serde_derive', 
                        requirement: '=1.0.200', 
                        kind: 'optional', 
                    },
                    {
                        name: 'serde_core', 
                        requirement: '^1', 
                        kind: 'runtime', 
                    },
                    {
                        name: 'cc', 
                        requirement: '^1', 
                        kind: 'build', 
                    },
                ],
                engines: { rust: '1.31' },
                license: 'MIT OR Apache-2.0',
            },
        });
        expect(web.calls[0]!.headers['user-agent']).toMatch(/chamvi/);
    });

    it('lists the versions separately when the crate document has none', async () => {
        const { web, info } = createRegistryFixture();
        web.routes.set('https://crates.io/api/v1/crates/serde', json({ crate: CRATE.crate }));
        web.routes.set('https://crates.io/api/v1/crates/serde/versions', json({ versions: CRATE.versions }));
        web.routes.set('https://crates.io/api/v1/crates/serde/1.0.199/dependencies', json({ dependencies: [] }));

        const result = await info({
            ecosystem: 'crates', 
            name: 'serde', 
            version: '1.0.199', 
        });
        expect(result.version).toMatchObject({
            version: '1.0.199', 
            yanked: true, 
            engines: {}, 
        });
    });
});
