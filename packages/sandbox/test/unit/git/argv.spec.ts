/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { EXEC_TIMEOUT_MS } from '@chamvi/sandbox';
import { GIT_AUTH_SCRIPT } from '../../../src/git/constants.ts';
import { credentialKey, credentialsFileContent } from '../../../src/git/helpers.ts';
import { gitArgv, runGit } from '../../../src/git/module.ts';
import { createScriptedWorkspace } from '../../utils/workspace.ts';

const url = 'https://github.com/octo/demo.git';

describe('gitArgv', () => {
    it('resets every credential helper and disables hooks without a credential', () => {
        expect(gitArgv(url, ['fetch', '-q', url, 'main'])).toEqual({ argv: ['git', '-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null', 'fetch', '-q', url, 'main'] });
    });

    it('hands a credential over stdin to the one-shot helper, never in argv', () => {
        const { argv, stdin } = gitArgv(url, ['push', url, 'HEAD:refs/heads/x'], { username: 'x-access-token', password: 'ghs_secret' });
        expect(argv).toEqual(['sh', '-c', GIT_AUTH_SCRIPT, 'sh', 'https://github.com', 'octo/demo', 'push', url, 'HEAD:refs/heads/x']);
        expect(stdin).toBe('x-access-token\nghs_secret\n');
        expect(argv.join(' ')).not.toContain('ghs_secret');
    });
});

describe('runGit', () => {
    it('runs the argv with stdin, the timeout and the signal', async () => {
        const workspace = createScriptedWorkspace();
        const controller = new AbortController();
        await runGit(workspace, {
            url,
            args: ['ls-remote', url],
            credential: { username: 'u', password: 'secret-1' },
            signal: controller.signal,
        });
        expect(workspace.calls[0]?.argv[0]).toBe('sh');
        expect(workspace.calls[0]?.options).toEqual({
            stdin: 'u\nsecret-1\n', 
            timeoutMs: EXEC_TIMEOUT_MS, 
            signal: controller.signal, 
        });
    });
});

describe('credentialKey', () => {
    it('keys a repository by origin and path without .git, the host by its origin', () => {
        expect(credentialKey('https://github.com/octo/demo.git')).toBe('https://github.com/octo/demo');
        expect(credentialKey('https://git.example.com:8443/a/b/')).toBe('https://git.example.com:8443/a/b');
        expect(credentialKey('https://github.com/')).toBe('https://github.com/');
    });

    it('writes one tab separated line per entry', () => {
        expect(credentialsFileContent([
            {
                key: 'https://github.com/octo/demo', 
                username: 'x-access-token', 
                password: 'p1', 
            },
            {
                key: 'https://github.com/', 
                username: 'u', 
                password: 'p2', 
            },
        ])).toBe('https://github.com/octo/demo\tx-access-token\tp1\nhttps://github.com/\tu\tp2\n');
    });
});
