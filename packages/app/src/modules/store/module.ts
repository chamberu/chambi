/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    ChamviError,
    InvalidAgentDefinitionError,
    createMemoryStores,
} from '@chamvi/core';
import type { IClock, Stores } from '@chamvi/core';
import type { IContainer } from 'eldin';
import type { IModule } from 'orkos';
import type { DataSource } from 'typeorm';
import { APP_ERROR_CODE, AppToken, ModuleName } from '../../module/constants.ts';
import { throwIfStopped } from '../../module/helpers.ts';
import type { ILogger } from '../../logger/types.ts';
import type { AppContext } from '../../module/types.ts';
import {
    MEMORY_CONVERSATION_WARNING,
    MEMORY_STORE_WARNING,
    PURGE_HOOK_NAME,
    STORE_CONNECT_TIMEOUT_MS,
    STORE_NOT_MIGRATED_HINT,
} from './constants.ts';
import { destroyQuietly, isPurgingStore, maskPassword } from './helpers.ts';
import { createPurgeTimer } from './purge.ts';
import type {
    IPurgeTimer,
    StoreModuleOptions,
} from './types.ts';

/** Registers separate capability stores, sharing one DataSource for PostgreSQL. */
export class StoreModule implements IModule {
    readonly name: string = ModuleName.STORE;

    readonly dependencies = [ModuleName.CONFIG];

    protected options: StoreModuleOptions;

    protected purge: IPurgeTimer | undefined;

    /** A data source this module initialized, destroyed in teardown. */
    protected created: DataSource | undefined;

    /** The connect timeout of a data source built from a URL. */
    protected connectTimeoutMs: number = STORE_CONNECT_TIMEOUT_MS;

    constructor(options: StoreModuleOptions = {}) {
        this.options = options;
    }

    async setup(container: IContainer): Promise<void> {
        const context = container.resolve(AppToken.CONTEXT);
        const config = container.resolve(AppToken.CONFIG);
        const clock = container.resolve(AppToken.CLOCK);
        const logger = container.resolve(AppToken.LOGGER);

        const url = this.options.url ?? config.store.url;
        const migrate = context.mode === 'migrate' || config.store.migrate;

        let stores: Stores;
        if (this.options.stores) {
            ({ stores } = this.options);
        } else if (this.options.dataSource) {
            if (!this.options.dataSource.isInitialized) {
                throw new InvalidAgentDefinitionError('storeModule({ dataSource }) needs an initialized data source.');
            }
            container.register(AppToken.DATA_SOURCE, { useValue: this.options.dataSource });
            stores = await this.typeormStores(context, this.options.dataSource, clock, migrate);
        } else if (typeof url === 'string') {
            stores = await this.connect(container, logger, context, url, clock, migrate);
        } else {
            stores = createMemoryStores({ clock });
            if (!config.dev) {
                logger.warn(MEMORY_STORE_WARNING);
            }
        }

        container.register(AppToken.STORES, { useValue: stores });

        if (context.conversations && !container.has(AppToken.DATA_SOURCE) && !this.options.stores) {
            logger.warn(MEMORY_CONVERSATION_WARNING);
        }

        const purging = Object.values(stores).filter(isPurgingStore);
        if (context.mode === 'start' && !context.check && config.store.purgeIntervalMs > 0 && purging.length > 0) {
            const purge = createPurgeTimer({
                stores: purging,
                clock,
                intervalMs: config.store.purgeIntervalMs,
                logger,
            });
            this.purge = purge;
            container.registerMany(AppToken.LIFECYCLE_HOOKS, {
                useValue: {
                    name: PURGE_HOOK_NAME,
                    started: () => purge.start(),
                    stopping: () => purge.stop(),
                },
            });
        }
    }

    async teardown(): Promise<void> {
        const { purge } = this;
        this.purge = undefined;
        await purge?.stop();

        const dataSource = this.created;
        this.created = undefined;
        if (dataSource?.isInitialized) {
            await dataSource.destroy();
        }
    }

    protected async connect(
        container: IContainer,
        logger: ILogger,
        context: AppContext,
        url: string,
        clock: IClock,
        migrate: boolean,
    ): Promise<Stores> {
        // lazy: an in-memory app never loads TypeORM
        const { DataSource: DataSourceClass } = await import('typeorm');
        const { STORE_ENTITIES, STORE_MIGRATIONS } = await import('@chamvi/store-typeorm');

        const dataSource = new DataSourceClass({
            type: 'postgres',
            url,
            entities: STORE_ENTITIES,
            migrations: STORE_MIGRATIONS,
            connectTimeoutMS: this.connectTimeoutMs,
        });

        throwIfStopped(context);
        try {
            await dataSource.initialize();
        } catch (error) {
            await destroyQuietly(dataSource, logger, url);
            throw maskPassword(error, url);
        }
        container.register(AppToken.DATA_SOURCE, { useValue: dataSource });

        // orkos never tears down a module whose setup threw, so close what was opened here
        try {
            const stores = await this.typeormStores(context, dataSource, clock, migrate);
            this.created = dataSource;
            return stores;
        } catch (error) {
            await destroyQuietly(dataSource, logger, url);
            throw maskPassword(error, url);
        }
    }

    protected async typeormStores(context: AppContext, dataSource: DataSource, clock: IClock, migrate: boolean): Promise<Stores> {
        const {
            createTypeormStores,
            migrateStore, 
            pendingMigrations, 
        } = await import('@chamvi/store-typeorm');
        if (context.check) {
            // read-only: a start with CHAMVI_MIGRATE (the default) would apply them, else it cannot run
            if (!migrate) {
                const pending = await pendingMigrations(dataSource);
                if (pending.length > 0) {
                    throw new ChamviError({
                        code: APP_ERROR_CODE.STORE_NOT_MIGRATED,
                        message: `The store has ${pending.length} pending migration(s); ${STORE_NOT_MIGRATED_HINT}`,
                    });
                }
            }
        } else if (migrate) {
            throwIfStopped(context);
            await migrateStore(dataSource);
        }

        throwIfStopped(context);
        return createTypeormStores({ dataSource, clock });
    }
}

export function storeModule(options?: StoreModuleOptions): IModule {
    return new StoreModule(options);
}
