/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { execFile } from 'node:child_process';
import {
    mkdtemp,
    readFile,
    rm,
    stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CREDENTIAL_HELPER_SCRIPT, INSTALL_CREDENTIALS_SCRIPT } from '../../../src/git/constants.ts';
import { credentialsFileContent } from '../../../src/git/helpers.ts';

function run(
    argv: string[],
    stdin: string,
    env: Record<string, string>,
): Promise<{
    stdout: string; 
    stderr: string; 
    code: number 
}> {
    return new Promise((resolve) => {
        const child = execFile(argv[0]!, argv.slice(1), { env }, (error, stdout, stderr) => {
            resolve({
                stdout,
                stderr,
                code: error ? Number((error as { code?: number }).code ?? 1) : 0,
            });
        });
        child.stdin!.on('error', () => {});
        child.stdin!.end(stdin);
    });
}

describe('the workspace credential helper', () => {
    it('installs the file (0600) and the helper, and answers through real git', async () => {
        const home = await mkdtemp(join(tmpdir(), 'chamvi-git-home-'));
        try {
            const content = credentialsFileContent([
                {
                    key: 'https://github.com/octo/demo', 
                    username: 'x-access-token', 
                    password: 'repo-secret', 
                },
                {
                    key: 'https://github.com/', 
                    username: 'oauth2', 
                    password: 'host-secret', 
                },
            ]);
            const realGit = {
                PATH: process.env.PATH ?? '', 
                HOME: home, 
                GIT_CONFIG_NOSYSTEM: '1', 
            };
            const install = await run(['sh', '-c', INSTALL_CREDENTIALS_SCRIPT, 'sh', CREDENTIAL_HELPER_SCRIPT, String(Buffer.byteLength(content))], content, realGit);
            expect(install.code).toBe(0);
            expect(await readFile(join(home, '.chamvi/credentials'), 'utf8')).toBe(content);
            expect((await stat(join(home, '.chamvi/credentials'))).mode & 0o777).toBe(0o600);

            const fill = (request: string) => run(['git', 'credential', 'fill'], request, { ...realGit, GIT_TERMINAL_PROMPT: '0' });
            await expect(fill('protocol=https\nhost=github.com\npath=octo/demo.git\n\n')).resolves.toMatchObject({ stdout: expect.stringContaining('password=repo-secret') });
            await expect(fill('protocol=https\nhost=github.com\npath=other/repo.git\n\n')).resolves.toMatchObject({ stdout: expect.stringContaining('password=host-secret') });
            const other = await fill('protocol=https\nhost=gitlab.com\npath=octo/demo.git\n\n');
            expect(other.stdout).not.toContain('secret');

            // a second install replaces the file
            const next = credentialsFileContent([{
                key: 'https://github.com/octo/demo', 
                username: 'x-access-token', 
                password: 'fresh-secret', 
            }]);
            await run(['sh', '-c', INSTALL_CREDENTIALS_SCRIPT, 'sh', CREDENTIAL_HELPER_SCRIPT, String(Buffer.byteLength(next))], next, realGit);
            await expect(fill('protocol=https\nhost=github.com\npath=octo/demo.git\n\n')).resolves.toMatchObject({ stdout: expect.stringContaining('password=fresh-secret') });
        } finally {
            await rm(home, { recursive: true, force: true });
        }
    });
});
