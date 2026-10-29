/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IStateStore } from '@chamvi/core';
import { JsonContains } from 'typeorm';
import type { DataSource, Repository } from 'typeorm';
import { DocEntity, KvEntity } from '../entities/index.ts';
import { asValues } from '../store/helpers.ts';

export class TypeormStateStore implements IStateStore {
    protected dataSource: DataSource;

    constructor(opts: { dataSource: DataSource }) {
        this.dataSource = opts.dataSource;
    }

    protected get kv(): Repository<KvEntity> {
        return this.dataSource.getRepository(KvEntity);
    }

    protected get docs(): Repository<DocEntity> {
        return this.dataSource.getRepository(DocEntity);
    }

    async kvGet(agent: string, key: string): Promise<unknown> {
        const entity = await this.kv.findOneBy({ agent, key });
        return entity ? entity.value : undefined;
    }

    async kvSet(agent: string, key: string, value: unknown): Promise<void> {
        if (value === undefined) {
            await this.kv.delete({ agent, key });
            return;
        }

        await this.kv.upsert(asValues<KvEntity>({
            agent,
            key,
            value,
        }), ['agent', 'key']);
    }

    async kvList(agent: string, q: { limit?: number; offset?: number } = {}): Promise<Array<{ key: string; value: unknown }>> {
        if (q.limit === 0) {
            // take: 0 means no limit to TypeORM
            return [];
        }

        const entities = await this.kv.find({
            where: { agent },
            order: { key: 'ASC' },
            skip: q.offset,
            take: q.limit,
        });
        return entities.map((entity) => ({ key: entity.key, value: entity.value }));
    }

    async docList(
        agent: string,
        coll: string,
        q: { where?: Record<string, unknown>; limit?: number } = {},
    ): Promise<Array<{ id: string; doc: unknown }>> {
        if (q.limit === 0) {
            // limit(0) means no limit to TypeORM
            return [];
        }

        const query = this.docs.createQueryBuilder('d')
            .where({ agent, collection: coll })
            .orderBy('d.id', 'ASC');
        if (q.where && Object.keys(q.where).length > 0) {
            // Containment with the defined values (an empty object still
            // restricts to object documents); a key whose value is undefined
            // matches documents lacking it, as in MemoryStateStore. The doc
            // column's transformer sanitizes the containment value.
            const defined: Record<string, unknown> = {};
            let i = 0;
            for (const [key, value] of Object.entries(q.where)) {
                if (value === undefined) {
                    // raw: TypeORM has no operator for jsonb key existence (?)
                    query.andWhere(`NOT jsonb_exists(d.doc, :absent${i})`, { [`absent${i}`]: key });
                    i++;
                } else {
                    defined[key] = value;
                }
            }
            query.andWhere({ doc: JsonContains(defined) });
        }
        if (q.limit !== undefined) {
            query.limit(q.limit);
        }

        const entities = await query.getMany();
        return entities.map((entity) => ({ id: entity.id, doc: entity.doc }));
    }

    async docUpsert(agent: string, coll: string, id: string, doc: unknown): Promise<void> {
        await this.docs.upsert(asValues<DocEntity>({
            agent,
            collection: coll,
            id,
            doc: doc ?? null,
        }), ['agent', 'collection', 'id']);
    }

    async docDelete(agent: string, coll: string, id: string): Promise<void> {
        await this.docs.delete({
            agent,
            collection: coll,
            id,
        });
    }
}
