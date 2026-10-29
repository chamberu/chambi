/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { RepositoryNotFoundError } from '@chamvi/core';
import type { AgentRevision, IAgentRevisionRepository } from '@chamvi/core';
import type { DataSource, Repository } from 'typeorm';
import { AgentRevisionEntity } from '../entities/index.ts';
import { asValues, toAgentRevision } from '../repository/helpers.ts';

export class DatabaseAgentRevisionRepository implements IAgentRevisionRepository {
    protected dataSource: DataSource;

    constructor(opts: { dataSource: DataSource }) {
        this.dataSource = opts.dataSource;
    }

    protected get agentRevisions(): Repository<AgentRevisionEntity> {
        return this.dataSource.getRepository(AgentRevisionEntity);
    }

    async findOne(agent: string): Promise<AgentRevision | undefined> {
        const entity = await this.agentRevisions.findOneBy({ agent });
        return entity ? toAgentRevision(entity) : undefined;
    }

    async findOneOrFail(agent: string): Promise<AgentRevision> {
        const result = await this.findOne(agent);
        if (result === undefined) throw new RepositoryNotFoundError('agent revisions');
        return result;
    }

    async save(revision: AgentRevision): Promise<void> {
        await this.agentRevisions.upsert(asValues<AgentRevisionEntity>({
            agent: revision.agent,
            hash: revision.hash,
            changedAt: revision.changedAt,
        }), ['agent']);
    }

    async delete(agent: string): Promise<void> {
        await this.agentRevisions.delete({ agent });
    }

    async find(): Promise<AgentRevision[]> {
        const entities = await this.agentRevisions.find({ order: { agent: 'ASC' } });
        return entities.map((entity) => toAgentRevision(entity));
    }

    async findOrFail(): Promise<AgentRevision[]> {
        const result = await this.find();
        if (result.length === 0) throw new RepositoryNotFoundError('agent revisions');
        return result;
    }
}
