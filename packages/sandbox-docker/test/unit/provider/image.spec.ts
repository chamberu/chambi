/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto';
import Docker from 'dockerode';
import {
    afterAll,
    beforeAll,
    expect,
    it,
} from 'vitest';
import { buildContainerOptions } from '../../../src/provider/helpers.ts';
import { describeDocker, dockerImage, execInContainer } from '../../utils/docker.ts';

const offline = Boolean(process.env.CHAMVI_OFFLINE);

/** CapEff of CHOWN, DAC_OVERRIDE, FOWNER, FSETID, KILL, SETGID and SETUID (bits 0, 1, 3, 4, 5, 6, 7). */
const ROOT_CAP_MASK = '00000000000000fb';

async function startContainer(docker: Docker, overrides: Partial<Parameters<typeof buildContainerOptions>[0]> = {}): Promise<Docker.Container> {
    const container = await docker.createContainer(buildContainerOptions({
        id: randomUUID(),
        deployment: 'default',
        info: {
            runId: `test-${randomUUID()}`,
            provider: 'docker',
            image: dockerImage as string,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 600_000),
        },
        network: 'none',
        user: '0:0',
        readOnlyRoot: false,
        // an anonymous cache: the image spec never touches a shared volume
        cacheVolume: undefined,
        tmpSize: '1Gi',
        env: {},
        limits: {
            cpu: '1',
            memory: '512Mi',
            storage: '1Gi',
            pids: 256,
            maxLifetimeMs: 600_000,
        },
        ...overrides,
    }));
    await container.start();
    return container;
}

describeDocker('sandbox-dev image as root (the default)', () => {
    const docker = new Docker();
    let container: Docker.Container;

    const run = (argv: string[]) => execInContainer(docker, container, argv);

    beforeAll(async () => {
        container = await startContainer(docker);
    });

    afterAll(async () => {
        await container?.remove({ force: true, v: true });
    });

    it('runs as root', async () => {
        expect((await run(['id', '-u'])).stdout.trim()).toBe('0');
    });

    it.each([
        ['git', ['git', '--version']],
        ['GNU timeout with -k', ['timeout', '-k', '1', '5', 'true']],
        ['curl', ['curl', '--version']],
        ['ripgrep', ['rg', '--version']],
        ['jq', ['jq', '--version']],
        ['a C compiler and make', ['sh', '-c', 'cc --version && make --version']],
        ['unzip', ['unzip', '-v']],
        ['mise', ['mise', '--version']],
    ])('ships %s', async (_name, argv) => {
        const result = await run(argv);
        expect(result.stderr).not.toMatch(/not found/);
        expect(result.exitCode).toBe(0);
    });

    it('ships no language toolchain', async () => {
        expect((await run(['sh', '-c', 'command -v node || command -v python3 || command -v go'])).exitCode).not.toBe(0);
    });

    it('keeps mise\'s shims out of the shared cache, behind the system tools on the PATH', async () => {
        const result = await run(['sh', '-c', 'echo "$PATH" && echo "$MISE_SHIMS_DIR" && echo "$MISE_DATA_DIR"']);
        const [path, shims, data] = result.stdout.split('\n');
        expect(path!.split(':').some((entry) => entry === '/cache' || entry.startsWith('/cache/'))).toBe(false);
        expect(path).toMatch(/:\/usr\/bin:.*:\/tmp\/mise\/shims$/);
        expect(shims).toBe('/tmp/mise/shims');
        expect(data).toBe('/cache/mise');
    });

    it('has a writable root filesystem', async () => {
        const result = await run(['sh', '-c', 'touch /etc/probe && mkdir -p /opt/tool && touch /usr/local/bin/probe']);
        expect(result.stderr).toBe('');
        expect(result.exitCode).toBe(0);
    });

    it('writes to /workspace, /cache and /tmp', async () => {
        const result = await run(['sh', '-c', 'touch /workspace/probe && mkdir -p /cache/npm && touch /tmp/probe']);
        expect(result.stderr).toBe('');
        expect(result.exitCode).toBe(0);
    });

    it('sizes /tmp and runs programs from it', async () => {
        const mount = await run(['sh', '-c', 'grep " /tmp " /proc/self/mounts']);
        expect(mount.stdout).toMatch(/size=1048576k/);
        expect(mount.stdout).not.toMatch(/noexec/);
        const script = await run(['sh', '-c', 'printf "#!/bin/sh\\necho ran\\n" > /tmp/probe.sh && chmod +x /tmp/probe.sh && /tmp/probe.sh']);
        expect(script).toMatchObject({ exitCode: 0, stdout: 'ran\n' });
    });

    it('holds only the package-manager capabilities', async () => {
        const result = await run(['grep', 'CapEff', '/proc/self/status']);
        expect(result.stdout).toMatch(new RegExp(`CapEff:\\s+${ROOT_CAP_MASK}`));
    });

    it('keeps no-new-privileges', async () => {
        expect((await run(['grep', 'NoNewPrivs', '/proc/self/status'])).stdout).toMatch(/NoNewPrivs:\s+1/);
    });

    it('runs tini as pid 1', async () => {
        expect((await run(['cat', '/proc/1/comm'])).stdout.trim()).toBe('tini');
    });

    it('is no privileged container and mounts nothing of the host', async () => {
        const info = await container.inspect();
        expect(info.HostConfig.Privileged).toBe(false);
        expect(info.HostConfig.Binds ?? []).toEqual([]);
        expect(info.Mounts.every((mount) => mount.Type === 'volume' || mount.Type === 'tmpfs')).toBe(true);
        expect(info.HostConfig.PidsLimit).toBe(256);
    });
});

