/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError, SandboxError, ValidationError } from '@chamvi/core';
import { DEFAULT_SANDBOX_IMAGE } from '@chamvi/sandbox';
import { POLL_MS, START_TIMEOUT_MS, createKubernetesSandbox } from '@chamvi/sandbox-k8s';
import type { KubernetesSandboxOptions } from '@chamvi/sandbox-k8s';
import { ControllableClock } from '@chamvi/test-kit';
import {
    createFakePodClient,
    unwrap,
    wrapped,
} from '../../utils/client.ts';
import type { FakeExecHandler } from '../../utils/client.ts';
import { drive, flush } from '../../utils/drive.ts';

const START = 1_000_000;
const COMMIT = 'a'.repeat(40);
const REPO = 'https://github.com/octo/demo.git';

const pending = { phase: 'Pending' };

/** The image probe a create runs first, straight on the pod (no timeout wrapper). */
const PROBE = ['sh', '-c', expect.stringContaining('command -v git')];

/** HEAD for `rev-parse HEAD`; no remote branch of that name for `rev-parse -q --verify` (a tag). */
const answerRevParse: FakeExecHandler = (argv) => {
    const command = unwrap(argv);
    if (command[1] !== 'rev-parse') return {};
    return command[2] === '-q' ? { exitCode: 1 } : { stdout: `${COMMIT}\n` };
};

const NO_CREDENTIAL = ['git', '-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null'];

function setup(onExec: FakeExecHandler = answerRevParse, options: Partial<KubernetesSandboxOptions> = {}) {
    const clock = new ControllableClock(new Date(START));
    const client = createFakePodClient(onExec);
    const provider = createKubernetesSandbox({
        namespace: 'agents',
        image: 'img',
        client,
        clock,
        ...options,
    });
    return {
        clock,
        client,
        provider,
    };
}

