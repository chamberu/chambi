/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError, ValidationError } from '@chamvi/core';
import { DEFAULT_REGISTRIES, PACKAGE_VERSIONS_MAX, webTools } from '@chamvi/tool-web';
import { createRegistryFixture, rejection } from '../../utils/registry.ts';
import { json } from '../../utils/web.ts';

describe('package_info', () => {
    it.each([
        ['npm', '..'],
        ['npm', '@scope'],
        ['npm', 'a/../b'],
        ['npm', ''],
        ['pypi', '../x'],
        ['crates', '1abc'],
        ['packagist', 'monolog'],
        ['packagist', 'a/../b'],
        ['go', '/x'],
        ['go', 'github.com/a/../b'],
        ['go', 'stdlib/fmt'],
        ['rubygems', '..'],
    ])('refuses the %s name %j before any request', async (ecosystem, name) => {
        const { web, info } = createRegistryFixture();

        await expect(info({ ecosystem, name })).rejects.toThrow(ValidationError);
        expect(web.calls).toEqual([]);
    });

    it('refuses an unknown ecosystem and a bad version', async () => {
        const { info } = createRegistryFixture();

        await expect(info({ ecosystem: 'maven', name: 'x' })).rejects.toThrow(ValidationError);
        await expect(info({
            ecosystem: 'npm', 
            name: 'x', 
            version: '../1', 
        })).rejects.toThrow(ValidationError);
    });

    it('asks the registries the operator names, also on a private address', async () => {
        const { web, info } = createRegistryFixture({ registries: { npm: 'https://npm.internal/api/npm/' } });
        web.dns.set('npm.internal', [{ address: '10.1.0.4', family: 4 }]);
        web.routes.set('https://npm.internal/api/npm/left-pad', json({
            name: 'left-pad', 
            'dist-tags': { latest: '1.3.0' }, 
            time: {}, 
            versions: { '1.3.0': {} },
        }));

        const result = await info({ ecosystem: 'npm', name: 'left-pad' });
        expect(result.latest).toBe('1.3.0');
        expect(result.source).toBe('https://npm.internal/api/npm/left-pad');
    });

    it('caps the version list', async () => {
        const { web, info } = createRegistryFixture();
        const versions = Object.fromEntries(Array.from({ length: PACKAGE_VERSIONS_MAX + 5 }, (_, i) => [`1.0.${i}`, {}]));
        const time = Object.fromEntries(Object.keys(versions).map((v, i) => [v, new Date(i * 1000).toISOString()]));
        web.routes.set('https://registry.npmjs.org/many', json({
            name: 'many', 
            'dist-tags': { latest: '1.0.0' }, 
            time, 
            versions,
        }));

        const result = await info({ ecosystem: 'npm', name: 'many' });
        expect(result.versions).toHaveLength(PACKAGE_VERSIONS_MAX);
        expect(result.versions[0]!.version).toBe(`1.0.${PACKAGE_VERSIONS_MAX + 4}`);
        expect(result.totalVersions).toBe(PACKAGE_VERSIONS_MAX + 5);
    });

    it('fails clearly for an answer that is no JSON', async () => {
        const { web, info } = createRegistryFixture();
        web.routes.set('https://registry.npmjs.org/broken', () => new Response('<html>', { status: 200 }));

        const error = await rejection(info({ ecosystem: 'npm', name: 'broken' }));
        expect(error.code).toBe('web_request');
        expect(error.message).toMatch(/not JSON/);
    });

    it('exports the default registries', () => {
        expect(DEFAULT_REGISTRIES).toEqual({
            npm: 'https://registry.npmjs.org',
            pypi: 'https://pypi.org',
            crates: 'https://crates.io',
            packagist: 'https://repo.packagist.org',
            go: 'https://proxy.golang.org',
            rubygems: 'https://rubygems.org',
        });
    });

    it.each([
        ['registries that are no object', 'x'],
        ['an unknown ecosystem', { maven: 'https://repo1.maven.org' }],
        ['a registry that is no URL', { npm: 'registry' }],
        ['a registry that is no http URL', { npm: 'ftp://registry' }],
        ['a registry with a query', { npm: 'https://registry.example?x=1' }],
    ])('refuses %s', (_name, registries) => {
        expect(() => webTools({ registries } as never)).toThrow(InvalidAgentDefinitionError);
    });
});
