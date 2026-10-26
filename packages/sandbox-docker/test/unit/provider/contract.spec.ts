/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto';
import { createDockerSandbox } from '@chamvi/sandbox-docker';
import { describeWorkspaceContract } from '@chamvi/test-kit';
import { describeDocker, dockerImage } from '../../utils/docker.ts';

describeDocker('docker sandbox', () => {
    describeWorkspaceContract(
        'docker',
        (input) => createDockerSandbox({ image: dockerImage })
            .create({ runId: input?.runId ?? `test-${randomUUID()}` }),
        // a second provider: a restarted process or a replica on the same host
        { find: (runId) => createDockerSandbox({ image: dockerImage }).find(runId) },
    );
});