describe('kubernetes sandbox', () => {
    it('waits for Running, then checks out', async () => {
        const {
            client,
            clock,
            provider,
        } = setup();
        client.statuses = [pending, pending, { phase: 'Running' }];

        const creating = provider.create({
            runId: 'r1',
            repo: REPO,
            ref: 'v1',
        });
        let done = false;
        creating.then(() => { done = true; }, () => { done = true; });

        await flush();
        expect(client.reads).toBe(1);
        expect(client.execs).toHaveLength(0);
        clock.advance(POLL_MS);
        await flush();
        expect(client.reads).toBe(2);
        expect(done).toBe(false);
        clock.advance(POLL_MS);

        const workspace = await creating;
        expect(client.reads).toBe(3);
        expect(client.created).toHaveLength(1);
        const name = `chamvi-ws-${workspace.id}`;
        expect(client.created[0]!.metadata?.name).toBe(name);
        expect(client.created[0]!.metadata?.labels?.['chamvi.dev/run']).toBe('r1');
        expect(client.execs.map((call) => call.name)).toEqual(Array(9).fill(name));
        expect(client.execs.map((call) => call.argv)).toEqual([
            PROBE,
            wrapped(['git', 'init', '-q', '.']),
            wrapped(['git', 'remote', 'add', 'origin', REPO]),
            wrapped([...NO_CREDENTIAL, 'ls-remote', '--symref', REPO, 'HEAD']),
            wrapped([...NO_CREDENTIAL, 'fetch', '-q', 'origin', 'v1']),
            wrapped(['git', 'rev-parse', '-q', '--verify', 'refs/remotes/origin/v1']),
            wrapped(['git', '-c', 'advice.detachedHead=false', 'checkout', '-q', 'FETCH_HEAD']),
            wrapped(['git', 'rev-parse', 'HEAD']),
            wrapped(['git', 'config', 'chamvi.checkout', COMMIT]),
        ]);
        expect(workspace.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(workspace.info).toEqual({
            runId: 'r1',
            provider: 'k8s',
            repo: REPO,
            ref: 'v1',
            commit: COMMIT,
            image: 'img',
            createdAt: new Date(START),
            expiresAt: new Date(START + 604_800_000),
        });
        expect(client.deleted).toEqual([]);
    });

    it('refuses a runId that is no valid label value before creating a pod', async () => {
        const { client, provider } = setup();
        for (const runId of ['a:b', 'a/b', '-a', 'a'.repeat(64)]) {
            await expect(provider.create({ runId })).rejects.toBeInstanceOf(ValidationError);
        }
        expect(client.created).toHaveLength(0);
    });

    it('runs commands in the pod', async () => {
        const { client, provider } = setup((argv, input) => (
            unwrap(argv)[0] === 'cat' ? { stdout: new TextDecoder().decode(input.stdin), exitCode: 3 } : {}
        ));
        const workspace = await provider.create({ runId: 'r1' });
        expect(client.execs.map((call) => call.argv)).toEqual([
            PROBE,
            wrapped(['git', 'init', '-q', '.']),
            wrapped(['git', 'config', 'chamvi.checkout', 'none']),
        ]);
        expect(workspace.info.commit).toBeUndefined();

        const result = await workspace.exec(['cat'], {
            cwd: 'sub',
            stdin: 'piped ✓',
            timeoutMs: 1500,
        });
        expect(client.execs.at(-1)).toEqual({
            name: `chamvi-ws-${workspace.id}`,
            argv: wrapped(['cat'], '1.5', '/workspace/sub'),
            stdin: 'piped ✓',
        });
        expect(result).toMatchObject({
            exitCode: 3,
            stdout: 'piped ✓',
            stderr: '',
            stdoutTruncated: false,
            timedOut: false,
        });
    });

    it('refuses an image without git before the checkout and deletes the pod', async () => {
        const { client, provider } = setup((argv) => (argv[0] === 'sh' && argv.length === 3 ? { exitCode: 3, stdout: 'git\n' } : {}));
        const error = await provider.create({ runId: 'r1', repo: REPO }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SandboxError);
        expect((error as Error).message).toContain('image img lacks what a workspace needs: git.');
        expect(client.execs).toHaveLength(1);
        expect(client.deleted).toEqual([client.created[0]!.metadata!.name]);
    });

    it('pulls a model-chosen image if not present, the provider\'s own and the operator\'s as configured', async () => {
        const { client, provider } = setup(answerRevParse, { imagePullPolicy: 'Always' });
        await provider.create({ runId: 'r1' });
        await provider.create({
            runId: 'r2', 
            image: 'python:3.13', 
            imageRequested: true, 
        });
        await provider.create({ runId: 'r3', image: 'registry.local/acme/builder:2' });
        await provider.create({
            runId: 'r4', 
            image: 'img', 
            imageRequested: true, 
        });
        expect(client.created.map((pod) => pod.spec?.containers[0]?.imagePullPolicy)).toEqual(['Always', 'IfNotPresent', 'Always', 'Always']);
        expect(client.created[1]!.spec?.containers[0]?.image).toBe('python:3.13');
    });

    it('passes the privilege, cache and tmp options to the pod', async () => {
        const { client, provider } = setup(answerRevParse, {
            user: { uid: 1000, gid: 1000 },
            readOnlyRoot: true,
            cache: { claimName: 'chamvi-cache' },
            tmpSize: '2Gi',
        });
        await provider.create({ runId: 'r1' });
        const { spec } = client.created[0]!;
        expect(spec?.securityContext?.runAsUser).toBe(1000);
        expect(spec?.containers[0]?.securityContext?.readOnlyRootFilesystem).toBe(true);
        expect(spec?.volumes).toContainEqual({ name: 'cache', persistentVolumeClaim: { claimName: 'chamvi-cache' } });
        expect(spec?.volumes).toContainEqual({ name: 'tmp', emptyDir: { medium: 'Memory', sizeLimit: '2Gi' } });
    });

    it.each([
        ['a negative uid', { user: { uid: -1, gid: 0 } }],
        ['a fractional gid', { user: { uid: 0, gid: 1.5 } }],
        ['a user that is no object', { user: '0:0' }],
        ['a readOnlyRoot that is no boolean', { readOnlyRoot: 1 }],
        ['a cache without a claim', { cache: {} }],
        ['an invalid claim name', { cache: { claimName: 'Not_A_Name' } }],
        ['cache false', { cache: false }],
        ['a bad tmpSize', { tmpSize: 'lots' }],
    ])('refuses %s', (_name, options) => {
        expect(() => createKubernetesSandbox({
            namespace: 'agents', 
            client: createFakePodClient(), 
            ...options, 
        } as never))
            .toThrow(InvalidAgentDefinitionError);
    });

    it('fails fast on an image pull error', async () => {
        const { client, provider } = setup();
        client.statuses = [{
            phase: 'Pending',
            containerStatuses: [{
                name: 'sandbox',
                image: 'img',
                imageID: '',
                ready: false,
                restartCount: 0,
                state: { waiting: { reason: 'ErrImagePull', message: 'pull access denied for img' } },
            }],
        }];

        const error = await provider.create({ runId: 'r1' }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SandboxError);
        expect((error as Error).message).toContain('ErrImagePull');
        expect((error as Error).message).toContain('pull access denied');
        expect(client.reads).toBe(1);
        expect(client.deleted).toEqual([client.created[0]!.metadata!.name]);
        expect(client.execs).toHaveLength(0);
    });

    it('times out a pod that never starts', async () => {
        const {
            client,
            clock,
            provider,
        } = setup();
        client.statuses = [pending];

        const creating = provider.create({ runId: 'r1' });
        await flush();
        clock.advance(START_TIMEOUT_MS - 1);
        await flush();
        clock.advance(1);

        await expect(drive(creating, clock, POLL_MS)).rejects.toThrow(/did not start/);
        await expect(creating).rejects.toBeInstanceOf(SandboxError);
        expect(client.deleted).toEqual([client.created[0]!.metadata!.name]);
        expect(client.execs).toHaveLength(0);
    });

    it('fails a pod in phase Failed', async () => {
        const { client, provider } = setup();
        client.statuses = [{
            phase: 'Failed',
            reason: 'Evicted',
            message: 'low on memory',
        }];

        const error = await provider.create({ runId: 'r1' }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SandboxError);
        expect((error as Error).message).toMatch(/Failed/);
        expect((error as Error).message).toContain('Evicted');
        expect(client.deleted).toHaveLength(1);
    });

    it('disposes a failed checkout', async () => {
        const { client, provider } = setup((argv) => (
            unwrap(argv).includes('fetch') ?
                { exitCode: 128, stderr: "fatal: couldn't find remote ref nope\n" } :
                {}
        ));

        const error = await provider.create({
            runId: 'r1',
            repo: REPO,
            ref: 'nope',
        }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SandboxError);
        expect((error as Error).message).toContain("couldn't find remote ref nope");
        expect(client.deleted).toEqual([client.created[0]!.metadata!.name]);
    });

    it('disposes when the pod cannot be created', async () => {
        const { client, provider } = setup();
        client.create = async () => {
            throw new SandboxError('cannot create pod: forbidden');
        };
        await expect(provider.create({ runId: 'r1' })).rejects.toThrow(/forbidden/);
    });

    it('stops waiting when aborted', async () => {
        const {
            client,
            clock,
            provider,
        } = setup();
        client.statuses = [pending];
        const controller = new AbortController();

        const creating = provider.create({ runId: 'r1', signal: controller.signal });
        await flush();
        controller.abort();
        clock.advance(POLL_MS);

        await expect(creating).rejects.toThrow(/aborted/);
        await expect(creating).rejects.toBeInstanceOf(SandboxError);
        expect(client.deleted).toHaveLength(1);
    });

    it('creates no pod for an already aborted signal', async () => {
        const { client, provider } = setup();
        await expect(provider.create({ runId: 'r1', signal: AbortSignal.abort() })).rejects.toThrow(/aborted/);
        expect(client.created).toHaveLength(0);
    });

    it('marks a workspace whose pod failed as gone', async () => {
        const { client, provider } = setup();
        const workspace = await provider.create({ runId: 'r1' });
        client.onExec = () => { throw new SandboxError('cannot exec in pod: container not found ("sandbox")'); };
        client.statuses = [{ phase: 'Failed', reason: 'Evicted' }];
        expect(workspace.disposed).toBe(false);

        await expect(workspace.exec(['true'])).rejects.toThrow(/is gone.*container not found.*create_workspace/);
        expect(workspace.disposed).toBe(true);
        await expect(workspace.readFile('a.txt')).rejects.toThrow(/is gone/);
        await workspace.dispose();
        expect(client.deleted).toEqual([`chamvi-ws-${workspace.id}`]);
    });

    it('marks a workspace whose pod was deleted as gone', async () => {
        const { client, provider } = setup();
        const workspace = await provider.create({ runId: 'r1' });
        client.pods.delete(`chamvi-ws-${workspace.id}`);
        client.onExec = () => { throw new SandboxError('cannot exec in pod: Unexpected server response: 404'); };

        await expect(workspace.exec(['true'])).rejects.toThrow(/is gone/);
        expect(workspace.disposed).toBe(true);
    });

    it('keeps a workspace whose pod still runs after a failed exec', async () => {
        const { client, provider } = setup();
        const workspace = await provider.create({ runId: 'r1' });
        client.onExec = () => { throw new SandboxError('exec connection closed without an exit status'); };

        await expect(workspace.exec(['true'])).rejects.toThrow('exec connection closed without an exit status');
        expect(workspace.disposed).toBe(false);
        client.onExec = () => ({});
        expect((await workspace.exec(['true'])).exitCode).toBe(0);
    });

    it('dispose deletes the pod once', async () => {
        const { client, provider } = setup();
        const workspace = await provider.create({ runId: 'r1' });

        await workspace.dispose();
        await workspace.dispose();
        expect(client.deleted).toEqual([`chamvi-ws-${workspace.id}`]);
        await expect(workspace.exec(['true'])).rejects.toThrow(SandboxError);
    });

    it('uses the default image and pull policy', async () => {
        const { client, provider } = setup(undefined, { image: undefined });
        await provider.create({ runId: 'r1' });

        const container = client.created[0]!.spec!.containers[0]!;
        expect(container.image).toBe(DEFAULT_SANDBOX_IMAGE);
        expect(container.imagePullPolicy).toBe('IfNotPresent');
    });

    it('applies options, limits and the create input', async () => {
        const { client, provider } = setup(undefined, {
            env: { A: '1', B: '1' },
            limits: { memory: '1Gi' },
            podLabels: { team: 'x' },
            imagePullPolicy: 'Always',
        });
        await provider.create({
            runId: 'r1',
            image: 'other',
            env: { B: '2' },
            limits: { cpu: '2', maxLifetimeMs: 60_000 },
        });

        const pod = client.created[0]!;
        const container = pod.spec!.containers[0]!;
        expect(pod.metadata?.namespace).toBe('agents');
        expect(pod.metadata?.labels?.team).toBe('x');
        expect(pod.metadata?.annotations?.['chamvi.dev/expires-at']).toBe(String(START + 60_000));
        expect(container.image).toBe('other');
        // an image the model did not ask for follows the configured policy
        expect(container.imagePullPolicy).toBe('Always');
        expect(container.resources?.limits).toEqual({
            cpu: '2',
            memory: '1Gi',
            'ephemeral-storage': '4Gi',
        });
        expect(container.env?.filter((entry) => entry.name === 'A' || entry.name === 'B')).toEqual([
            { name: 'A', value: '1' },
            { name: 'B', value: '2' },
        ]);
    });

    it('requires a namespace', () => {
        const client = createFakePodClient();
        expect(() => createKubernetesSandbox({ namespace: '', client })).toThrow(InvalidAgentDefinitionError);
        expect(() => createKubernetesSandbox({ client } as never)).toThrow(InvalidAgentDefinitionError);
    });

    it.each([
        'Agents',
        'agents_1',
        '-agents',
        'agents-',
        'a.b',
        'a'.repeat(64),
    ])('rejects the namespace %s', (namespace) => {
        const client = createFakePodClient();
        expect(() => createKubernetesSandbox({ namespace, client })).toThrow(InvalidAgentDefinitionError);
    });

    it('accepts valid pod labels', () => {
        const client = createFakePodClient();
        expect(() => createKubernetesSandbox({
            namespace: 'a'.repeat(63),
            client,
            podLabels: {
                team: 'x',
                'example.com/tier': 'Back_end.1',
                empty: '',
                long: 'v'.repeat(63),
            },
        })).not.toThrow();
    });

    it.each([
        ['a value over 63 characters', { team: 'v'.repeat(64) }],
        ['a value with a space', { team: 'a b' }],
        ['a value with a non-alphanumeric end', { team: 'x-' }],
        ['an empty key', { '': 'x' }],
        ['a key with an invalid prefix', { 'Example.com/tier': 'x' }],
        ['a key with an empty name', { 'example.com/': 'x' }],
        ['a key name over 63 characters', { ['k'.repeat(64)]: 'x' }],
    ])('rejects podLabels with %s', (_name, podLabels) => {
        const client = createFakePodClient();
        expect(() => createKubernetesSandbox({
            namespace: 'agents',
            client,
            podLabels,
        })).toThrow(InvalidAgentDefinitionError);
    });

    it.each([
        'chamvi.dev/run',
        'chamvi.dev/workspace',
        'chamvi.dev/deployment',
        'chamvi.dev/repo-key',
        'app.kubernetes.io/managed-by',
        'app.kubernetes.io/component',
    ])('rejects podLabels that override %s', (key) => {
        const client = createFakePodClient();
        expect(() => createKubernetesSandbox({
            namespace: 'agents',
            client,
            podLabels: { [key]: 'x' },
        }))
            .toThrow(InvalidAgentDefinitionError);
    });

    it.each([
        ['non-object podLabels', { podLabels: ['x'] }],
        ['a non-string podLabels value', { podLabels: { team: 1 } }],
        ['an unknown pull policy', { imagePullPolicy: 'Never' }],
        ['an empty image', { image: '' }],
        ['a bad env key', { env: { 'A-B': 'x' } }],
        ['bad limits', { limits: { pids: 0 } }],
        ['a zero start timeout', { startTimeoutMs: 0 }],
        ['a fractional poll interval', { pollMs: 1.5 }],
        ['a client without the API', { client: {} }],
    ])('rejects %s', (_name, options) => {
        const client = createFakePodClient();
        expect(() => createKubernetesSandbox({
            namespace: 'agents',
            client,
            ...options,
        } as never))
            .toThrow(InvalidAgentDefinitionError);
    });

    it('validates the create input', async () => {
        const { client, provider } = setup();
        await expect(provider.create({ runId: '' })).rejects.toThrow(/runId/);
        await expect(provider.create({ runId: 'r1', env: { 'A B': 'x' } })).rejects.toBeInstanceOf(InvalidAgentDefinitionError);
        expect(client.created).toHaveLength(0);
    });

    describe('find', () => {
        /** Answers the remote's default branch (main), else like answerRevParse. */
        const answerCommit: FakeExecHandler = (argv, input) => {
            if (unwrap(argv).includes('ls-remote')) return { stdout: `ref: refs/heads/main\tHEAD\n${COMMIT}\tHEAD\n` };
            return answerRevParse(argv, input);
        };

        it('rebuilds a running pod\'s workspace in another provider from its labels and annotations', async () => {
            const {
                client, 
                clock, 
                provider, 
            } = setup(answerCommit);
            const created = await provider.create({
                runId: 'r1', 
                repo: REPO, 
                ref: 'v1', 
            });

            const replica = createKubernetesSandbox({
                namespace: 'agents',
                image: 'img',
                client,
                clock,
            });
            client.selectors.length = 0;
            const found = await replica.find('r1');
            expect(client.selectors).toEqual(['app.kubernetes.io/managed-by=chamvi,app.kubernetes.io/component=sandbox,chamvi.dev/deployment=default,chamvi.dev/run=r1']);
            expect(found.map((workspace) => workspace.id)).toEqual([created.id]);
            expect(created.info.defaultBranch).toBe('main');
            expect(found[0]!.info).toEqual(created.info);
            await expect(found[0]!.exec(['true'])).resolves.toMatchObject({ exitCode: 0 });
            expect(client.execs.at(-1)!.name).toBe(`chamvi-ws-${created.id}`);
        });

        it('answers the instance it holds', async () => {
            const { provider } = setup();
            const workspace = await provider.create({ runId: 'r1' });
            const [found] = await provider.find('r1');
            expect(found).toBe(workspace);
        });

        it('skips pods that do not run, are being deleted, expired or belong to another deployment', async () => {
            const {
                client, 
                clock, 
                provider, 
            } = setup();
            const failed = await provider.create({ runId: 'r1' });
            const deleting = await provider.create({ runId: 'r1' });
            const expired = await provider.create({ runId: 'r1', limits: { maxLifetimeMs: 60_000 } });
            await provider.create({ runId: 'r1', deployment: 'ci' });
            const running = await provider.create({ runId: 'r1' });
            client.pods.get(`chamvi-ws-${failed.id}`)!.status = { phase: 'Failed' };
            client.pods.get(`chamvi-ws-${deleting.id}`)!.metadata!.deletionTimestamp = new Date();
            clock.advance(60_000);

            const replica = createKubernetesSandbox({
                namespace: 'agents', 
                client, 
                clock, 
            });
            expect((await replica.find('r1')).map((workspace) => workspace.id)).toEqual([running.id]);
            expect(expired.info.expiresAt.getTime()).toBe(START + 60_000);
        });

        it('skips a running pod whose create died before the checkout finished', async () => {
            const {
                client,
                clock,
                provider,
            } = setup();
            const half = await provider.create({ runId: 'r1', repo: REPO });
            const done = await provider.create({ runId: 'r1' });
            // the record a finished checkout writes last is missing
            client.gitConfig.get(`chamvi-ws-${half.id}`)!.delete('chamvi.checkout');

            const replica = createKubernetesSandbox({
                namespace: 'agents',
                client,
                clock,
            });
            expect((await replica.find('r1')).map((workspace) => workspace.id)).toEqual([done.id]);
            // left to the garbage collection
            expect(client.deleted).toEqual([]);
        });

        it('finds nothing for a runId that is no label value, without a request', async () => {
            const { client, provider } = setup();
            expect(await provider.find('not a label!')).toEqual([]);
            expect(client.selectors).toEqual([]);
            await expect(provider.find('r1', { deployment: 'a b' })).rejects.toBeInstanceOf(ValidationError);
        });
    });
});
