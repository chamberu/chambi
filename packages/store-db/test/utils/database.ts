/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createDatabase } from 'typeorm-extension';
import { describe, inject } from 'vitest';
import {
    STORE_ENTITIES,
    STORE_MIGRATIONS,
    migrateStore,
} from '../../src/schema/index.ts';
import { TableName } from '../../src/entities/constants.ts';

export type PostgresConnection = {
    host: string;
    port: number;
    username: string;
    password: string;
};

declare module 'vitest' {
    export interface ProvidedContext {
        postgres: PostgresConnection;
    }
}

export const postgres: PostgresConnection | undefined = inject('postgres');

export function describePostgres(name: string, fn: () => void): void {
    describe.skipIf(!postgres)(name, fn);
}

export type TestDataSourceOptions = {
    /** Run migrateStore after initializing (default true). */
    migrate?: boolean;
    /** Pool size (default 25). */
    max?: number;
    /** A schema to create and use as the connections' search_path instead of public. */
    schema?: string;
};

export async function createTestDataSource(opts: TestDataSourceOptions = {}): Promise<DataSource> {
    if (!postgres) {
        throw new Error('Postgres is not available.');
    }

    const database = `chamvi_test_${randomUUID().replaceAll('-', '')}`;
    await createDatabase({
        options: {
            type: 'postgres',
            ...postgres,
            database,
        },
        initialDatabase: 'postgres',
        ifNotExist: false,
        synchronize: false,
    });

    const dataSource = new DataSource({
        type: 'postgres',
        ...postgres,
        database,
        entities: STORE_ENTITIES,
        migrations: STORE_MIGRATIONS,
        extra: {
            max: opts.max ?? 25,
            options: `-c TimeZone=America/New_York${opts.schema ? ` -c search_path=${opts.schema}` : ''}`,
        },
    });
    await dataSource.initialize();

    if (opts.schema) {
        await dataSource.query(`CREATE SCHEMA "${opts.schema}"`);
    }

    if (opts.migrate !== false) {
        await migrateStore(dataSource);
    }

    return dataSource;
}

export async function truncateRepository(dataSource: DataSource): Promise<void> {
    const tables = Object.values(TableName).map((name) => `"${name}"`).join(', ');
    await dataSource.query(`TRUNCATE ${tables} RESTART IDENTITY`);
}
