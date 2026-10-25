/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { SandboxError, ValidationError } from '@chamvi/core';
import {
    assertDeployment,
    createSettledCheck,
    readWorkspaceInfo,
    repoKey,
    workspaceLabels,
    workspaceMetadata,
} from '@chamvi/sandbox';
import type { WorkspaceInfo } from '@chamvi/sandbox';

const repo = 'https://github.com/octo/demo.git';

describe('assertDeployment', () => {
    it('defaults to "default"', () => {
        expect(assertDeployment(undefined)).toBe('default');
    });

    it.each(['default', 'prod', 'ci-2', 'a.b_c', 'A1', 'x'.repeat(63)])('accepts %s', (value) => {
        expect(assertDeployment(value)).toBe(value);
    });

    it.each(['', '-a', 'a-', 'a b', 'x'.repeat(64), 'ä', 42, null])('refuses %j', (value) => {
        expect(() => assertDeployment(value)).toThrow(ValidationError);
    });
});

describe('repoKey', () => {
    it('is 32 hex characters, stable per repository', () => {
        expect(repoKey(repo)).toMatch(/^[0-9a-f]{32}$/);
        expect(repoKey(repo)).toBe(repoKey(repo));
        expect(repoKey(repo)).not.toBe(repoKey('https://github.com/octo/other.git'));
    });
});

describe('workspaceLabels', () => {
    it('names the run, the workspace and the deployment, and the repo key with a repo', () => {
        expect(workspaceLabels({ id: 'w', runId: 'r', deployment: 'prod' })).toEqual({
            'app.kubernetes.io/managed-by': 'chamvi',
            'app.kubernetes.io/component': 'sandbox',
            'chamvi.dev/run': 'r',
            'chamvi.dev/workspace': 'w',
            'chamvi.dev/deployment': 'prod',
        });
        expect(workspaceLabels({
            id: 'w',
            runId: 'r',
            deployment: 'prod',
            repo,
        })['chamvi.dev/repo-key']).toBe(repoKey(repo));
    });
});

describe('workspaceMetadata and readWorkspaceInfo', () => {
    const info: WorkspaceInfo = {
        runId: 'r',
        provider: 'docker',
        repo,
        ref: 'main',
        image: 'node:24',
        createdAt: new Date(1_000),
        expiresAt: new Date(9_000),
    };

    it('round-trips the info through labels and metadata', () => {
        const values = {
            ...workspaceLabels({ id: 'w', runId: 'r', deployment: 'default', repo }),
            ...workspaceMetadata(info),
        };
        expect(workspaceMetadata(info)).toEqual({
            'chamvi.dev/created-at': '1000',
            'chamvi.dev/expires-at': '9000',
            'chamvi.dev/repo': repo,
            'chamvi.dev/ref': 'main',
            'chamvi.dev/image': 'node:24',
        });
        expect(readWorkspaceInfo(values, 'docker')).toEqual(info);
    });

    it('leaves out what a repo-less workspace has not', () => {
        const bare: WorkspaceInfo = {
            runId: 'r',
            provider: 'k8s',
            createdAt: new Date(1_000),
            expiresAt: new Date(9_000),
        };
        const values = {
            ...workspaceLabels({ id: 'w', runId: 'r', deployment: 'default' }),
            ...workspaceMetadata(bare),
        };
        expect(Object.keys(workspaceMetadata(bare)).sort()).toEqual(['chamvi.dev/created-at', 'chamvi.dev/expires-at']);
        expect(readWorkspaceInfo(values, 'k8s')).toEqual(bare);
    });

    it.each([
        ['chamvi.dev/run', undefined],
        ['chamvi.dev/created-at', 'soon'],
        ['chamvi.dev/expires-at', undefined],
        ['chamvi.dev/repo', 'ext::sh -c id'],
    ])('is undefined when %s is %j', (key, value) => {
        const values: Record<string, string | undefined> = {
            ...workspaceLabels({ id: 'w', runId: 'r', deployment: 'default', repo }),
            ...workspaceMetadata(info),
            [key]: value,
        };
        expect(readWorkspaceInfo(values, 'docker')).toBeUndefined();
    });
});

describe('createSettledCheck', () => {
    it('asks once per run and answers false without isSettled', async () => {
        const asked: string[] = [];
        const check = createSettledCheck(async (runId) => {
            asked.push(runId);
            return runId === 'done';
        });
        expect(await check('done')).toBe(true);
        expect(await check('done')).toBe(true);
        expect(await check('live')).toBe(false);
        expect(asked).toEqual(['done', 'live']);
        expect(await createSettledCheck(undefined)('done')).toBe(false);
    });

    it('turns a rejection into a SandboxError naming the run', async () => {
        const answer = await createSettledCheck(async () => { throw new Error('store down'); })('r1');
        expect(answer).toBeInstanceOf(SandboxError);
        expect((answer as Error).message).toBe('cannot tell whether run r1 settled: store down');
    });
});
