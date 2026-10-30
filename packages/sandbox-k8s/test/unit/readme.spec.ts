/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import { KubeConfig } from '@kubernetes/client-node';
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { createSandbox } from '../fixtures/readme-example.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

function unreachableKubeConfig(): KubeConfig {
    const kubeConfig = new KubeConfig();

    kubeConfig.loadFromOptions({
        clusters: [{
            name: 'readme',
            server: 'https://127.0.0.1:1',
            skipTLSVerify: true,
        }],
        users: [{ name: 'readme', token: 'readme-token' }],
        contexts: [{
            name: 'readme',
            cluster: 'readme',
            user: 'readme',
        }],
        currentContext: 'readme',
    });

    return kubeConfig;
}

describe('README example', () => {
    it('is the code of test/fixtures/readme-example.ts', () => {
        const readme = read('../../README.md');
        const blocks = readme.matchAll(/```typescript\n([\s\S]*?)```/g).map((m) => m[1]).toArray();

        expect(blocks).toContain(read('../fixtures/readme-example.ts'));
    });

    it('builds the provider without contacting the cluster', () => {
        const kubeConfig = unreachableKubeConfig();
        // every API call and exec authenticates through one of these first
        const api = vi.spyOn(kubeConfig, 'applySecurityAuthentication');
        const socket = vi.spyOn(kubeConfig, 'applyToHTTPSOptions');

        const sandbox = createSandbox(kubeConfig);

        expect(sandbox.name).toBe('k8s');
        expect(api).not.toHaveBeenCalled();
        expect(socket).not.toHaveBeenCalled();
    });
});
