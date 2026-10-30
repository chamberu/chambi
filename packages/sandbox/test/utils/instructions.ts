/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
    mkdir,
    mkdtemp,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
    IExecTransport,
    ISandboxProvider,
    IWorkspace,
} from '@chamvi/sandbox';
import { createRemoteWorkspace } from '@chamvi/sandbox';
import { createLocalSandbox } from '@chamvi/sandbox-local';

export type LocalFixture = {
    workspace: IWorkspace;
    /** The host directory of the workspace root (the local provider's `repo`). */
    dir: string;
    /** Writes files below the workspace root (parents made). */
    write(files: Record<string, string | Uint8Array>): Promise<void>;
    dispose(): Promise<void>;
};

/** A repo-less local workspace over real processes, its root reachable on the host for fixtures. */
export async function createLocalFixture(): Promise<LocalFixture> {
    const root = await mkdtemp(join(tmpdir(), 'chamvi-instructions-'));
    const provider: ISandboxProvider = createLocalSandbox({ root, cache: false });
    const workspace = await provider.create({ runId: `run-${randomUUID()}` });
    const dir = join(root, workspace.id, 'repo');

    return {
        workspace,
        dir,
        async write(files) {
            for (const [path, content] of Object.entries(files)) {
                const file = join(dir, path);

                await mkdir(dirname(file), { recursive: true });
                await writeFile(file, content);
            }
        },
        async dispose() {
            await workspace.dispose();
            await rm(root, { recursive: true, force: true });
        },
    };
}

/** Runs a host command, resolving its exit code and output. */
export function run(command: string, args: string[], stdin?: Uint8Array): Promise<{
    code: number;
    stdout: string;
    stderr: string
}> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => resolve({
            code: code ?? 1,
            stdout,
            stderr,
        }));
        child.stdin.end(stdin);
    });
}

/** Whether the docker CLI reaches a daemon that has `image`. */
export async function hasDockerImage(image: string): Promise<boolean> {
    try {
        return (await run('docker', ['image', 'inspect', image])).code === 0;
    } catch {
        return false;
    }
}

/**
 * An `IExecTransport` over `docker exec -i` into a running container: the
 * remote workspace path (exec script, timeout wrapper) on Linux.
 */
export function createDockerExecTransport(container: string): IExecTransport {
    return {
        exec(argv, options) {
            return new Promise((resolve, reject) => {
                const child = spawn('docker', ['exec', '-i', container, ...argv], { stdio: ['pipe', 'pipe', 'pipe'] });
                const onAbort = () => child.kill('SIGKILL');

                options.signal.addEventListener('abort', onAbort, { once: true });
                child.stdout.on('data', (chunk: Buffer) => options.stdout.write(new Uint8Array(chunk)));
                child.stderr.on('data', (chunk: Buffer) => options.stderr.write(new Uint8Array(chunk)));
                child.on('error', reject);
                child.on('close', (code) => {
                    options.signal.removeEventListener('abort', onAbort);
                    resolve({ exitCode: code ?? 137 });
                });
                child.stdin.on('error', () => undefined);
                child.stdin.end(options.stdin);
            });
        },
        async remove() {
            await run('docker', ['rm', '-f', container]);
        },
    };
}

export type DockerFixture = {
    workspace: IWorkspace;
    /** Runs a shell script in the container's `/workspace` (fixture setup). */
    sh(script: string): Promise<void>;
    write(files: Record<string, string>): Promise<void>;
    dispose(): Promise<void>;
};

/** A remote workspace over a fresh container of `image`, its `/workspace` a writable tmpfs. */
export async function createDockerFixture(image: string, user?: string): Promise<DockerFixture> {
    const name = `chamvi-instructions-test-${randomUUID()}`;
    const args = [
        'run',
        '-d',
        '--rm',
        '--name',
        name,
        '--entrypoint',
        'sleep',
        '--tmpfs',
        '/workspace:exec,mode=1777',
        '-w',
        '/workspace',
    ];

    if (user) {
        args.push('--user', user);
    }

    const started = await run('docker', [...args, image, '600']);

    if (started.code !== 0) {
        throw new Error(`docker run failed: ${started.stderr}`);
    }

    const transport = createDockerExecTransport(name);
    const workspace = createRemoteWorkspace({
        id: randomUUID(),
        info: {
            runId: 'run-docker',
            provider: 'docker-test',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 600_000),
        },
        transport,
    });
    const sh = async (script: string) => {
        const result = await run('docker', ['exec', '-i', '-w', '/workspace', name, 'sh', '-c', script]);

        if (result.code !== 0) {
            throw new Error(`fixture script failed: ${result.stderr}`);
        }
    };

    return {
        workspace,
        sh,
        async write(files) {
            for (const [path, content] of Object.entries(files)) {
                const result = await run(
                    'docker',
                    ['exec', '-i', '-w', '/workspace', name, 'sh', '-c', 'mkdir -p "$(dirname "$1")" && cat > "$1"', 'sh', path],
                    new TextEncoder().encode(content),
                );

                if (result.code !== 0) {
                    throw new Error(`fixture write failed: ${result.stderr}`);
                }
            }
        },
        async dispose() {
            await workspace.dispose();
        },
    };
}
