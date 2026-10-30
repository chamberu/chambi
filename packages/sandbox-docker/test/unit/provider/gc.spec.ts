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
import { SandboxError, systemClock } from '@chamvi/core';
import type { IWorkspace } from '@chamvi/sandbox';
import { CONTAINER_NAME_PREFIX, createDockerSandbox } from '@chamvi/sandbox-docker';
import { ControllableClock } from '@chamvi/test-kit';
import { describeDocker, dockerImage, dockerOptions } from '../../utils/docker.ts';

/**
 * Controllable `now` (the expiry), real timers: the transport polls the
 * exec state on `clock.setTimeout`, which a manual clock would never fire.
 */
class ExpiryClock extends ControllableClock {
    override setTimeout(fn: () => void, ms: number): { clear(): void } {
        return systemClock.setTimeout(fn, ms);
    }
}

function statusCode(error: unknown): number | undefined {
    return (error as { statusCode?: number } | undefined)?.statusCode;
}

describeDocker('docker garbage collection', () => {
    const docker = new Docker();
    const workspaces: IWorkspace[] = [];
    const strangers: Docker.Container[] = [];

    afterAll(async () => {
        await Promise.all([
            ...workspaces.map((workspace) => workspace.dispose().catch(() => undefined)),
            ...strangers.map((container) => container.remove({ force: true, v: true }).catch(() => undefined)),
        ]);
    });

    it('removes expired workspaces only', async () => {
        // the real time, since a container sleeps until its expiry on the
        // daemon's clock; a deployment of its own, so no workspace of a spec
        // running alongside is in the pass
        const clock = new ExpiryClock(new Date());
        const deployment = `test-${randomUUID().slice(0, 8)}`;
        const provider = createDockerSandbox({
            ...dockerOptions,
            clock,
            limits: { maxLifetimeMs: 600_000 },
        });

        const first = await provider.create({ runId: `test-${randomUUID()}`, deployment });

        workspaces.push(first);
        clock.advance(60_000);

        const second = await provider.create({ runId: `test-${randomUUID()}`, deployment });

        workspaces.push(second);

        // past the first one's expiry, a minute before the second one's
        clock.advance(540_000);
        expect(await provider.collectGarbage({ deployment })).toBe(1);

        await expect(docker.getContainer(`${CONTAINER_NAME_PREFIX}${first.id}`).inspect())
            .rejects.toSatisfy((error) => statusCode(error) === 404);

        const info = await docker.getContainer(`${CONTAINER_NAME_PREFIX}${second.id}`).inspect();

        expect(info.State.Running).toBe(true);
    });

    it('keeps collecting past a container it cannot remove and reports it once', async () => {
        // expired at the epoch, left behind by no process of this run
        const runId = `test-${randomUUID()}`;
        const containers: Docker.Container[] = [];

        for (let index = 0; index < 3; index++) {
            const container = await docker.createContainer({
                Image: dockerImage,
                Cmd: ['sleep', '60'],
                Labels: {
                    'app.kubernetes.io/managed-by': 'chamvi',
                    'app.kubernetes.io/component': 'sandbox',
                    'chamvi.dev/run': runId,
                    'chamvi.dev/workspace': randomUUID(),
                    'chamvi.dev/deployment': 'default',
                    'chamvi.dev/expires-at': '1',
                },
            });

            containers.push(container);
            strangers.push(container);
        }

        const stuck = containers[1]!.id;
        // a client whose removal of one container fails like a busy filesystem
        const failing = Object.create(docker) as Docker;

        failing.getContainer = (id: string) => {
            const container = docker.getContainer(id);

            if (id !== stuck) {
                return container;
            }

            container.remove = async () => {
                throw Object.assign(new Error('(HTTP code 500) unable to remove filesystem: device or resource busy'), { statusCode: 500 });
            };

            return container;
        };

        const error = await createDockerSandbox({ docker: failing, image: dockerImage })
            .collectGarbage()
            .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(SandboxError);
        expect((error as Error).message).toMatch(/1 failed.*resource busy/);

        const left = await docker.listContainers({ all: true, filters: { label: [`chamvi.dev/run=${runId}`] } });

        expect(left.map((info) => info.Id)).toEqual([stuck]);
    });

    it('removes the workspaces of settled runs with isSettled, in its deployment only', async () => {
        const provider = createDockerSandbox({ ...dockerOptions });
        const done = `test-${randomUUID()}`;
        const live = `test-${randomUUID()}`;
        // a deployment of its own: workspaces of specs alongside stay out of the pass
        const deployment = `test-${randomUUID().slice(0, 8)}`;
        const settled = await provider.create({ runId: done, deployment });
        const kept = await provider.create({ runId: live, deployment });
        const other = await provider.create({ runId: done, deployment: 'test-other' });

        workspaces.push(settled, kept, other);

        expect(await provider.collectGarbage({ deployment, isSettled: async (runId) => runId === done })).toBe(1);
        await expect(docker.getContainer(`${CONTAINER_NAME_PREFIX}${settled.id}`).inspect())
            .rejects.toSatisfy((error) => statusCode(error) === 404);
        expect((await docker.getContainer(`${CONTAINER_NAME_PREFIX}${kept.id}`).inspect()).State.Running).toBe(true);
        expect((await docker.getContainer(`${CONTAINER_NAME_PREFIX}${other.id}`).inspect()).State.Running).toBe(true);
    });

    it('never touches containers without the managed-by label', async () => {
        const container = await docker.createContainer({
            Image: dockerImage,
            Cmd: ['sleep', '60'],
            Labels: {
                'app.kubernetes.io/component': 'sandbox',
                'chamvi.dev/run': `test-${randomUUID()}`,
                'chamvi.dev/expires-at': '0',
            },
        });

        strangers.push(container);

        const provider = createDockerSandbox({ ...dockerOptions, clock: new ExpiryClock(new Date(Date.now() - 3_600_000)) });

        await provider.collectGarbage();

        await expect(container.inspect()).resolves.toBeDefined();
    });
});