describeDocker('sandbox-dev image in the hardened mode', () => {
    const docker = new Docker();
    let container: Docker.Container;

    const run = (argv: string[]) => execInContainer(docker, container, argv);

    beforeAll(async () => {
        container = await startContainer(docker, { user: '1000:1000', readOnlyRoot: true });
    });

    afterAll(async () => {
        await container?.remove({ force: true, v: true });
    });

    it('runs as uid 1000 without a capability on a read-only root', async () => {
        expect((await run(['id', '-u'])).stdout.trim()).toBe('1000');
        expect((await run(['grep', 'CapEff', '/proc/self/status'])).stdout).toMatch(/CapEff:\s+0000000000000000/);
        expect((await run(['touch', '/etc/probe'])).exitCode).not.toBe(0);
    });

    it('writes mise\'s shims to /tmp on the read-only root', async () => {
        const result = await run(['sh', '-c', 'mise reshim && test -d /tmp/mise/shims']);
        expect(result.stderr).toBe('');
        expect(result.exitCode).toBe(0);
    });

    it('still writes to its cache and /tmp', async () => {
        const result = await run(['sh', '-c', 'mkdir -p /cache/npm && touch /cache/npm/probe && touch /tmp/probe']);
        expect(result.stderr).toBe('');
        expect(result.exitCode).toBe(0);
    });
});

describeDocker('sandbox-dev image online', () => {
    const docker = new Docker();
    let container: Docker.Container;

    beforeAll(async () => {
        if (offline) return;
        container = await startContainer(docker, {
            network: 'bridge',
            limits: {
                cpu: '1',
                memory: '1Gi',
                storage: '1Gi',
                pids: 256,
                maxLifetimeMs: 600_000,
            }, 
        });
    });

    afterAll(async () => {
        await container?.remove({ force: true, v: true });
    });

    it.skipIf(offline)('installs a system package with apt as root', async () => {
        const result = await execInContainer(docker, container, ['sh', '-c', 'apt-get update -qq && apt-get install -y -qq --no-install-recommends file >/dev/null && file --version']);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toMatch(/^file-/);
    }, 180_000);
});
