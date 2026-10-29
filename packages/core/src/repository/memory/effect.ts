/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { RepositoryNotFoundError } from '../../errors/index.ts';
import type { IEffectRepository } from '../types.ts';
import { copy } from './helpers.ts';

export class MemoryEffectRepository implements IEffectRepository {
    protected effects = new Map<string, { result: unknown }>();

    async findOneOrFail(key: string): Promise<{ result: unknown }> {
        const result = await this.findOne(key);
        if (result === undefined) throw new RepositoryNotFoundError('effects');
        return result;
    }

    async findOne(key: string): Promise<{ result: unknown } | undefined> {
        const effect = this.effects.get(key);
        return effect ? copy(effect) : undefined;
    }

    async save(key: string, result: unknown): Promise<void> {
        this.effects.set(key, { result: copy(result) });
    }
}
