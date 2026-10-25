/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { createRegistryFixture } from '../../utils/registry.ts';
import { json } from '../../utils/web.ts';

const GEM = {
    name: 'rails',
    version: '7.1.3',
    info: 'Full-stack web application framework.',
    licenses: ['MIT'],
    homepage_uri: 'https://rubyonrails.org',
    source_code_uri: 'https://github.com/rails/rails/tree/v7.1.3',
    changelog_uri: 'https://github.com/rails/rails/releases/tag/v7.1.3',
    dependencies: {
        runtime: [{ name: 'activesupport', requirements: '= 7.1.3' }],
        development: [{ name: 'rake', requirements: '>= 0' }],
    },
};

const VERSIONS = [
    {
        number: '7.1.3', 
        created_at: '2024-01-16T00:00:00.000Z', 
        platform: 'ruby', 
        ruby_version: '>= 2.7.0',
    },
    {
        number: '7.1.3', 
        created_at: '2024-01-16T00:00:00.000Z', 
        platform: 'java', 
        ruby_version: '>= 2.7.0',
    },
    {
        number: '7.0.0', 
        created_at: '2021-12-15T00:00:00.000Z', 
        platform: 'ruby', 
        ruby_version: '>= 2.7.0',
    },
];

describe('package_info for RubyGems', () => {
    it('reads the gem, its versions once per number and the latest dependencies', async () => {
        const { web, info } = createRegistryFixture();
        web.routes.set('https://rubygems.org/api/v1/gems/rails.json', json(GEM));
        web.routes.set('https://rubygems.org/api/v1/versions/rails.json', json(VERSIONS));

        expect(await info({ ecosystem: 'rubygems', name: 'rails' })).toMatchObject({
            latest: '7.1.3',
            description: 'Full-stack web application framework.',
            versions: [
                { version: '7.1.3', publishedAt: '2024-01-16T00:00:00.000Z' },
                { version: '7.0.0', publishedAt: '2021-12-15T00:00:00.000Z' },
            ],
            totalVersions: 2,
            version: {
                version: '7.1.3',
                dependencies: [{
                    name: 'activesupport', 
                    requirement: '= 7.1.3', 
                    kind: 'runtime', 
                }],
                engines: { ruby: '>= 2.7.0' },
                license: 'MIT',
            },
            homepage: 'https://rubyonrails.org',
            repository: 'https://github.com/rails/rails/tree/v7.1.3',
            changelog: 'https://github.com/rails/rails/releases/tag/v7.1.3',
        });
    });

    it('reads an older version from its own document', async () => {
        const { web, info } = createRegistryFixture();
        web.routes.set('https://rubygems.org/api/v1/gems/rails.json', json(GEM));
        web.routes.set('https://rubygems.org/api/v1/versions/rails.json', json(VERSIONS));
        web.routes.set('https://rubygems.org/api/v2/rubygems/rails/versions/7.0.0.json', json({
            ...GEM,
            version: '7.0.0',
            dependencies: { runtime: [{ name: 'activesupport', requirements: '= 7.0.0' }], development: [] },
        }));

        const result = await info({
            ecosystem: 'rubygems', 
            name: 'rails', 
            version: '7.0.0', 
        });
        expect(result.version).toMatchObject({
            version: '7.0.0',
            publishedAt: '2021-12-15T00:00:00.000Z',
            dependencies: [{
                name: 'activesupport', 
                requirement: '= 7.0.0', 
                kind: 'runtime', 
            }],
        });
    });
});
