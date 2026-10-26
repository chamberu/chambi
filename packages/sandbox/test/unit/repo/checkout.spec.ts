/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { SandboxError, ValidationError } from '@chamvi/core';
import type { IClock } from '@chamvi/core';
import { EXEC_TIMEOUT_MS, prepareWorkspace, readCheckout } from '@chamvi/sandbox';
import { CHECKOUT_READ_ATTEMPTS } from '../../../src/repo/constants.ts';
import { createScriptedWorkspace } from '../../utils/workspace.ts';

const url = 'https://github.com/octo/demo.git';
const sha = '0123456789abcdef0123456789abcdef01234567';

/** Fires every timer at once, so the retry waits take no time. */
const immediateClock: IClock = {
    now: () => new Date(0),
    setTimeout: (fn) => {
        queueMicrotask(fn);
        return { clear: () => {} };
    },
};

const head = `ref: refs/heads/main\tHEAD\n${sha}\tHEAD\n`;
const NO_CREDENTIAL = ['git', '-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null'];

/** A remote whose default branch is main and whose branches are `branches`. */
function remote(branches: string[] = ['main']) {
    return createScriptedWorkspace((argv) => {
        if (argv.includes('ls-remote')) return { stdout: head };
        if (argv[1] === 'rev-parse' && argv[2] === '-q') return { exitCode: branches.includes(argv[4]!.replace('refs/remotes/origin/', '')) ? 0 : 1 };
        if (argv[1] === 'rev-parse') return { stdout: `${sha}\n` };
        return {};
    });
}

