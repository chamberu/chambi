import type { LanguageModel } from 'ai';
import { Engine, defineAgent } from '@chamvi/core';
import {
    STORE_ENTITIES,
    STORE_MIGRATIONS,
    createTypeormRepositories,
    migrateStore,
} from '@chamvi/store-db';
import { DataSource } from 'typeorm';

export async function createEngine(model: LanguageModel) {
    const triage = defineAgent({
        name: 'triage',
        model,
        instructions: 'Triage the issue.',
    });

    // #region setup
    const dataSource = new DataSource({
        type: 'postgres',
        url: process.env.DATABASE_URL,
        entities: STORE_ENTITIES,
        migrations: STORE_MIGRATIONS,
    });
    await dataSource.initialize();
    await migrateStore(dataSource);

    const repositories = createTypeormRepositories({ dataSource });
    const engine = new Engine({
        repositories,
        agents: [triage],
    });
    // #endregion setup

    // #region purge
    // expired keys and locks stay until purged: purge every hour
    const purge = setInterval(() => {
        Promise.all([repositories.idempotency.purgeExpired(), repositories.locks.purgeExpired()])
            .catch((e: unknown) => console.error(e));
    }, 60 * 60 * 1000);
    purge.unref();
    // #endregion purge

    // #region shutdown
    // the store never destroys the data source: the app closes it last
    const shutdown = async () => {
        clearInterval(purge);
        await engine.drain();
        await dataSource.destroy();
    };
    // #endregion shutdown

    return { engine, shutdown };
}
