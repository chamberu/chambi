/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SANDBOX_ENV, repoKey } from '@chamvi/sandbox';
import { buildPod } from '../../../src/provider/helpers.ts';

type PodInput = Parameters<typeof buildPod>[0];

const input: PodInput = {
    id: 'w1',
    deployment: 'default',
    namespace: 'agents',
    info: {
        runId: 'r1',
        provider: 'k8s',
        image: 'img',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2026-01-01T00:10:00Z'),
    },
    env: { FOO: 'bar' },
    limits: {
        cpu: '500m',
        memory: '1Gi',
        storage: '4Gi',
        pids: 256,
        maxLifetimeMs: 600_000,
    },
    labels: { team: 'x' },
    imagePullPolicy: 'IfNotPresent',
};

describe('buildPod', () => {
    it('names the pod after the workspace', () => {
        const pod = buildPod(input);
        expect(pod.metadata?.name).toBe('chamvi-ws-w1');
        expect(pod.metadata?.namespace).toBe('agents');

        const name = buildPod({ ...input, id: randomUUID() }).metadata!.name!;
        expect(name).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
        expect(name.length).toBeLessThanOrEqual(63);
    });

    it('labels and annotates the pod', () => {
        const pod = buildPod(input);
        expect(pod.metadata?.labels).toEqual({
            'app.kubernetes.io/managed-by': 'chamvi',
            'app.kubernetes.io/component': 'sandbox',
            'chamvi.dev/run': 'r1',
            'chamvi.dev/workspace': 'w1',
            'chamvi.dev/deployment': 'default',
            team: 'x',
        });
        expect(pod.metadata?.annotations).toEqual({
            'chamvi.dev/created-at': '1767225600000',
            'chamvi.dev/expires-at': '1767226200000',
            'chamvi.dev/image': 'img',
        });
    });

    it('labels the repository key and annotates the repository and ref', () => {
        const repo = 'https://github.com/octo/demo.git';
        const pod = buildPod({
            ...input,
            info: {
                ...input.info, 
                repo, 
                ref: 'main', 
            }, 
        });
        expect(pod.metadata?.labels?.['chamvi.dev/repo-key']).toBe(repoKey(repo));
        expect(pod.metadata?.annotations).toMatchObject({ 'chamvi.dev/repo': repo, 'chamvi.dev/ref': 'main' });
    });

    it('hardens the pod', () => {
        const { spec } = buildPod(input);
        expect(spec).toMatchObject({
            restartPolicy: 'Never',
            automountServiceAccountToken: false,
            enableServiceLinks: false,
            terminationGracePeriodSeconds: 5,
        });
        // the lifetime follows the run: nothing ends the pod but the garbage collection
        expect(spec).not.toHaveProperty('activeDeadlineSeconds');
        expect(spec?.securityContext).toEqual({
            runAsNonRoot: true,
            runAsUser: 1000,
            runAsGroup: 1000,
            fsGroup: 1000,
            seccompProfile: { type: 'RuntimeDefault' },
        });
        expect(spec).not.toHaveProperty('serviceAccountName');
        expect(spec).not.toHaveProperty('hostNetwork');
        expect(spec).not.toHaveProperty('hostPID');
        expect(spec).not.toHaveProperty('hostIPC');
        expect(spec?.volumes).toEqual([
            { name: 'workspace', emptyDir: { sizeLimit: '4Gi' } },
            { name: 'tmp', emptyDir: { medium: 'Memory', sizeLimit: '512Mi' } },
        ]);
    });

    it('hardens the one container', () => {
        const { spec } = buildPod(input);
        expect(spec?.containers).toHaveLength(1);
        const container = spec!.containers[0]!;
        expect(container).toMatchObject({
            name: 'sandbox',
            image: 'img',
            imagePullPolicy: 'IfNotPresent',
            args: ['sleep', 'infinity'],
            workingDir: '/workspace',
        });
        expect(container).not.toHaveProperty('command');
        expect(container.env).toEqual([
            ...Object.entries(SANDBOX_ENV).map(([name, value]) => ({ name, value })),
            { name: 'FOO', value: 'bar' },
        ]);
        expect(container).not.toHaveProperty('envFrom');
        expect(container.env!.some((entry) => 'valueFrom' in entry)).toBe(false);
        expect(container.securityContext).toEqual({
            allowPrivilegeEscalation: false,
            readOnlyRootFilesystem: true,
            privileged: false,
            runAsNonRoot: true,
            capabilities: { drop: ['ALL'] },
        });
        const resources = {
            cpu: '500m',
            memory: '1Gi',
            'ephemeral-storage': '4Gi',
        };
        expect(container.resources).toEqual({ limits: resources, requests: resources });
        expect(container.volumeMounts).toEqual([
            { name: 'workspace', mountPath: '/workspace' },
            { name: 'tmp', mountPath: '/tmp' },
        ]);
    });

    it('passes the pull policy', () => {
        const pod = buildPod({ ...input, imagePullPolicy: 'Always' });
        expect(pod.spec?.containers[0]?.imagePullPolicy).toBe('Always');
    });

    it('does not copy the host environment', () => {
        process.env.CHAMVI_SECRET_PROBE = 's3cret';
        try {
            expect(JSON.stringify(buildPod(input))).not.toContain('s3cret');
        } finally {
            delete process.env.CHAMVI_SECRET_PROBE;
        }
    });

    it('lets the managed labels win', () => {
        const pod = buildPod({
            ...input,
            labels: {
                'chamvi.dev/run': 'x',
                'chamvi.dev/workspace': 'y',
                'app.kubernetes.io/managed-by': 'z',
            },
        });
        expect(pod.metadata?.labels?.['chamvi.dev/run']).toBe('r1');
        expect(pod.metadata?.labels?.['chamvi.dev/workspace']).toBe('w1');
        expect(pod.metadata?.labels?.['app.kubernetes.io/managed-by']).toBe('chamvi');
    });
});
