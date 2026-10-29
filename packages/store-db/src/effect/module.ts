/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { RepositoryNotFoundError } from '@chamvi/core';
import type { IEffectRepository } from '@chamvi/core';
import type { DataSource, Repository } from 'typeorm';
import { EffectEntity } from '../entities/index.ts';
import { asValues } from '../repository/helpers.ts';

export class TypeormEffectRepository implements IEffectRepository {
    protected dataSource: DataSource;

    constructor(opts: { dataSource: DataSource }) {
        this.dataSource = opts.dataSource;
    }

    protected get effects(): Repository<EffectEntity> {
        return this.dataSource.getRepository(EffectEntity);
    }

    async findOne(key: string): Promise<{ result: unknown } | undefined> {
        const entity = await this.effects.findOneBy({ key });
        return entity ? { result: entity.result } : undefined;
    }

    async findOneOrFail(key: string): Promise<{ result: unknown }> {
        const result = await this.findOne(key);
        if (result === undefined) throw new RepositoryNotFoundError('effects');
        return result;
    }

    async save(key: string, result: unknown): Promise<void> {
        await this.effects.upsert(asValues<EffectEntity>({ key, result: result ?? null }), ['key']);
    }
}
