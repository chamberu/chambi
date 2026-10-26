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
        const fresh = await createDockerSandbox({ ...dockerOptions }).create({ runId: `test-${randomUUID()}` });
        const freshContainer = docker.getContainer(`${CONTAINER_NAME_PREFIX}${fresh.id}`);
        await freshContainer.stop({ t: 0 });
        const listed = await docker.listContainers({ all: true, filters: { label: [`chamvi.dev/run=${fresh.info.runId}`] } });
        console.log('DEBUG listed', JSON.stringify(listed.map((c) => ({
            State: c.State, 
            Status: c.Status, 
            Labels: c.Labels, 
        }))));
        const found = await createDockerSandbox({ ...dockerOptions }).find(fresh.info.runId);
        console.log('DEBUG found', found.length);
        await freshContainer.start().catch(() => undefined);
        for (const argv of [['git', 'config', '--get', 'chamvi.checkout'], ['id'], ['sh', '-c', 'pwd; ls -la /workspace | head -5; cat /workspace/.git/config']]) {
            const exec = await freshContainer.exec({
                Cmd: argv, 
                AttachStdout: true, 
                AttachStderr: true, 
                User: '0:0', 
                WorkingDir: '/workspace', 
            });
            const stream = await exec.start({});
            const chunks: Buffer[] = [];
            await new Promise<void>((resolve) => { stream.on('data', (c: Buffer) => { chunks.push(c); }); stream.on('end', () => resolve()); });
            console.log('DEBUG exec', argv.join(' '), JSON.stringify(Buffer.concat(chunks).toString('utf8')), (await exec.inspect()).ExitCode);
        }
        await fresh.dispose().catch(() => undefined);
        const after = await container.inspect();
        console.log('DEBUG state after', JSON.stringify(after.State));
        console.log('DEBUG mounts', JSON.stringify(after.Mounts), JSON.stringify(after.HostConfig.Tmpfs), after.HostConfig.Init, after.Config.User);
        await workspace.dispose();
    }, 120_000);
});
