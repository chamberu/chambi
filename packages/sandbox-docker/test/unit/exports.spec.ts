/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import * as docker from '@chamvi/sandbox-docker';

describe('public api', () => {
    it('exports the provider and the constants', () => {
        expect(Object.keys(docker).sort()).toEqual([
            'CONTAINER_NAME_PREFIX',
            'DEFAULT_CACHE_VOLUME',
            'DEFAULT_NETWORK',
            'DEFAULT_USER',
            'createDockerSandbox',
        ]);
        expect(docker.DEFAULT_NETWORK).toBe('bridge');
        expect(docker.CONTAINER_NAME_PREFIX).toBe('chamvi-ws-');
        expect(docker.DEFAULT_USER).toBe('0:0');
        expect(docker.DEFAULT_CACHE_VOLUME).toBe('chamvi-sandbox-cache');
        expect(typeof docker.createDockerSandbox).toBe('function');
    });

    it('keeps the container builder and the transport internal', () => {
        expect(docker).not.toHaveProperty('buildContainerOptions');
        expect(docker).not.toHaveProperty('createDockerTransport');
    });
});
