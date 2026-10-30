/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type GitServer = {
    /** `https://127.0.0.1:<port>`. */
    origin: string;
    /** `127.0.0.1:<port>`. */
    host: string;
    /** The certificate git must trust (`GIT_SSL_CAINFO`). */
    caFile: string;
    /** The directory holding the bare repositories. */
    root: string;
    /** Every request's method, path and `user:password` (undefined without credentials). */
    requests: Array<{
        method: string;
        path: string;
        credentials?: string
    }>;
    /** Runs git in a bare repository of the server (e.g. to read refs). */
    git(repo: string, ...args: string[]): Promise<string>;
    close(): Promise<void>;
};

/** True when `openssl` and `git http-backend` are on this machine. */
export async function canServeGit(): Promise<boolean> {
    try {
        await run('openssl', ['version']);

        const { stdout } = await run('git', ['--exec-path']);

        await run('test', ['-x', join(stdout.trim(), 'git-http-backend')]);

        return true;
    } catch {
        return false;
    }
}

/**
 * A private git host over https on loopback: `git http-backend` behind HTTP
 * basic auth that accepts only `username:password`, a self-signed
 * certificate for 127.0.0.1, every bare repository of `repos` (name to a
 * repository path to clone) served at `/<name>.git`.
 */
export async function startGitServer(input: {
    repos: Record<string, string>;
    username: string;
    password: string;
}): Promise<GitServer> {
    const root = await mkdtemp(join(tmpdir(), 'chamvi-git-server-'));
    const env = {
        PATH: process.env.PATH ?? '',
        HOME: root,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
    };
    const git = async (repo: string, ...args: string[]) => (await run('git', args, { cwd: join(root, `${repo}.git`), env })).stdout;

    try {
        await run('openssl', [
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-days',
            '1',
            '-keyout',
            join(root, 'key.pem'),
            '-out',
            join(root, 'cert.pem'),
            '-subj',
            '/CN=127.0.0.1',
            '-addext',
            'subjectAltName=IP:127.0.0.1',
        ]);

        for (const [name, source] of Object.entries(input.repos)) {
            await run('git', ['clone', '-q', '--bare', source, join(root, `${name}.git`)], { env });
        }
    } catch (error) {
        await rm(root, { recursive: true, force: true });

        throw error;
    }

    const requests: GitServer['requests'] = [];
    const expected = `${input.username}:${input.password}`;
    const server = createServer({
        key: await readFile(join(root, 'key.pem')),
        cert: await readFile(join(root, 'cert.pem')),
    }, (request, response) => {
        const url = new URL(request.url ?? '/', 'https://127.0.0.1');
        const header = request.headers.authorization;
        const credentials = header?.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString() : undefined;

        requests.push({
            method: request.method ?? 'GET',
            path: url.pathname,
            ...(credentials !== undefined && { credentials }),
        });

        if (credentials !== expected) {
            response.writeHead(401, { 'www-authenticate': 'Basic realm="chamvi"' });
            response.end();

            return;
        }

        const backend = spawn('git', ['http-backend'], {
            env: {
                ...env,
                GIT_PROJECT_ROOT: root,
                GIT_HTTP_EXPORT_ALL: '1',
                PATH_INFO: url.pathname,
                QUERY_STRING: url.search.slice(1),
                REQUEST_METHOD: request.method ?? 'GET',
                CONTENT_TYPE: request.headers['content-type'] ?? '',
                HTTP_CONTENT_ENCODING: request.headers['content-encoding'] ?? '',
                REMOTE_USER: input.username,
                REMOTE_ADDR: '127.0.0.1',
            },
        });

        request.pipe(backend.stdin);

        const chunks: Buffer[] = [];

        backend.stdout.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
        });
        backend.on('close', () => {
            const output = Buffer.concat(chunks);
            const end = output.indexOf('\r\n\r\n');
            const split = end >= 0 ? end : output.indexOf('\n\n');
            const gap = end >= 0 ? 4 : 2;
            const headers: Record<string, string> = {};
            let status = 200;

            for (const line of output.subarray(0, split).toString().split(/\r?\n/)) {
                const colon = line.indexOf(':');

                if (colon < 0) {
                    continue;
                }

                const name = line.slice(0, colon).trim().toLowerCase();
                const value = line.slice(colon + 1).trim();

                if (name === 'status') {
                    status = Number.parseInt(value, 10);
                } else {
                    headers[name] = value;
                }
            }

            response.writeHead(status, headers);
            response.end(output.subarray(split + gap));
        });
    });

    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });

    const { port } = server.address() as AddressInfo;

    return {
        origin: `https://127.0.0.1:${port}`,
        host: `127.0.0.1:${port}`,
        caFile: join(root, 'cert.pem'),
        root,
        requests,
        git,
        close: async () => {
            server.closeAllConnections();
            await new Promise<void>((resolve) => {
                server.close(() => resolve());
            });
            await rm(root, { recursive: true, force: true });
        },
    };
}
