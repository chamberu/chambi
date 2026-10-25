/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Docker from 'dockerode';
import {
    afterAll,
    expect,
    it,
} from 'vitest';
import { SandboxError } from '@chamvi/core';
import { createWorkspaceManager } from '@chamvi/sandbox';
import type { IWorkspace } from '@chamvi/sandbox';
import { CONTAINER_NAME_PREFIX, createDockerSandbox } from '@chamvi/sandbox-docker';
import { ControllableClock } from '@chamvi/test-kit';
import { describeDocker, dockerImage, dockerOptions } from '../../utils/docker.ts';

const offline = Boolean(process.env.CHAMVI_OFFLINE);

const MISSING_IMAGE = 'chamvi/does-not-exist:none';

const NO_GIT_IMAGE = 'chamvi/sandbox-no-git:test';

/** Builds `test/fixtures/no-git` on top of the test image (offline). */
async function buildNoGitImage(docker: Docker): Promise<void> {
    const stream = await docker.buildImage(
        { context: fileURLToPath(new URL('../../fixtures/no-git', import.meta.url)), src: ['Dockerfile'] },
        { t: NO_GIT_IMAGE, buildargs: { BASE: dockerImage as string } },
    );
    await new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(stream, (error: Error | null, output: Array<{ error?: string }>) => {
            const failed = output.find((event) => typeof event.error === 'string');
            if (error || failed) reject(error ?? new Error(failed!.error)); else resolve();
        });
    });
}

function statusCode(error: unknown): number | undefined {
    return (error as { statusCode?: number } | undefined)?.statusCode;
}

