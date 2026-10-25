/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    CACHE_ENV,
    ROOT_CAPABILITIES,
    SANDBOX_ENV,
    repoKey,
} from '@chamvi/sandbox';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import { buildContainerOptions } from '../../../src/provider/helpers.ts';

function input(overrides: Partial<Parameters<typeof buildContainerOptions>[0]> = {}) {
    return {
        id: 'w1',
        deployment: 'default',
        info: {
            runId: 'r1',
            provider: 'docker',
            image: 'img',
            createdAt: new Date('2026-01-01T00:00:00Z'),
            expiresAt: new Date('2026-01-01T00:10:00Z'),
        },
        network: 'bridge',
        user: '0:0',
        readOnlyRoot: false,
        cacheVolume: 'chamvi-sandbox-cache' as string | undefined,
        tmpSize: '1Gi',
        env: { FOO: 'bar' },
        limits: {
            cpu: '500m',
            memory: '1Gi',
            storage: '4Gi',
            pids: 256,
            maxLifetimeMs: 600_000,
        },
        ...overrides,
    };
}

describe('buildContainerOptions', () => {
    afterEach(() => {
        delete process.env.CHAMVI_SECRET_PROBE;
    });

    it('builds a root container with a writable root, the package-manager capabilities and the shared cache', () => {
        const options = buildContainerOptions(input());

        expect(options.name).toBe('chamvi-ws-w1');
        expect(options.Image).toBe('img');
        // the lifetime follows the run: only the garbage collection removes it
        expect(options.Cmd).toEqual(['sleep', 'infinity']);
        expect(options.User).toBe('0:0');
        expect(options.WorkingDir).toBe('/workspace');
        expect(options.Env).toEqual([
            ...Object.entries(SANDBOX_ENV).map(([key, value]) => `${key}=${value}`),
            ...Object.entries(CACHE_ENV).map(([key, value]) => `${key}=${value}`),
            'FOO=bar',
        ]);
        expect(options.Labels).toEqual({
            'app.kubernetes.io/managed-by': 'chamvi',
            'app.kubernetes.io/component': 'sandbox',
            'chamvi.dev/run': 'r1',
            'chamvi.dev/workspace': 'w1',
            'chamvi.dev/deployment': 'default',
            'chamvi.dev/created-at': '1767225600000',
            'chamvi.dev/expires-at': '1767226200000',
            'chamvi.dev/image': 'img',
        });
        expect(options.HostConfig).toEqual({
            NetworkMode: 'bridge',
            ReadonlyRootfs: false,
            CapDrop: ['ALL'],
            CapAdd: [...ROOT_CAPABILITIES],
            SecurityOpt: ['no-new-privileges:true'],
            Privileged: false,
            PidsLimit: 256,
            Memory: 1_073_741_824,
            MemorySwap: 1_073_741_824,
            NanoCpus: 500_000_000,
            Tmpfs: { '/tmp': 'rw,exec,nosuid,nodev,size=1073741824' },
            Mounts: [{
                Type: 'volume',
                Source: '',
                Target: '/workspace',
            }, {
                Type: 'volume',
                Source: 'chamvi-sandbox-cache',
                Target: '/cache',
            }],
            AutoRemove: false,
        });
    });

    it('sets the sandbox environment', () => {
        const options = buildContainerOptions(input({ env: {} }));

        expect(options.Env).toContain('GIT_CONFIG_NOSYSTEM=1');
        expect(options.Env).toContain('GIT_TERMINAL_PROMPT=0');
    });

    it('does not copy the host environment', () => {
        process.env.CHAMVI_SECRET_PROBE = 's3cret';

        const options = buildContainerOptions(input());

        expect(JSON.stringify(options)).not.toContain('s3cret');
        expect(JSON.stringify(options)).not.toContain('CHAMVI_SECRET_PROBE');
    });

    it('lets the configured env replace a default without duplicating it', () => {
        const options = buildContainerOptions(input({ env: { CI: 'false' } }));

        expect(options.Env?.filter((entry) => entry.startsWith('CI='))).toEqual(['CI=false']);
    });

    it('labels the repository, its key and the ref', () => {
        const repo = 'https://github.com/octo/demo.git';
        const options = buildContainerOptions(input({
            deployment: 'prod',
            info: {
                ...input().info,
                repo,
                ref: 'main',
            },
        }));
        expect(options.Labels).toMatchObject({
            'chamvi.dev/deployment': 'prod',
            'chamvi.dev/repo': repo,
            'chamvi.dev/repo-key': repoKey(repo),
            'chamvi.dev/ref': 'main',
        });
    });

    it('passes network none through', () => {
        expect(buildContainerOptions(input({ network: 'none' })).HostConfig?.NetworkMode).toBe('none');
    });

    it('passes a user-created network through', () => {
        expect(buildContainerOptions(input({ network: 'chamvi-sandbox' })).HostConfig?.NetworkMode).toBe('chamvi-sandbox');
    });

    it('restores the hardened mode with a user and a read-only root', () => {
        const options = buildContainerOptions(input({ user: '1000:1000', readOnlyRoot: true }));
        expect(options.User).toBe('1000:1000');
        expect(options.HostConfig?.ReadonlyRootfs).toBe(true);
        expect(options.HostConfig?.CapDrop).toEqual(['ALL']);
        expect(options.HostConfig).not.toHaveProperty('CapAdd');
        expect(options.HostConfig?.SecurityOpt).toEqual(['no-new-privileges:true']);
    });

    it('adds the capabilities for a root user by name', () => {
        expect(buildContainerOptions(input({ user: 'root' })).HostConfig?.CapAdd).toEqual([...ROOT_CAPABILITIES]);
    });

    it('mounts a cache of its own without a shared volume', () => {
        const options = buildContainerOptions(input({ cacheVolume: undefined }));
        expect(options.HostConfig?.Mounts?.[1]).toEqual({
            Type: 'volume',
            Source: '',
            Target: '/cache',
        });
        // the variables still point into /cache, which exists either way
        expect(options.Env).toContain('MISE_DATA_DIR=/cache/mise');
    });

    it('sizes /tmp', () => {
        expect(buildContainerOptions(input({ tmpSize: '256Mi' })).HostConfig?.Tmpfs).toEqual({ '/tmp': 'rw,exec,nosuid,nodev,size=268435456' });
    });

    it('lets the configured env replace a cache variable', () => {
        const options = buildContainerOptions(input({ env: { PIP_CACHE_DIR: '/tmp/pip' } }));
        expect(options.Env?.filter((entry) => entry.startsWith('PIP_CACHE_DIR='))).toEqual(['PIP_CACHE_DIR=/tmp/pip']);
    });
});
