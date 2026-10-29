/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IEffectStore } from '@chamvi/core';
import type { DataSource, Repository } from 'typeorm';
import { EffectEntity } from '../entities/index.ts';
import { asValues } from '../store/helpers.ts';

export class TypeormEffectStore implements IEffectStore {
    protected dataSource: DataSource;

    constructor(opts: { dataSource: DataSource }) {
        this.dataSource = opts.dataSource;
    }

    protected get effects(): Repository<EffectEntity> {
        return this.dataSource.getRepository(EffectEntity);
    }

    async getEffect(key: string): Promise<{ result: unknown } | undefined> {
        const entity = await this.effects.findOneBy({ key });
        return entity ? { result: entity.result } : undefined;
    }

    async putEffect(key: string, result: unknown): Promise<void> {
        await this.effects.upsert(asValues<EffectEntity>({ key, result: result ?? null }), ['key']);
    }
}