describeDocker('docker sandbox', () => {
    const docker = new Docker();
    const workspaces: IWorkspace[] = [];

    async function create(options: Parameters<typeof createDockerSandbox>[0] = {}, input: { repo?: string; ref?: string } = {}) {
        const runId = `test-${randomUUID()}`;
        const workspace = await createDockerSandbox({ ...dockerOptions, ...options }).create({ runId, ...input });
        workspaces.push(workspace);
        return { runId, workspace };
    }

    async function containersOf(runId: string) {
        return docker.listContainers({ all: true, filters: { label: [`chamvi.dev/run=${runId}`] } });
    }

    afterAll(async () => {
        await Promise.all(workspaces.map((workspace) => workspace.dispose().catch(() => undefined)));
    });

    it('labels the container with its run', async () => {
        const { runId, workspace } = await create();
        const containers = await containersOf(runId);
        expect(containers).toHaveLength(1);
        expect(containers[0]?.Labels['chamvi.dev/workspace']).toBe(workspace.id);
        expect(containers[0]?.Names).toEqual([`/${CONTAINER_NAME_PREFIX}${workspace.id}`]);
        expect(workspace.info).toMatchObject({ runId, provider: 'docker' });
    });

    it('marks a workspace whose container stopped as gone', async () => {
        const { workspace } = await create();
        const container = docker.getContainer(`${CONTAINER_NAME_PREFIX}${workspace.id}`);
        await container.kill();
        expect(workspace.disposed).toBe(false);

        await expect(workspace.exec(['true'])).rejects.toThrow(/is gone.*not running.*create_workspace/);
        expect(workspace.disposed).toBe(true);
        await expect(workspace.readFile('a.txt')).rejects.toThrow(/is gone/);

        // dispose removes the stopped container
        await workspace.dispose();
        await expect(container.inspect()).rejects.toSatisfy((error) => statusCode(error) === 404);
    });

    it('marks a workspace whose container was removed as gone', async () => {
        const { workspace } = await create();
        await docker.getContainer(`${CONTAINER_NAME_PREFIX}${workspace.id}`).remove({ force: true, v: true });

        await expect(workspace.exec(['true'])).rejects.toThrow(/is gone/);
        expect(workspace.disposed).toBe(true);
        await workspace.dispose();
    });

    it('a second provider finds the workspace again and restarts its stopped container', async () => {
        const { runId, workspace } = await create();
        await workspace.writeFile('kept.txt', 'work');
        const container = docker.getContainer(`${CONTAINER_NAME_PREFIX}${workspace.id}`);
        // the host restarted: the container stopped, its volume holds the work
        await container.stop({ t: 0 });

        const found = await createDockerSandbox({ ...dockerOptions }).find(runId);
        workspaces.push(...found);
        expect(found.map((item) => item.id)).toEqual([workspace.id]);
        expect(found[0]!.info).toEqual({ ...workspace.info, image: dockerImage });
        expect((await container.inspect()).State.Running).toBe(true);
        expect(await found[0]!.readFile('kept.txt')).toBe('work');
    });

    it('never finds a stopped container whose create died before the checkout finished', async () => {
        const { runId, workspace } = await create();
        // the state a create killed during the fetch leaves: no checkout record
        expect((await workspace.exec(['git', 'config', '--unset', 'chamvi.checkout'])).exitCode).toBe(0);
        await docker.getContainer(`${CONTAINER_NAME_PREFIX}${workspace.id}`).stop({ t: 0 });

        expect(await createDockerSandbox({ image: dockerImage }).find(runId)).toEqual([]);
    });

    it('restarts the stopped container of a workspace the manager still holds', async () => {
        const provider = createDockerSandbox({ ...dockerOptions });
        const errors: unknown[] = [];
        const manager = createWorkspaceManager({
            provider, 
            gcIntervalMs: 0, 
            onError: (error) => { errors.push(error); }, 
        });
        const runId = `test-${randomUUID()}`;
        const { workspace } = await manager.acquire(runId, {});
        workspaces.push(workspace);
        await workspace.writeFile('kept.txt', 'work');
        const container = docker.getContainer(`${CONTAINER_NAME_PREFIX}${workspace.id}`);
        // the daemon restarted while the run waited on an approval
        await container.stop({ t: 0 });

        const held = await manager.get(runId);
        await expect(held.exec(['cat', 'kept.txt'])).rejects.toThrow(/is gone/);

        const restarted = await manager.get(runId);
        workspaces.push(restarted);
        expect(restarted.id).toBe(workspace.id);
        expect(restarted).not.toBe(workspace);
        expect((await container.inspect()).State.Running).toBe(true);
        expect(await restarted.readFile('kept.txt')).toBe('work');
        expect(await provider.find(runId)).toEqual([restarted]);
        expect(errors).toEqual([]);
    });

    it('finds a workspace listed as exited that is running again by the time it starts it', async () => {
        const { runId, workspace } = await create();
        await workspace.writeFile('kept.txt', 'work');
        // the list is older than the start: an operator's docker start, live-restore, another replica's find
        const client = Object.create(docker) as Docker;
        const list = async (options?: Docker.ContainerListOptions) => (await docker.listContainers(options))
            .map((item) => ({ ...item, State: 'exited' }));
        client.listContainers = list as Docker['listContainers'];

        const found = await createDockerSandbox({ image: dockerImage, docker: client }).find(runId);
        workspaces.push(...found);
        expect(found.map((item) => item.id)).toEqual([workspace.id]);
        expect(await found[0]!.readFile('kept.txt')).toBe('work');
    });

    it('restarts the stopped container of a held workspace on find and keeps the handle', async () => {
        const provider = createDockerSandbox({ image: dockerImage });
        const runId = `test-${randomUUID()}`;
        const workspace = await provider.create({ runId });
        workspaces.push(workspace);
        await workspace.writeFile('kept.txt', 'work');
        const container = docker.getContainer(`${CONTAINER_NAME_PREFIX}${workspace.id}`);
        await container.stop({ t: 0 });

        expect(await provider.find(runId)).toEqual([workspace]);
        expect((await provider.find(runId))[0]).toBe(workspace);
        expect((await container.inspect()).State.Running).toBe(true);
        expect(await workspace.readFile('kept.txt')).toBe('work');
        expect(workspace.disposed).toBe(false);
    });

    it('never finds a workspace again that it is disposing', async () => {
        const provider = createDockerSandbox({ ...dockerOptions });
        const runId = `test-${randomUUID()}`;
        const workspace = await provider.create({ runId });
        workspaces.push(workspace);
        const disposal = workspace.dispose();
        expect(await provider.find(runId)).toEqual([]);
        await disposal;
        expect(await containersOf(runId)).toEqual([]);
    });

    it('finds the instance it holds, never another deployment\'s or an expired one', async () => {
        const provider = createDockerSandbox({ ...dockerOptions });
        const runId = `test-${randomUUID()}`;
        const workspace = await provider.create({ runId, deployment: 'test-a' });
        workspaces.push(workspace);
        expect(await provider.find(runId, { deployment: 'test-a' })).toEqual([workspace]);
        expect((await provider.find(runId, { deployment: 'test-a' }))[0]).toBe(workspace);
        expect(await provider.find(runId)).toEqual([]);

        const later = new ControllableClock(new Date(workspace.info.expiresAt.getTime()));
        expect(await createDockerSandbox({ ...dockerOptions, clock: later }).find(runId, { deployment: 'test-a' })).toEqual([]);
    });

    it('dispose removes container and volume', async () => {
        const { workspace } = await create();
        const container = docker.getContainer(`${CONTAINER_NAME_PREFIX}${workspace.id}`);
        const volume = (await container.inspect()).Mounts[0]?.Name as string;
        expect(volume).toBeTruthy();

        await workspace.dispose();

        await expect(container.inspect()).rejects.toSatisfy((error) => statusCode(error) === 404);
        await expect(docker.getVolume(volume).inspect()).rejects.toSatisfy((error) => statusCode(error) === 404);
    });

    it('survives stdin the command never read when the container goes', async () => {
        const errors: unknown[] = [];
        const record = (error: unknown) => {
            errors.push(error);
        };
        process.on('uncaughtException', record);
        try {
            const { workspace } = await create();
            // more than the daemon absorbs: the rest stays queued on the socket
            const result = await workspace.exec(['true'], { stdin: 'x'.repeat(4_000_000) });
            expect(result.exitCode).toBe(0);
            await workspace.dispose();
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 500);
            });
            expect(errors).toEqual([]);
        } finally {
            process.off('uncaughtException', record);
        }
    });

    it.skipIf(offline)('clones a public repository', async () => {
        const { workspace } = await create({}, { repo: 'https://github.com/octocat/Hello-World.git', ref: 'master' });
        expect(await workspace.readFile('README')).toContain('Hello World');
        expect(workspace.info.commit).toMatch(/^[0-9a-f]{40}$/);
    });

    it('network none has no network', async () => {
        const { workspace } = await create({ network: 'none' });
        const result = await workspace.exec(['getent', 'hosts', 'github.com']);
        expect(result.exitCode).not.toBe(0);

        const runId = `test-${randomUUID()}`;
        await expect(createDockerSandbox({ ...dockerOptions, network: 'none' }).create({
            runId,
            repo: 'https://github.com/octocat/Hello-World.git',
        })).rejects.toBeInstanceOf(SandboxError);
        expect(await containersOf(runId)).toEqual([]);
    });

    it('does not pass the host environment', async () => {
        process.env.CHAMVI_SECRET_PROBE = 's3cret';
        try {
            const { workspace } = await create({ env: { VISIBLE: 'yes' } });
            const result = await workspace.exec(['env']);
            expect(result.exitCode).toBe(0);
            expect(result.stdout).not.toContain('s3cret');
            expect(result.stdout).toContain('VISIBLE=yes');
        } finally {
            delete process.env.CHAMVI_SECRET_PROBE;
        }
    });

    it('applies limits', async () => {
        const { workspace } = await create({ limits: { memory: '256Mi', pids: 64 } });
        const info = await docker.getContainer(`${CONTAINER_NAME_PREFIX}${workspace.id}`).inspect();
        expect(info.HostConfig.Memory).toBe(268_435_456);
        expect(info.HostConfig.PidsLimit).toBe(64);
    });

    it('a missing image fails cleanly', async () => {
        const runId = `test-${randomUUID()}`;
        await expect(createDockerSandbox({
            ...dockerOptions, 
            image: MISSING_IMAGE, 
            pull: 'never', 
        }).create({ runId }))
            .rejects.toBeInstanceOf(SandboxError);
        expect(await containersOf(runId)).toEqual([]);
    });

    it.skipIf(offline)('a failed pull fails cleanly', async () => {
        const runId = `test-${randomUUID()}`;
        const error = await createDockerSandbox({
            ...dockerOptions, 
            image: MISSING_IMAGE, 
            pull: 'missing', 
        })
            .create({ runId })
            .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SandboxError);
        expect((error as Error).message).toContain(`cannot pull the image ${MISSING_IMAGE}`);
        expect(await containersOf(runId)).toEqual([]);
    });

    it.skipIf(offline)('pull always pulls', async () => {
        const runId = `test-${randomUUID()}`;
        // the test image is a local-only tag, so a pull must fail
        const error = await createDockerSandbox({ ...dockerOptions, pull: 'always' })
            .create({ runId })
            .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SandboxError);
        expect((error as Error).message).toContain(dockerImage as string);
        expect(await containersOf(runId)).toEqual([]);
    });

    it('runs a workspace as root with a writable root, so apt-style installs work', async () => {
        const { workspace } = await create();
        expect((await workspace.exec(['id', '-u'])).stdout.trim()).toBe('0');
        const result = await workspace.exec(['sh', '-c', 'touch /usr/local/bin/probe && echo ok']);
        expect(result).toMatchObject({ exitCode: 0, stdout: 'ok\n' });
    });

    it('shares the cache volume between workspaces of different runs', async () => {
        const { workspace: first } = await create();
        const { workspace: second } = await create();
        const marker = randomUUID();
        expect((await first.exec(['sh', '-c', `mkdir -p "$npm_config_cache" && echo ${marker} > "$npm_config_cache/${marker}"`])).exitCode).toBe(0);
        const read = await second.exec(['sh', '-c', `cat "$npm_config_cache/${marker}"`]);
        expect(read.stdout.trim()).toBe(marker);
        expect((await second.exec(['sh', '-c', 'echo $npm_config_cache'])).stdout.trim()).toBe('/cache/npm');
    });

    it('never runs a git or timeout another run planted in the shared cache', async () => {
        const { workspace: planter } = await create();
        const marker = randomUUID();
        const evil = `/cache/evil-${marker}`;
        // logs every call, then runs the real program, so a hijack stays unnoticed but for the log
        await planter.writeFile('plant.sh', `#!/bin/sh\necho "$0 $*" >> /cache/${marker}\nexec /usr/bin/$(basename "$0") "$@"\n`);
        const plant = await planter.exec(['sh', '-c', `for d in /cache/mise/shims ${evil}; do mkdir -p $d && ` +
            'for n in git timeout; do cp plant.sh $d/$n && chmod +x $d/$n || exit 1; done; done']);
        expect(plant.exitCode).toBe(0);
        try {
            // the image's PATH, and an operator PATH that names a cache folder
            const { workspace: plain } = await create();
            const { workspace: operator } = await create({ env: { PATH: `${evil}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` } });
            expect((await plain.exec(['sh', '-c', 'command -v git; command -v timeout'])).stdout).toBe('/usr/bin/git\n/usr/bin/timeout\n');
            expect((await operator.exec(['sh', '-c', 'command -v git; command -v timeout'])).stdout).toBe('/usr/bin/git\n/usr/bin/timeout\n');
            expect((await planter.exec(['sh', '-c', `cat /cache/${marker} 2>/dev/null || echo none`])).stdout).toBe('none\n');
        } finally {
            await planter.exec(['rm', '-rf', '/cache/mise/shims', evil, `/cache/${marker}`]);
        }
    });

    it('keeps the cache of its own with cache false', async () => {
        const { workspace: first } = await create({ cache: false });
        const { workspace: second } = await create({ cache: false });
        await first.exec(['sh', '-c', 'mkdir -p /cache/npm && echo one > /cache/npm/own']);
        expect((await second.exec(['cat', '/cache/npm/own'])).exitCode).not.toBe(0);
        expect((await first.exec(['cat', '/cache/npm/own'])).stdout).toBe('one\n');
    });

    it('runs the hardened mode as its user on a read-only root', async () => {
        const { workspace } = await create({
            user: '1000:1000', 
            readOnlyRoot: true, 
            cache: false, 
        });
        expect((await workspace.exec(['id', '-u'])).stdout.trim()).toBe('1000');
        expect((await workspace.exec(['touch', '/etc/probe'])).exitCode).not.toBe(0);
        await workspace.writeFile('a.txt', 'hardened');
        expect(await workspace.readFile('a.txt')).toBe('hardened');
    });

    it('refuses an image without git before any checkout and leaves no container', async () => {
        await buildNoGitImage(docker);
        try {
            const runId = `test-${randomUUID()}`;
            const error = await createDockerSandbox({
                ...dockerOptions, 
                image: NO_GIT_IMAGE, 
                pull: 'never', 
            })
                .create({ runId, repo: 'https://github.com/octocat/Hello-World.git' })
                .catch((e: unknown) => e);
            expect(error).toBeInstanceOf(SandboxError);
            expect((error as Error).message).toContain(`image ${NO_GIT_IMAGE} lacks what a workspace needs: git.`);
            expect(await containersOf(runId)).toEqual([]);
        } finally {
            await docker.getImage(NO_GIT_IMAGE).remove({ force: true }).catch(() => undefined);
        }
    });

    it.skipIf(offline)('pulls a model-chosen image when missing, whatever pull says', async () => {
        const runId = `test-${randomUUID()}`;
        const error = await createDockerSandbox({ ...dockerOptions, pull: 'never' })
            .create({
                runId,
                image: MISSING_IMAGE,
                imageRequested: true,
            })
            .catch((e: unknown) => e);
        expect((error as Error).message).toContain(`cannot pull the image ${MISSING_IMAGE}`);
        expect(await containersOf(runId)).toEqual([]);
    });

    it('never pulls the operator\'s image with pull never, also when it is not the provider\'s', async () => {
        const runId = `test-${randomUUID()}`;
        const error = await createDockerSandbox({ ...dockerOptions, pull: 'never' })
            .create({ runId, image: MISSING_IMAGE })
            .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SandboxError);
        expect((error as Error).message).toContain(`cannot create a workspace container from ${MISSING_IMAGE}`);
        expect((error as Error).message).not.toContain('cannot pull');
        expect(await containersOf(runId)).toEqual([]);
    });
});
