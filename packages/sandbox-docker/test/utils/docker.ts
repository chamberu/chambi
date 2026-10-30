/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type Docker from 'dockerode';
import { describe, inject } from 'vitest';

export type DockerContext = {
    /** The sandbox image built from `images/sandbox-dev` by the global setup. */
    image: string;
    /** The shared cache volume the tests use (removed by the global setup's teardown). */
    cacheVolume: string;
};

declare module 'vitest' {
    // Vitest's augmentation name is fixed by its public API.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    export interface ProvidedContext {
        docker: DockerContext;
    }
}

const context: DockerContext | undefined = inject('docker');

/** The test image, `undefined` when Docker is not available. */
export const dockerImage: string | undefined = context?.image;

/**
 * The provider options of the tests: the test image and the tests' own
 * shared cache volume (removed by the global setup's teardown).
 */
export const dockerOptions = {
    image: context?.image,
    cache: { volume: context?.cacheVolume },
};

/** A `describe` that skips when the global setup found no Docker daemon. */
export function describeDocker(name: string, fn: () => void): void {
    describe.skipIf(!context)(name, fn);
}

export type ContainerExecResult = {
    exitCode: number;
    stdout: string;
    stderr: string;
};

function collect(stream: PassThrough): () => string {
    const chunks: Buffer[] = [];

    stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
    });

    return () => Buffer.concat(chunks).toString('utf8');
}

/** Runs argv in a started container through the Docker API (no provider involved). */
export async function execInContainer(
    docker: Docker,
    container: Docker.Container,
    argv: string[],
): Promise<ContainerExecResult> {
    const exec = await container.exec({
        Cmd: argv,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const readStdout = collect(stdout);
    const readStderr = collect(stderr);

    docker.modem.demuxStream(stream, stdout, stderr);
    await new Promise<void>((resolve, reject) => {
        stream.on('end', () => resolve());
        stream.on('close', () => resolve());
        stream.on('error', reject);
    });

    let info = await exec.inspect();

    for (let i = 0; info.Running && i < 100; i++) {
        await new Promise((resolve) => {
            setTimeout(resolve, 50);
        });
        info = await exec.inspect();
    }

    return {
        exitCode: info.ExitCode ?? -1,
        stdout: readStdout(),
        stderr: readStderr(),
    };
}

/**
 * Builds the fixture `test/fixtures/<fixture>` as `tag`, its `BASE` build
 * argument the test image (offline unless the Dockerfile names another base).
 */
export async function buildFixtureImage(docker: Docker, fixture: string, tag: string): Promise<void> {
    const stream = await docker.buildImage(
        { context: fileURLToPath(new URL(`../fixtures/${fixture}`, import.meta.url)), src: ['Dockerfile'] },
        { t: tag, buildargs: { BASE: dockerImage as string } },
    );

    await new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(stream, (error: Error | null, output: Array<{ error?: string }>) => {
            const failed = output.find((event) => typeof event.error === 'string');

            if (error || failed) {
                reject(error ?? new Error(failed!.error));
            } else {
                resolve();
            }
        });
    });
}
