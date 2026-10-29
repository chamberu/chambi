/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import * as pkg from '@chamvi/store-typeorm';

describe('public api', () => {
    it.each([
        'migrateStore',
        'pendingMigrations',
        'TypeormStore',
        'TypeormConversationStore',
    ])('exports %s', (name) => {
        expect(pkg).toHaveProperty(name);
        expect(pkg[name as keyof typeof pkg]).toBeTypeOf('function');
    });

    it('exports the entities, migrations and lock name', () => {
        expect(pkg.STORE_ENTITIES).toBeInstanceOf(Array);
        expect(pkg.STORE_ENTITIES).toHaveLength(14);
        expect(pkg.STORE_MIGRATIONS).toBeInstanceOf(Array);
        expect(pkg.STORE_MIGRATIONS).toHaveLength(7);
        expect(pkg.MIGRATION_LOCK_NAME).toBe('chamvi:migrations');
    });
});
