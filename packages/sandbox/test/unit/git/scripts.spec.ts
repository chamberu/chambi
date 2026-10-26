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
import {
    CREDENTIAL_HELPER_SCRIPT,
    GIT_AUTH_REFUSED_EXIT,
    GIT_AUTH_SCRIPT,
    INSTALL_CREDENTIALS_SCRIPT,
} from '../../../src/git/constants.ts';
import { credentialsFileContent } from '../../../src/git/helpers.ts';

/**
 * A fake git that, like git's http transport, asks the last configured
 * credential helper for `protocol`, `host` and `path` (its last three
 * arguments) and prints the answer. Its config is empty.
 */
const FAKE_GIT = `#!/bin/sh
for a; do test "$a" = config && exit 1; done
helper=
while [ $# -gt 3 ]; do
  case $1 in
    -c) case $2 in credential.helper=*) helper=\${2#credential.helper=};; esac; shift 2;;
    *) shift;;
  esac
done
printf 'protocol=%s\\nhost=%s\\npath=%s\\n\\n' "$1" "$2" "$3" | sh -c "\${helper#!} get"
`;

const REPO_URL = 'https://github.com/octo/demo.git';

let dir: string;
let env: Record<string, string>;

function run(
    argv: string[],
    stdin: string,
    extra: Record<string, string> = {},
    cwd?: string,
): Promise<{
    stdout: string; 
    stderr: string; 
    code: number 
}> {
    return new Promise((resolve) => {
        const child = execFile(argv[0]!, argv.slice(1), { env: { ...env, ...extra }, ...(cwd !== undefined && { cwd }) }, (error, stdout, stderr) => {
            resolve({
                stdout,
                stderr,
                code: error ? Number((error as { code?: number }).code ?? 1) : 0,
            });
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
        ['sh', '-c', GIT_AUTH_SCRIPT, 'sh', REPO_URL, 'https://github.com', 'octo/demo', 'fetch', protocol, host, path],
        'x-access-token\nghs_secret\n',
    );

    it('answers the credential for the expected origin and path', async () => {
        await expect(auth('https', 'github.com', 'octo/demo.git')).resolves.toMatchObject({
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
        await writeFile(join(envGit, 'git'), '#!/bin/sh\nfor a; do test "$a" = config && exit 1; done\nenv\n');
        await chmod(join(envGit, 'git'), 0o755);
        const { stdout, code } = await run(
            ['sh', '-c', GIT_AUTH_SCRIPT, 'sh', REPO_URL, 'https://github.com', 'octo/demo', 'status'],
            'x-access-token\nghs_secret\n',
            { PATH: `${envGit}:${process.env.PATH}` },
        );
        expect(code).toBe(0);
        expect(stdout).toContain('CHAMVI_GIT_ORIGIN=https://github.com');
        expect(stdout).not.toContain('ghs_secret');
    });
});

describe('GIT_AUTH_SCRIPT against the git config', () => {
    const realGit = { PATH: process.env.PATH ?? '' };

    async function repository(config: Array<[string, string]>): Promise<string> {
        const repo = await mkdtemp(join(tmpdir(), 'chamvi-git-auth-'));
        await run(['git', 'init', '-q', repo], '', realGit);
        for (const [key, value] of config) {
            await run(['git', 'config', key, value], '', realGit, repo);
        }
        return repo;
    }

    /** `git status` through the script: it only runs once the config checks passed. */
    async function status(repo: string, home = dir) {
        return run(
            ['sh', '-c', GIT_AUTH_SCRIPT, 'sh', REPO_URL, 'https://github.com', 'octo/demo', 'status', '--short'],
            'x-access-token\nghs_secret\n',
            { ...realGit, HOME: home },
            repo,
        );
    }

    it('runs git when the config sends nothing elsewhere', async () => {
        const repo = await repository([
            [`http.${REPO_URL}.postBuffer`, '524288000'],
            ['http.proxy', 'http://127.0.0.1:9'],
            ['http.sslVerify', 'false'],
        ]);
        try {
            await expect(status(repo)).resolves.toMatchObject({ code: 0 });
        } finally {
            await rm(repo, { recursive: true, force: true });
        }
    });

    it('never runs a transport the config names for the URL, so nothing reads the credential on fd 3', async () => {
        const bin = await mkdtemp(join(tmpdir(), 'chamvi-git-vcs-'));
        const leak = join(bin, 'leak');
        await writeFile(join(bin, 'git-remote-evil'), `#!/bin/sh\ncat <&3 > '${leak}'\nexit 1\n`);
        await chmod(join(bin, 'git-remote-evil'), 0o755);
        const repo = await repository([
            [`remote.${REPO_URL}.url`, REPO_URL],
            [`remote.${REPO_URL}.vcs`, 'evil'],
            ['protocol.evil.allow', 'always'],
        ]);
        try {
            for (const args of [
                ['fetch', REPO_URL, 'refs/heads/main'],
                ['push', '--porcelain', REPO_URL, 'HEAD:refs/heads/main'],
            ]) {
                const result = await run(
                    ['sh', '-c', GIT_AUTH_SCRIPT, 'sh', REPO_URL, 'https://github.com', 'octo/demo', ...args],
                    'x-access-token\nghs_secret\n',
                    {
                        ...realGit,
                        PATH: `${bin}:${realGit.PATH}`,
                        HOME: dir,
                        LC_ALL: 'C',
                    },
                    repo,
                );
                expect(result.code, args[0]).not.toBe(0);
                expect(result.stderr, args[0]).toContain('not allowed');
                await expect(readFile(leak, 'utf8'), args[0]).rejects.toThrow();
            }
        } finally {
            await rm(repo, { recursive: true, force: true });
            await rm(bin, { recursive: true, force: true });
        }
    });

    it('refuses to send the credential through a proxy, an unverified or redirected connection the config sets for the URL', async () => {
        for (const [key, value, named] of [
            ['http.https://github.com.proxy', 'http://attacker:3128', 'http.proxy'],
            [`http.${REPO_URL}.proxy`, 'http://attacker:3128', 'http.proxy'],
            ['http.https://github.com.sslVerify', 'false', 'http.sslVerify'],
            ['http.https://github.com/octo.sslVerify', 'no', 'http.sslVerify'],
            ['http.https://github.com.sslCAInfo', '/tmp/attacker.pem', 'http.sslCAInfo'],
            ['http.https://github.com.sslCAPath', '/tmp', 'http.sslCAPath'],
            ['http.https://github.com.curloptResolve', 'github.com:443:10.0.0.1', 'http.curloptResolve'],
            [`remote.${REPO_URL}.proxy`, 'http://attacker:3128', `remote.${REPO_URL}.proxy`],
            ['remote.origin.proxy', 'http://attacker:3128', 'remote.origin.proxy'],
            ['url.https://github.com/octo/demo.insteadOf', REPO_URL, 'url.https://github.com/octo/demo.insteadof'],
            ['url.https://github.com/octo/demo.pushInsteadOf', REPO_URL, 'url.https://github.com/octo/demo.pushinsteadof'],
        ] as const) {
            const repo = await repository([[key, value]]);
            try {
                const result = await status(repo);
                expect(result.code, key).toBe(GIT_AUTH_REFUSED_EXIT);
                expect(result.stderr, key).toContain(named);
                expect(result.stderr, key).not.toContain('ghs_secret');
            } finally {
                await rm(repo, { recursive: true, force: true });
            }
        }
    });

    it('reads the global config too', async () => {
        const home = await mkdtemp(join(tmpdir(), 'chamvi-git-home-'));
        const repo = await repository([]);
        try {
            await writeFile(join(home, '.gitconfig'), '[http "https://github.com"]\n\tproxy = http://attacker:3128\n');
            await expect(status(repo, home)).resolves.toMatchObject({ code: GIT_AUTH_REFUSED_EXIT });
        } finally {
            await rm(repo, { recursive: true, force: true });
            await rm(home, { recursive: true, force: true });
        }
    });
});

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
