/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto';
import Docker from 'dockerode';
import { it } from 'vitest';
import { CONTAINER_NAME_PREFIX, createDockerSandbox } from '@chamvi/sandbox-docker';
import { describeDocker, dockerOptions } from '../../utils/docker.ts';

describeDocker('DEBUG restart', () => {
    it('prints why a stopped container does not start again', async () => {
        const docker = new Docker();
        const workspace = await createDockerSandbox({ ...dockerOptions }).create({ runId: `test-${randomUUID()}` });
        const container = docker.getContainer(`${CONTAINER_NAME_PREFIX}${workspace.id}`);
        await container.stop({ t: 0 });
        const before = await container.inspect();
        console.log('DEBUG state before', JSON.stringify(before.State));
        try {
            await container.start();
            console.log('DEBUG start ok');
        } catch (error) {
            console.log('DEBUG start error', (error as Error).message, JSON.stringify(error));
        }
        const after = await container.inspect();
        console.log('DEBUG state after', JSON.stringify(after.State));
        console.log('DEBUG mounts', JSON.stringify(after.Mounts), JSON.stringify(after.HostConfig.Tmpfs), after.HostConfig.Init, after.Config.User);
        await workspace.dispose();
    }, 120_000);
});
