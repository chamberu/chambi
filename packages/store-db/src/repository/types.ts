/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock } from '@chamvi/core';
import type { DataSource } from 'typeorm';
import type { createDatabaseStore } from './module.ts';

export type DatabaseStoreOptions = {
    /** An initialized Postgres data source listing STORE_ENTITIES and STORE_MIGRATIONS. */
    dataSource: DataSource;
    /** Source of time for leases and expiry (default: systemClock). */
    clock?: IClock;
};

export type DatabaseStore = ReturnType<typeof createDatabaseStore>;
