/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { RepositoryNotFoundError } from '../../errors/index.ts';
import type { AgentRevision } from '../../agent/types.ts';
import type { IAgentRevisionRepository } from '../types.ts';
import { compareCodePoints, copy } from './helpers.ts';

export class MemoryAgentRevisionRepository implements IAgentRevisionRepository {
    protected agentRevisions = new Map<string, AgentRevision>();

    async findOneOrFail(agent: string): Promise<AgentRevision> {
        const result = await this.findOne(agent);
        if (result === undefined) throw new RepositoryNotFoundError('agent revisions');
        return result;
    }

    async findOrFail(): Promise<AgentRevision[]> {
        const result = await this.find();
        if (result.length === 0) throw new RepositoryNotFoundError('agent revisions');
        return result;
    }

    async findOne(agent: string): Promise<AgentRevision | undefined> {
        const revision = this.agentRevisions.get(agent);
        return revision ? copy(revision) : undefined;
    }

    async save(revision: AgentRevision): Promise<void> {
        this.agentRevisions.set(revision.agent, copy(revision));
    }

    async delete(agent: string): Promise<void> {
        this.agentRevisions.delete(agent);
    }

    async find(): Promise<AgentRevision[]> {
        return this.agentRevisions.values().toArray()
            .sort((a, b) => compareCodePoints(a.agent, b.agent))
            .map((revision) => copy(revision));
    }
}
