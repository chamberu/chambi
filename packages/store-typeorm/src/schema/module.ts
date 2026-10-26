/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { MigrationExecutor } from 'typeorm';
import type { DataSource } from 'typeorm';
import { withDatabaseLock } from 'typeorm-extension';
import { MIGRATION_LOCK_NAME } from './constants.ts';

/**
 * Run the store's migrations, serialized across processes by an advisory lock.
 * The migrations run on the connection that holds the lock, so a call needs
 * one pooled connection.
 *
 * The data source must list STORE_ENTITIES and STORE_MIGRATIONS.
 */
export async function migrateStore(dataSource: DataSource): Promise<void> {
    const queryRunner = dataSource.createQueryRunner();
    try {
        await withDatabaseLock(
            queryRunner,
            MIGRATION_LOCK_NAME,
            async () => {
                const executor = new MigrationExecutor(dataSource, queryRunner);
                executor.transaction = 'each';
                await executor.executePendingMigrations();
            },
        );
    } finally {
        await queryRunner.release();
    }
}

/**
 * The names of the store's migrations (`STORE_MIGRATIONS` of the data source)
 * not run yet, in order. Read-only: a database without the migrations table
 * has all of them pending, and the table is never created.
 */
export async function pendingMigrations(dataSource: DataSource): Promise<string[]> {
    const executor = new MigrationExecutor(dataSource);
    const pending = await executor.getPendingMigrations();
    return pending.map((migration) => migration.name);
}
