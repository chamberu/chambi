/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { SandboxError, ValidationError } from '@chamvi/core';
import { EXEC_TIMEOUT_MS, prepareWorkspace, readCheckout } from '@chamvi/sandbox';
import { createScriptedWorkspace } from '../../utils/workspace.ts';

const url = 'https://github.com/octo/demo.git';
const sha = '0123456789abcdef0123456789abcdef01234567';

describe('prepareWorkspace', () => {
    it('checks out a ref', async () => {
        const workspace = createScriptedWorkspace((argv) => (argv[1] === 'rev-parse' ? { stdout: `${sha}\n` } : {}));
        const result = await prepareWorkspace(workspace, { repo: url, ref: 'v1' });
        expect(workspace.calls.map((call) => call.argv)).toEqual([
            ['git', 'init', '-q', '.'],
            ['git', 'remote', 'add', 'origin', url],
            ['git', '-c', 'credential.helper=', 'fetch', '-q', '--depth', '1', 'origin', 'v1'],
            ['git', '-c', 'advice.detachedHead=false', 'checkout', '-q', 'FETCH_HEAD'],
            ['git', 'rev-parse', 'HEAD'],
            ['git', 'config', 'chamvi.checkout', sha],
        ]);
        expect(result).toEqual({ commit: sha });
    });

    it('fetches HEAD without a ref', async () => {
        const workspace = createScriptedWorkspace((argv) => (argv[1] === 'rev-parse' ? { stdout: `${sha}\n` } : {}));
        await prepareWorkspace(workspace, { repo: url });
        expect(workspace.calls[2]?.argv).toEqual(['git', '-c', 'credential.helper=', 'fetch', '-q', '--depth', '1', 'origin', 'HEAD']);
    });

    it('runs every command with the exec timeout and the signal', async () => {
        const controller = new AbortController();
        const workspace = createScriptedWorkspace((argv) => (argv[1] === 'rev-parse' ? { stdout: sha } : {}));
        await prepareWorkspace(workspace, { repo: url, signal: controller.signal });
        for (const call of workspace.calls) {
            expect(call.options.timeoutMs).toBe(EXEC_TIMEOUT_MS);
            expect(call.options.signal).toBe(controller.signal);
        }
    });

    it('accepts a file repository', async () => {
        const workspace = createScriptedWorkspace((argv) => (argv[1] === 'rev-parse' ? { stdout: sha } : {}));
        await expect(prepareWorkspace(workspace, { repo: 'file:///tmp/r' })).resolves.toEqual({ commit: sha });
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
        await expect(promise).rejects.toThrow(/couldn't find remote ref v9/);
        expect(workspace.calls).toHaveLength(3);
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
        const workspace = createScriptedWorkspace(() => ({ stdout: 'not a sha\n' }));
        await expect(prepareWorkspace(workspace, { repo: url })).rejects.toThrow(SandboxError);
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
    const answering = (value: string, repo?: string) => {
        const workspace = createScriptedWorkspace((argv) => (argv[1] === 'config' ? { stdout: `${value}\n` } : {}));
        if (repo !== undefined) workspace.info.repo = repo;
        return workspace;
    };

    it('reads the commit a finished checkout recorded', async () => {
        const workspace = answering(sha, url);
        await expect(readCheckout(workspace)).resolves.toEqual({ commit: sha });
        expect(workspace.calls[0]?.argv).toEqual(['git', 'config', '--get', 'chamvi.checkout']);
    });

    it('reads a finished repo-less checkout', async () => {
        await expect(readCheckout(answering('none'))).resolves.toEqual({});
    });

    it('is undefined for a checkout that never finished (a create that died during the fetch)', async () => {
        // nothing recorded: git config exits 1
        await expect(readCheckout(createScriptedWorkspace(() => ({ exitCode: 1 })))).resolves.toBeUndefined();
        const halfRepo = createScriptedWorkspace(() => ({ exitCode: 1 }));
        halfRepo.info.repo = url;
        await expect(readCheckout(halfRepo)).resolves.toBeUndefined();
    });

    it('is undefined when the record does not fit the workspace, and for a failed exec', async () => {
        await expect(readCheckout(answering('none', url))).resolves.toBeUndefined();
        await expect(readCheckout(answering(sha))).resolves.toBeUndefined();
        await expect(readCheckout(answering('nope', url))).resolves.toBeUndefined();
        const broken = createScriptedWorkspace();
        broken.exec = async () => { throw new SandboxError('workspace disposed'); };
        await expect(readCheckout(broken)).resolves.toBeUndefined();
    });
});
