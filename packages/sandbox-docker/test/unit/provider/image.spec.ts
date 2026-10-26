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

describeDocker('sandbox image', () => {
    const docker = new Docker();
    let container: Docker.Container;

    async function run(argv: string[]) {
        return execInContainer(docker, container, argv);
    }

    beforeAll(async () => {
        container = await docker.createContainer(buildContainerOptions({
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
            env: {},
            limits: {
                cpu: '1',
                memory: '512Mi',
                storage: '1Gi',
                pids: 256,
                maxLifetimeMs: 600_000,
            },
        }));
        await container.start();
    });

    afterAll(async () => {
        await container?.remove({ force: true, v: true });
    });

    it('runs as uid 1000', async () => {
        const result = await run(['id', '-u']);
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('1000');
    });

    it('ships node 24', async () => {
        const result = await run(['node', '--version']);
        expect(result.exitCode).toBe(0);
        expect(result.stdout.startsWith('v24.')).toBe(true);
    });

    it('ships git', async () => {
        expect((await run(['git', '--version'])).exitCode).toBe(0);
    });

    it('ships GNU timeout', async () => {
        expect((await run(['timeout', '--version'])).exitCode).toBe(0);
    });

    it('has a read-only root', async () => {
        expect((await run(['touch', '/etc/probe'])).exitCode).not.toBe(0);
    });

    it('writes to /workspace and /tmp', async () => {
        const result = await run(['sh', '-c', 'touch /workspace/probe && touch /tmp/probe']);
        expect(result.stderr).toBe('');
        expect(result.exitCode).toBe(0);
    });

    it('runs programs from /tmp, where npm installs global bins', async () => {
        const mount = await run(['sh', '-c', 'grep " /tmp " /proc/self/mounts']);
        expect(mount.stdout).toMatch(/nosuid/);
        expect(mount.stdout).toMatch(/nodev/);
        expect(mount.stdout).not.toMatch(/noexec/);

        const script = await run(['sh', '-c', 'mkdir -p /tmp/.npm-global/bin && printf "#!/bin/sh\\necho ran\\n" > /tmp/.npm-global/bin/probe && chmod +x /tmp/.npm-global/bin/probe && probe']);
        expect(script).toMatchObject({ exitCode: 0, stdout: 'ran\n' });
    });

    it('holds no capabilities', async () => {
        const result = await run(['grep', 'CapEff', '/proc/self/status']);
        expect(result.stdout).toMatch(/CapEff:\s+0000000000000000/);
    });

    it('sets no-new-privileges', async () => {
        const result = await run(['grep', 'NoNewPrivs', '/proc/self/status']);
        expect(result.stdout).toMatch(/NoNewPrivs:\s+1/);
    });

    it('runs tini as pid 1', async () => {
        const result = await run(['cat', '/proc/1/comm']);
        expect(result.stdout.trim()).toBe('tini');
    });

    it('applies the pid limit and the read-only root', async () => {
        const info = await container.inspect();
        expect(info.HostConfig.PidsLimit).toBe(256);
        expect(info.HostConfig.ReadonlyRootfs).toBe(true);
    });
});
