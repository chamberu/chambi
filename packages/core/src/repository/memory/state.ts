/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';
import { RepositoryNotFoundError } from '../../errors/index.ts';
import type { IStateRepository, StateDocumentFindOptions, StateFindOptions } from '../types.ts';
import { compareCodePoints, copy } from './helpers.ts';

export class MemoryStateRepository implements IStateRepository {
    protected kv = new Map<string, unknown>();

    protected docs = new Map<string, Map<string, unknown>>();

    async findOneOrFail(agent: string, key: string): Promise<unknown> {
        const result = await this.findOne(agent, key);
        if (result === undefined) throw new RepositoryNotFoundError('state');
        return result;
    }

    async findOrFail(agent: string, q?: StateFindOptions): Promise<Array<{ key: string; value: unknown }>> {
        const result = await this.find(agent, q);
        if (result.length === 0) throw new RepositoryNotFoundError('state');
        return result;
    }

    async findDocumentsOrFail(agent: string, coll: string, q?: StateDocumentFindOptions): Promise<Array<{ id: string; doc: unknown }>> {
        const result = await this.findDocuments(agent, coll, q);
        if (result.length === 0) throw new RepositoryNotFoundError('documents');
        return result;
    }

    async findOne(agent: string, key: string): Promise<unknown> {
        return copy(this.kv.get(`${agent}\u0000${key}`));
    }

    async set(agent: string, key: string, value: unknown): Promise<void> {
        if (value === undefined) {
            this.kv.delete(`${agent}\u0000${key}`);
            return;
        }
        this.kv.set(`${agent}\u0000${key}`, copy(value));
    }

    async find(agent: string, q: StateFindOptions = {}): Promise<Array<{ key: string; value: unknown }>> {
        const prefix = `${agent}\u0000`;
        const entries = this.kv.entries().toArray()
            .filter(([id]) => id.startsWith(prefix))
            .map(([id, value]) => ({ key: id.slice(prefix.length), value }))
            .sort((a, b) => compareCodePoints(a.key, b.key));
        const offset = q.offset ?? 0;
        const end = q.limit === undefined ? undefined : offset + q.limit;
        return entries.slice(offset, end).map((entry) => ({ key: entry.key, value: copy(entry.value) }));
    }

    async findDocuments(
        agent: string,
        coll: string,
        q: StateDocumentFindOptions = {},
    ): Promise<Array<{ id: string; doc: unknown }>> {
        const entries = (this.docs.get(`${agent}\u0000${coll}`) ?? new Map()).entries().toArray()
            .map(([id, doc]) => ({ id, doc }))
            .filter(({ doc }) => Object.entries(q.where ?? {}).every(
                ([k, v]) => isObject(doc) && doc[k] === v,
            ));
        return copy(q.limit === undefined ? entries : entries.slice(0, q.limit));
    }

    async upsertDocument(agent: string, coll: string, id: string, doc: unknown): Promise<void> {
        const name = `${agent}\u0000${coll}`;
        const collection = this.docs.get(name) ?? new Map<string, unknown>();
        collection.set(id, copy(doc));
        this.docs.set(name, collection);
    }

    async deleteDocument(agent: string, coll: string, id: string): Promise<void> {
        this.docs.get(`${agent}\u0000${coll}`)?.delete(id);
    }
}
