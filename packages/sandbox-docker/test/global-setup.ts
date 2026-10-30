/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { fileURLToPath } from 'node:url';
import Docker from 'dockerode';
import type { TestProject } from 'vitest/node';
import type { DockerContext } from './utils/docker.ts';

const IMAGE = 'chamvi/sandbox-dev:test';

const IMAGE_CONTEXT = fileURLToPath(new URL('../../../images/sandbox-dev', import.meta.url));

/** The shared cache volume of the test workspaces, removed after the run (never the default one). */
const CACHE_VOLUME = 'chamvi-sandbox-cache-test';

async function buildImage(docker: Docker): Promise<void> {
    const stream = await docker.buildImage(
        { context: IMAGE_CONTEXT, src: ['Dockerfile'] },
        { t: IMAGE },
    );

    await new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(stream, (err: Error | null, output: Array<{ error?: string }>) => {
            const failed = output.find((event) => typeof event.error === 'string');

            if (err) {
                reject(err);
            } else if (failed) {
                reject(new Error(`Building ${IMAGE} failed: ${failed.error}`));
            } else {
                resolve();
            }
        });
    });
}

async function removeTestContainers(docker: Docker): Promise<void> {
    const containers = await docker.listContainers({
        all: true,
        filters: { label: ['app.kubernetes.io/managed-by=chamvi', 'app.kubernetes.io/component=sandbox'] },
    });

    await Promise.all(containers
        .filter((container) => (container.Labels['chamvi.dev/run'] || '').startsWith('test-'))
        .map((container) => docker.getContainer(container.Id).remove({ force: true, v: true }).catch(() => undefined)));
}

export default async function setup(project: TestProject) {
    const docker = new Docker();

    try {
        await docker.ping();
    } catch (e) {
        if (process.env.CI) {
            throw e;
        }

        const message = Error.isError(e) ? e.message : String(e);

        // eslint-disable-next-line no-console
        console.warn(`[@chamvi/sandbox-docker] Docker is not available, skipping the Docker tests: ${message}. Start Docker to run them.`);

        return undefined;
    }

    await buildImage(docker);

    const context: DockerContext = { image: IMAGE, cacheVolume: CACHE_VOLUME };

    project.provide('docker', context);

    return async () => {
        await removeTestContainers(docker);
        await docker.getVolume(CACHE_VOLUME).remove().catch(() => undefined);
    };
}