describe('prepareWorkspace', () => {
    it('checks out a branch with full history, tracking origin, and reports the default branch', async () => {
        const workspace = remote(['main', 'feature']);
        const result = await prepareWorkspace(workspace, { repo: url, ref: 'feature' });
        expect(workspace.calls.map((call) => call.argv)).toEqual([
            ['git', 'init', '-q', '.'],
            ['git', 'remote', 'add', 'origin', url],
            [...NO_CREDENTIAL, 'ls-remote', '--symref', url, 'HEAD'],
            [...NO_CREDENTIAL, 'fetch', '-q', 'origin', 'feature', 'main'],
            ['git', 'rev-parse', '-q', '--verify', 'refs/remotes/origin/feature'],
            ['git', 'checkout', '-q', '-B', 'feature', '--track', 'origin/feature'],
            ['git', 'rev-parse', 'HEAD'],
            ['git', 'config', 'chamvi.defaultBranch', 'main'],
            ['git', 'config', 'chamvi.checkout', sha],
        ]);
        expect(result).toEqual({ commit: sha, defaultBranch: 'main' });
    });

    it('checks out the default branch without a ref', async () => {
        const workspace = remote();
        await prepareWorkspace(workspace, { repo: url });
        const argvs = workspace.calls.map((call) => call.argv);
        expect(argvs[3]).toEqual([...NO_CREDENTIAL, 'fetch', '-q', 'origin', 'main']);
        expect(argvs[5]).toEqual(['git', 'checkout', '-q', '-B', 'main', '--track', 'origin/main']);
    });

    it('detaches at a tag or commit, fetching the default branch too', async () => {
        const workspace = remote();
        const result = await prepareWorkspace(workspace, { repo: url, ref: 'v1' });
        const argvs = workspace.calls.map((call) => call.argv);
        expect(argvs[3]).toEqual([...NO_CREDENTIAL, 'fetch', '-q', 'origin', 'v1', 'main']);
        expect(argvs[5]).toEqual(['git', '-c', 'advice.detachedHead=false', 'checkout', '-q', 'FETCH_HEAD']);
        expect(result.defaultBranch).toBe('main');
    });

    it('fetches shallow with depth', async () => {
        const workspace = remote();
        await prepareWorkspace(workspace, { repo: url, depth: 50 });
        expect(workspace.calls[3]?.argv).toEqual([...NO_CREDENTIAL, 'fetch', '-q', '--depth', '50', 'origin', 'main']);
        await expect(prepareWorkspace(remote(), { repo: url, depth: 0 })).rejects.toThrow(ValidationError);
    });

    it('fetches HEAD of a remote without a default branch', async () => {
        const workspace = createScriptedWorkspace((argv) => {
            if (argv[1] !== 'rev-parse') return {};
            return argv[2] === '-q' ? { exitCode: 1 } : { stdout: sha };
        });
        const result = await prepareWorkspace(workspace, { repo: url });
        expect(workspace.calls[3]?.argv).toEqual([...NO_CREDENTIAL, 'fetch', '-q', 'origin', 'HEAD']);
        expect(workspace.calls[4]?.argv).toEqual(['git', '-c', 'advice.detachedHead=false', 'checkout', '-q', 'FETCH_HEAD']);
        expect(result).toEqual({ commit: sha });
    });

    it('authenticates ls-remote and fetch with a credential on stdin only', async () => {
        const workspace = remote();
        await prepareWorkspace(workspace, { repo: url, credential: { username: 'x-access-token', password: 'ghs_secret' } });
        const authenticated = workspace.calls.filter((call) => call.argv[0] === 'sh');
        expect(authenticated.map((call) => call.argv.slice(4, 8))).toEqual([
            [url, 'https://github.com', 'octo/demo', 'ls-remote'],
            [url, 'https://github.com', 'octo/demo', 'fetch'],
        ]);
        for (const call of workspace.calls) {
            expect(call.argv.join(' ')).not.toContain('ghs_secret');
            if (call.argv[0] === 'sh') expect(call.options.stdin).toBe('x-access-token\nghs_secret\n');
            else expect(call.options.stdin).toBeUndefined();
        }
    });

    it('runs every command with the exec timeout and the signal', async () => {
        const controller = new AbortController();
        const workspace = remote();
        await prepareWorkspace(workspace, { repo: url, signal: controller.signal });
        for (const call of workspace.calls) {
            expect(call.options.timeoutMs).toBe(EXEC_TIMEOUT_MS);
            expect(call.options.signal).toBe(controller.signal);
        }
    });

    it('accepts a file repository', async () => {
        const workspace = remote();
        await expect(prepareWorkspace(workspace, { repo: 'file:///tmp/r' })).resolves.toEqual({ commit: sha, defaultBranch: 'main' });
        expect(workspace.calls[1]?.argv).toEqual(['git', 'remote', 'add', 'origin', 'file:///tmp/r']);
    });

    it('only inits without a repo', async () => {
        const workspace = createScriptedWorkspace();
        const result = await prepareWorkspace(workspace, {});
        expect(workspace.calls.map((call) => call.argv)).toEqual([
            ['git', 'init', '-q', '.'],
            // the end of the checkout is recorded for a repo-less workspace too
            ['git', 'config', 'chamvi.checkout', 'none'],
        ]);
        expect(result.commit).toBeUndefined();
    });

    it('throws SandboxError with git\'s stderr', async () => {
        const workspace = createScriptedWorkspace((argv) => (argv.includes('fetch') ?
            { exitCode: 128, stderr: 'fatal: couldn\'t find remote ref v9\n' } :
            {}));
        const promise = prepareWorkspace(workspace, { repo: url, ref: 'v9' });
        await expect(promise).rejects.toThrow(SandboxError);
        await expect(promise).rejects.toThrow(/git fetch exited with 128: fatal: couldn't find remote ref v9/);
        expect(workspace.calls).toHaveLength(4);
    });

    it('cuts git\'s stderr to 2000 characters', async () => {
        const workspace = createScriptedWorkspace(() => ({ exitCode: 1, stderr: 'x'.repeat(5_000) }));
        let error: unknown;
        try {
            await prepareWorkspace(workspace, {});
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(SandboxError);
        const { message } = error as Error;
        expect(message).toContain('x'.repeat(2_000));
        expect(message).not.toContain('x'.repeat(2_001));
    });

    it('fails on a timed out step', async () => {
        const workspace = createScriptedWorkspace(() => ({ exitCode: 124, timedOut: true }));
        await expect(prepareWorkspace(workspace, {})).rejects.toThrow(SandboxError);
    });

    it('fails when rev-parse prints no commit', async () => {
        const workspace = createScriptedWorkspace((argv) => (argv[1] === 'rev-parse' && argv[2] === '-q' ? { exitCode: 1 } : { stdout: 'not a sha\n' }));
        await expect(prepareWorkspace(workspace, { repo: url })).rejects.toThrow(/printed no commit/);
    });

    it('ignores a default branch git would refuse and checks out the remote HEAD detached', async () => {
        const workspace = createScriptedWorkspace((argv) => {
            if (argv.includes('ls-remote')) return { stdout: `ref: refs/heads/--upload-pack=x\tHEAD\n${sha}\tHEAD\n` };
            if (argv[1] === 'rev-parse' && argv[2] === 'HEAD') return { stdout: `${sha}\n` };
            return {};
        });
        await expect(prepareWorkspace(workspace, { repo: url })).resolves.toEqual({ commit: sha });
        const argvs = workspace.calls.map((call) => call.argv);
        expect(argvs[3]).toEqual([...NO_CREDENTIAL, 'fetch', '-q', 'origin', 'HEAD']);
        expect(argvs[4]).toEqual(['git', '-c', 'advice.detachedHead=false', 'checkout', '-q', 'FETCH_HEAD']);
    });

    it('validates before running', async () => {
        const workspace = createScriptedWorkspace();
        await expect(prepareWorkspace(workspace, { repo: url, ref: '--x' })).rejects.toThrow(ValidationError);
        await expect(prepareWorkspace(workspace, { ref: 'v1' })).rejects.toThrow(ValidationError);
        await expect(prepareWorkspace(workspace, { repo: '--upload-pack=x' })).rejects.toThrow(ValidationError);
        await expect(prepareWorkspace(workspace, { repo: 'ext::sh -c id' })).rejects.toThrow(ValidationError);
        await expect(prepareWorkspace(workspace, { repo: 'https://user:token@github.com/o/r' })).rejects.toThrow(ValidationError);
        await expect(prepareWorkspace(workspace, { repo: 'https://github.com/o/r?x=1' })).rejects.toThrow(ValidationError);
        expect(workspace.calls).toHaveLength(0);
    });
});

describe('readCheckout', () => {
    const answering = (stdout: string, repo?: string) => {
        const workspace = createScriptedWorkspace((argv) => (argv[1] === 'config' ? { stdout } : {}));
        if (repo !== undefined) workspace.info.repo = repo;
        return workspace;
    };

    it('reads the commit and the default branch a finished checkout recorded', async () => {
        const workspace = answering(`chamvi.checkout ${sha}\nchamvi.defaultbranch main\n`, url);
        await expect(readCheckout(workspace)).resolves.toEqual({ commit: sha, defaultBranch: 'main' });
        expect(workspace.calls[0]?.argv).toEqual(['git', 'config', '--get-regexp', '^chamvi\\.']);
    });

    it('reads a finished repo-less checkout', async () => {
        await expect(readCheckout(answering('chamvi.checkout none\n'))).resolves.toEqual({});
    });

    it('keeps only a valid default branch', async () => {
        await expect(readCheckout(answering(`chamvi.checkout ${sha}\nchamvi.defaultbranch ..\n`, url))).resolves.toEqual({ commit: sha });
        await expect(readCheckout(answering(`chamvi.checkout ${sha}\n`, url))).resolves.toEqual({ commit: sha });
    });

    it('is undefined for a checkout that never finished (a create that died during the fetch)', async () => {
        // nothing recorded: git config exits 1
        await expect(readCheckout(createScriptedWorkspace(() => ({ exitCode: 1 })))).resolves.toBeUndefined();
        const halfRepo = createScriptedWorkspace(() => ({ exitCode: 1 }));
        halfRepo.info.repo = url;
        await expect(readCheckout(halfRepo)).resolves.toBeUndefined();
        // the default branch is recorded before the checkout record
        await expect(readCheckout(answering('chamvi.defaultbranch main\n', url))).resolves.toBeUndefined();
    });

    it('is undefined when the record does not fit the workspace, and for a failed exec', async () => {
        await expect(readCheckout(answering('chamvi.checkout none\n', url))).resolves.toBeUndefined();
        await expect(readCheckout(answering(`chamvi.checkout ${sha}\n`))).resolves.toBeUndefined();
        await expect(readCheckout(answering('chamvi.checkout nope\n', url))).resolves.toBeUndefined();
        const broken = createScriptedWorkspace();
        broken.exec = async () => { throw new SandboxError('workspace disposed'); };
        await expect(readCheckout(broken, undefined, immediateClock)).resolves.toBeUndefined();
    });

    it('reads a missing record once, without retrying', async () => {
        const workspace = createScriptedWorkspace(() => ({ exitCode: 1 }), { repo: url });
        await expect(readCheckout(workspace, undefined, immediateClock)).resolves.toBeUndefined();
        expect(workspace.calls).toHaveLength(1);
    });

    it('retries a read that failed, e.g. right after a container restart', async () => {
        let failures = 2;
        const workspace = createScriptedWorkspace(() => ({ stdout: `chamvi.checkout ${sha}\n` }), { repo: url });
        const exec = workspace.exec.bind(workspace);
        workspace.exec = async (argv, options) => {
            if (failures-- > 0) throw new SandboxError('exec failed: container is not running');
            return exec(argv, options);
        };
        await expect(readCheckout(workspace, undefined, immediateClock)).resolves.toEqual({ commit: sha });
        expect(workspace.calls).toHaveLength(1);
    });

    it('retries an unexpected exit code, then gives up after CHECKOUT_READ_ATTEMPTS', async () => {
        const workspace = createScriptedWorkspace(() => ({ exitCode: 126 }), { repo: url });
        await expect(readCheckout(workspace, undefined, immediateClock)).resolves.toBeUndefined();
        expect(workspace.calls).toHaveLength(CHECKOUT_READ_ATTEMPTS);
    });
});
