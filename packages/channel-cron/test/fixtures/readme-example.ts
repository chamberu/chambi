import type { LanguageModel } from 'ai';
import {
    Engine,
    createMemoryRepositories,
    defineAgent,
} from '@chamvi/core';
import { cron, cronChannel } from '@chamvi/channel-cron';

export async function startScheduling(model: LanguageModel) {
    const sweep = defineAgent({
        name: 'sweep',
        model,
        instructions: 'Close stale issues older than 30 days.',
        // every 30 minutes, Berlin time; skipped while the previous run is active
        channels: [cron.on('*/30 * * * *', { timezone: 'Europe/Berlin' })],
    });

    // createMemoryRepositories is per process; with several replicas, pass one shared store
    // (e.g. createDatabaseRepositories) so its lock fires each tick once across them
    const engine = new Engine({
        repositories: createMemoryRepositories(),
        agents: [sweep],
        // every replica registers the same channel; it reads agents and store from the engine
        channels: [cronChannel()],
    });

    // starts the cron channel after recovering runs
    await engine.start();

    // shutdown: drain() stops the channel first, then lets the runs in flight finish
    // await engine.drain();
    return { engine };
}
