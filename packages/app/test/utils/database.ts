/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto';
import { createDatabase } from 'typeorm-extension';
import { describe, inject } from 'vitest';

export type PostgresConnection = {
    host: string;
    port: number;
    username: string;
    password: string;
};

declare module 'vitest' {
    // Vitest's augmentation name is fixed by its public API.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    export interface ProvidedContext {
        postgres: PostgresConnection;
    }
}

export const postgres: PostgresConnection | undefined = inject('postgres');

export function describePostgres(name: string, fn: () => void): void {
    describe.skipIf(!postgres)(name, fn);
}

/** A fresh, empty database on the test server as a `postgres://` URL. */
export async function createTestDatabaseUrl(): Promise<string> {
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

    const user = encodeURIComponent(postgres.username);
    const password = encodeURIComponent(postgres.password);

    return `postgres://${user}:${password}@${postgres.host}:${postgres.port}/${database}`;
}
