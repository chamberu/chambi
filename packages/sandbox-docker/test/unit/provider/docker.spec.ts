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
    expect,
    it,
} from 'vitest';
import { SandboxError } from '@chamvi/core';
import { createWorkspaceManager } from '@chamvi/sandbox';
import type { IWorkspace } from '@chamvi/sandbox';
import { CONTAINER_NAME_PREFIX, createDockerSandbox } from '@chamvi/sandbox-docker';
import { ControllableClock } from '@chamvi/test-kit';
import { describeDocker, dockerImage } from '../../utils/docker.ts';

const offline = Boolean(process.env.CHAMVI_OFFLINE);

const MISSING_IMAGE = 'chamvi/does-not-exist:none';

function statusCode(error: unknown): number | undefined {
    return (error as { statusCode?: number } | undefined)?.statusCode;
}

describeDocker('docker sandbox', () => {
    const docker = new Docker();
    const workspaces: IWorkspace[] = [];

    async function create(options: Parameters<typeof createDockerSandbox>[0] = {}, input: { repo?: string; ref?: string } = {}) {
        const runId = `test-${randomUUID()}`;
        const workspace = await createDockerSandbox({ image: dockerImage, ...options }).create({ runId, ...input });
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

        const found = await createDockerSandbox({ image: dockerImage }).find(runId);
        workspaces.push(...found);
        expect(found.map((item) => item.id)).toEqual([workspace.id]);
        expect(found[0]!.info).toEqual({ ...workspace.info, image: dockerImage });
        expect((await container.inspect()).State.Running).toBe(true);
        expect(await found[0]!.readFile('kept.txt')).toBe('work');
    });

    it('restarts the stopped container of a workspace the manager still holds', async () => {
        const provider = createDockerSandbox({ image: dockerImage });
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
        client.listContainers = async (options) => (await docker.listContainers(options))
            .map((item) => ({ ...item, State: 'exited' }));

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
        const provider = createDockerSandbox({ image: dockerImage });
        const runId = `test-${randomUUID()}`;
        const workspace = await provider.create({ runId });
        workspaces.push(workspace);
        const disposal = workspace.dispose();
        expect(await provider.find(runId)).toEqual([]);
        await disposal;
        expect(await containersOf(runId)).toEqual([]);
    });

    it('finds the instance it holds, never another deployment\'s or an expired one', async () => {
        const provider = createDockerSandbox({ image: dockerImage });
        const runId = `test-${randomUUID()}`;
        const workspace = await provider.create({ runId, deployment: 'test-a' });
        workspaces.push(workspace);
        expect(await provider.find(runId, { deployment: 'test-a' })).toEqual([workspace]);
        expect((await provider.find(runId, { deployment: 'test-a' }))[0]).toBe(workspace);
        expect(await provider.find(runId)).toEqual([]);

        const later = new ControllableClock(new Date(workspace.info.expiresAt.getTime()));
        expect(await createDockerSandbox({ image: dockerImage, clock: later }).find(runId, { deployment: 'test-a' })).toEqual([]);
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
        await expect(createDockerSandbox({ image: dockerImage, network: 'none' }).create({
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
        await expect(createDockerSandbox({ image: MISSING_IMAGE, pull: 'never' }).create({ runId }))
            .rejects.toBeInstanceOf(SandboxError);
        expect(await containersOf(runId)).toEqual([]);
    });

    it.skipIf(offline)('a failed pull fails cleanly', async () => {
        const runId = `test-${randomUUID()}`;
        const error = await createDockerSandbox({ image: MISSING_IMAGE, pull: 'missing' })
            .create({ runId })
            .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SandboxError);
        expect((error as Error).message).toContain(`cannot pull the image ${MISSING_IMAGE}`);
        expect(await containersOf(runId)).toEqual([]);
    });

    it.skipIf(offline)('pull always pulls', async () => {
        const runId = `test-${randomUUID()}`;
        // the test image is a local-only tag, so a pull must fail
        const error = await createDockerSandbox({ image: dockerImage, pull: 'always' })
            .create({ runId })
            .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SandboxError);
        expect((error as Error).message).toContain(dockerImage as string);
        expect(await containersOf(runId)).toEqual([]);
    });
});
