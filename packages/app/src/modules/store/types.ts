/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock, Stores } from '@chamvi/core';
import type { DataSource } from 'typeorm';
import type { ILogger } from '../../logger/types.ts';

export type StoreModuleOptions = {
    /** A Postgres URL; default `DATABASE_URL`. */
    url?: string;
    /** Used as is and never closed. */
    stores?: Stores;
    /** An initialized data source, shared by the TypeORM stores and never destroyed. */
    dataSource?: DataSource;
};

/** A capability store with expired records to remove. */
export type PurgingStore = {
    purgeExpired(): Promise<unknown>;
};

export type PurgeTimerOptions = {
    stores: PurgingStore[];
    clock: IClock;
    intervalMs: number;
    logger: ILogger;
};

export interface IPurgeTimer {
    start(): void;
    /** Idempotent; keeps a call in flight from re-arming and resolves once it settled. */
    stop(): Promise<void>;
}
