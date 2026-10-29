/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IEffectStore } from '../types.ts';
import { copy } from './helpers.ts';

export class MemoryEffectStore implements IEffectStore {
    protected effects = new Map<string, { result: unknown }>();

    async getEffect(key: string): Promise<{ result: unknown } | undefined> {
        const effect = this.effects.get(key);
        return effect ? copy(effect) : undefined;
    }

    async putEffect(key: string, result: unknown): Promise<void> {
        this.effects.set(key, { result: copy(result) });
    }
}
