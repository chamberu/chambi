/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { execFile } from 'node:child_process';
import {
    chmod,
    mkdir,
    mkdtemp,
    readFile,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest';
import { CREDENTIAL_HELPER_SCRIPT, GIT_AUTH_SCRIPT, INSTALL_CREDENTIALS_SCRIPT } from '../../../src/git/constants.ts';
import { credentialsFileContent } from '../../../src/git/helpers.ts';

/**
 * A fake git that, like git's http transport, asks the last configured
 * credential helper for `protocol`, `host` and `path` (its last three
 * arguments) and prints the answer.
 */
const FAKE_GIT = `#!/bin/sh
helper=
while [ $# -gt 3 ]; do
  case $1 in
    -c) case $2 in credential.helper=*) helper=\${2#credential.helper=};; esac; shift 2;;
    *) shift;;
  esac
done
printf 'protocol=%s\\nhost=%s\\npath=%s\\n\\n' "$1" "$2" "$3" | sh -c "\${helper#!} get"
`;

let dir: string;
let env: Record<string, string>;

function run(argv: string[], stdin: string, extra: Record<string, string> = {}): Promise<{ stdout: string; code: number }> {
    return new Promise((resolve) => {
        const child = execFile(argv[0]!, argv.slice(1), { env: { ...env, ...extra } }, (error, stdout) => {
            resolve({ stdout, code: error ? Number((error as { code?: number }).code ?? 1) : 0 });
        });
        child.stdin!.end(stdin);
    });
}

beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'chamvi-git-scripts-'));
    await writeFile(join(dir, 'git'), FAKE_GIT);
    await chmod(join(dir, 'git'), 0o755);
    env = { PATH: `${dir}:${process.env.PATH}`, HOME: dir };
});

afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe('GIT_AUTH_SCRIPT', () => {
    const auth = (protocol: string, host: string, path: string) => run(
        ['sh', '-c', GIT_AUTH_SCRIPT, 'sh', 'https://github.com', 'octo/demo', 'fetch', protocol, host, path],
        'x-access-token\nghs_secret\n',
    );

    it('answers the credential for the expected origin and path', async () => {
        await expect(auth('https', 'github.com', 'octo/demo.git')).resolves.toEqual({
            stdout: 'username=x-access-token\npassword=ghs_secret\n',
            code: 0,
        });
        await expect(auth('https', 'github.com', 'octo/demo/')).resolves.toMatchObject({ stdout: expect.stringContaining('ghs_secret') });
    });

    it('answers nothing for another host, path or protocol', async () => {
        for (const [protocol, host, path] of [
            ['https', 'evil.example.com', 'octo/demo.git'],
            ['https', 'github.com', 'octo/other.git'],
            ['http', 'github.com', 'octo/demo.git'],
        ] as const) {
            const { stdout } = await auth(protocol, host, path);
            expect(stdout).toBe('');
        }
    });

    it('keeps the credential out of the environment of git', async () => {
        const envGit = join(dir, 'env-git');
        await mkdir(envGit);
        await writeFile(join(envGit, 'git'), '#!/bin/sh\nenv\n');
        await chmod(join(envGit, 'git'), 0o755);
        const { stdout, code } = await run(
            ['sh', '-c', GIT_AUTH_SCRIPT, 'sh', 'https://github.com', 'octo/demo', 'status'],
            'x-access-token\nghs_secret\n',
            { PATH: `${envGit}:${process.env.PATH}` },
        );
        expect(code).toBe(0);
        expect(stdout).toContain('CHAMVI_GIT_ORIGIN=https://github.com');
        expect(stdout).not.toContain('ghs_secret');
    });
});

describe('the workspace credential helper', () => {
    it('installs the file (0600) and the helper, and answers through real git', async () => {
        const home = await mkdtemp(join(tmpdir(), 'chamvi-git-home-'));
        try {
            const content = credentialsFileContent([
                { key: 'https://github.com/octo/demo', username: 'x-access-token', password: 'repo-secret' },
                { key: 'https://github.com/', username: 'oauth2', password: 'host-secret' },
            ]);
            const realGit = { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' };
            const install = await run(['sh', '-c', INSTALL_CREDENTIALS_SCRIPT, 'sh', CREDENTIAL_HELPER_SCRIPT, String(Buffer.byteLength(content))], content, realGit);
            expect(install.code).toBe(0);
            expect(await readFile(join(home, '.chamvi/credentials'), 'utf8')).toBe(content);
            expect((await stat(join(home, '.chamvi/credentials'))).mode & 0o777).toBe(0o600);

            const fill = (request: string) => run(['git', 'credential', 'fill'], request, { ...realGit, GIT_TERMINAL_PROMPT: '0' });
            await expect(fill('protocol=https\nhost=github.com\npath=octo/demo.git\n\n')).resolves.toMatchObject({
                stdout: expect.stringContaining('password=repo-secret'),
            });
            await expect(fill('protocol=https\nhost=github.com\npath=other/repo.git\n\n')).resolves.toMatchObject({
                stdout: expect.stringContaining('password=host-secret'),
            });
            const other = await fill('protocol=https\nhost=gitlab.com\npath=octo/demo.git\n\n');
            expect(other.stdout).not.toContain('secret');

            // a second install replaces the file
            const next = credentialsFileContent([{ key: 'https://github.com/octo/demo', username: 'x-access-token', password: 'fresh-secret' }]);
            await run(['sh', '-c', INSTALL_CREDENTIALS_SCRIPT, 'sh', CREDENTIAL_HELPER_SCRIPT, String(Buffer.byteLength(next))], next, realGit);
            await expect(fill('protocol=https\nhost=github.com\npath=octo/demo.git\n\n')).resolves.toMatchObject({
                stdout: expect.stringContaining('password=fresh-secret'),
            });
        } finally {
            await rm(home, { recursive: true, force: true });
        }
    });
});
