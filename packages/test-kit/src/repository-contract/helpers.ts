/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { RunStatus } from '@chamvi/core';
import type { AgentRevision, Artifact, Run } from '@chamvi/core';

export function makeRun(id: string, overrides: Partial<Run> = {}): Run {
    const createdAt = new Date(1_000);

    return {
        id,
        agent: 'a',
        status: RunStatus.QUEUED,
        trigger: {
            id: `t-${id}`,
            agent: 'a',
            trigger: 'http',
            channel: 'http',
            payload: {},
            receivedAt: createdAt,
        },
        usage: { inputTokens: 0, outputTokens: 0 },
        createdAt,
        updatedAt: createdAt,
        ...overrides,
    };
}

export function makeArtifact(id: string, overrides: Partial<Artifact> = {}): Artifact {
    return {
        id,
        runId: 'r1',
        agent: 'a',
        mediaType: 'text/plain',
        filename: `${id}.txt`,
        size: 3,
        createdAt: new Date(1_000),
        ...overrides,
    };
}

export function makeAgentRevision(agent: string, overrides: Partial<AgentRevision> = {}): AgentRevision {
    return {
        agent,
        hash: 'h1',
        changedAt: new Date(1_000),
        ...overrides,
    };
}
