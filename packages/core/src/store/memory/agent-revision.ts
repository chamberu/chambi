/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { AgentRevision } from '../../agent/types.ts';
import type { IAgentRevisionStore } from '../types.ts';
import { compareCodePoints, copy } from './helpers.ts';

export class MemoryAgentRevisionStore implements IAgentRevisionStore {
    protected agentRevisions = new Map<string, AgentRevision>();

    async getAgentRevision(agent: string): Promise<AgentRevision | undefined> {
        const revision = this.agentRevisions.get(agent);
        return revision ? copy(revision) : undefined;
    }

    async setAgentRevision(revision: AgentRevision): Promise<void> {
        this.agentRevisions.set(revision.agent, copy(revision));
    }

    async deleteAgentRevision(agent: string): Promise<void> {
        this.agentRevisions.delete(agent);
    }

    async listAgentRevisions(): Promise<AgentRevision[]> {
        return this.agentRevisions.values().toArray()
            .sort((a, b) => compareCodePoints(a.agent, b.agent))
            .map((revision) => copy(revision));
    }
}
