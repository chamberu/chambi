/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { AgentRevision, IAgentRevisionStore } from '@chamvi/core';
import type { DataSource, Repository } from 'typeorm';
import { AgentRevisionEntity } from '../entities/index.ts';
import { asValues, toAgentRevision } from '../store/helpers.ts';

export class TypeormAgentRevisionStore implements IAgentRevisionStore {
    protected dataSource: DataSource;

    constructor(opts: { dataSource: DataSource }) {
        this.dataSource = opts.dataSource;
    }

    protected get agentRevisions(): Repository<AgentRevisionEntity> {
        return this.dataSource.getRepository(AgentRevisionEntity);
    }

    async getAgentRevision(agent: string): Promise<AgentRevision | undefined> {
        const entity = await this.agentRevisions.findOneBy({ agent });
        return entity ? toAgentRevision(entity) : undefined;
    }

    async setAgentRevision(revision: AgentRevision): Promise<void> {
        await this.agentRevisions.upsert(asValues<AgentRevisionEntity>({
            agent: revision.agent,
            hash: revision.hash,
            changedAt: revision.changedAt,
        }), ['agent']);
    }

    async deleteAgentRevision(agent: string): Promise<void> {
        await this.agentRevisions.delete({ agent });
    }

    async listAgentRevisions(): Promise<AgentRevision[]> {
        const entities = await this.agentRevisions.find({ order: { agent: 'ASC' } });
        return entities.map((entity) => toAgentRevision(entity));
    }
}
