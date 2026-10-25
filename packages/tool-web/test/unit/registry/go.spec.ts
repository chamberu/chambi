/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { createRegistryFixture, rejection } from '../../utils/registry.ts';
import { json, text } from '../../utils/web.ts';

const GO_MOD = `// Deprecated: use github.com/Example/Mod/v2 instead.
module github.com/Example/Mod

go 1.21

toolchain go1.22.1

require golang.org/x/net v0.20.0

require (
	github.com/pkg/errors v0.9.1
	golang.org/x/sys v0.16.0 // indirect
)

retract v1.0.1
`;

describe('package_info for the Go module proxy', () => {
    const base = 'https://proxy.golang.org/github.com/!example/!mod';

    it('lists versions by semver and reads the latest go.mod', async () => {
        const { web, info } = createRegistryFixture();
        web.routes.set(`${base}/@v/list`, text('v1.0.0\nv1.10.0\nv1.2.0\nv1.10.0-rc.1\n'));
        web.routes.set(`${base}/@latest`, json({ Version: 'v1.10.0', Time: '2024-02-01T00:00:00Z' }));
        web.routes.set(`${base}/@v/v1.10.0.info`, json({ Version: 'v1.10.0', Time: '2024-02-01T00:00:00Z' }));
        web.routes.set(`${base}/@v/v1.10.0.mod`, text(GO_MOD));

        expect(await info({ ecosystem: 'go', name: 'github.com/Example/Mod' })).toEqual({
            ecosystem: 'go',
            name: 'github.com/Example/Mod',
            description: null,
            latest: 'v1.10.0',
            tags: {},
            versions: [
                { version: 'v1.10.0', publishedAt: '2024-02-01T00:00:00Z' },
                { version: 'v1.10.0-rc.1', publishedAt: null },
                { version: 'v1.2.0', publishedAt: null },
                { version: 'v1.0.0', publishedAt: null },
            ],
            totalVersions: 4,
            version: {
                version: 'v1.10.0',
                publishedAt: '2024-02-01T00:00:00Z',
                dependencies: [
                    {
                        name: 'golang.org/x/net', 
                        requirement: 'v0.20.0', 
                        kind: 'runtime', 
                    },
                    {
                        name: 'github.com/pkg/errors', 
                        requirement: 'v0.9.1', 
                        kind: 'runtime', 
                    },
                    {
                        name: 'golang.org/x/sys', 
                        requirement: 'v0.16.0 (indirect)', 
                        kind: 'runtime', 
                    },
                ],
                engines: { go: '1.21', toolchain: 'go1.22.1' },
                deprecated: 'use github.com/Example/Mod/v2 instead.',
                license: null,
            },
            homepage: 'https://pkg.go.dev/github.com/Example/Mod',
            repository: 'https://github.com/Example/Mod',
            changelog: null,
            source: `${base}/@v/list`,
        });
    });

    it('names a module the proxy does not know', async () => {
        const { web, info } = createRegistryFixture();
        web.routes.set(`${base}/@v/list`, text('not found: gone', 410));

        const error = await rejection(info({ ecosystem: 'go', name: 'github.com/Example/Mod' }));
        expect(error.message).toBe('go has no package github.com/Example/Mod.');
    });
});
