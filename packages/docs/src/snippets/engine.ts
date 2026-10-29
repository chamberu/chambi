import type { LanguageModel } from 'ai';
import {
    Engine,
    consoleChannel,
    createMemoryStores,
    defineAgent,
} from '@chamvi/core';

export function createEngine(model: LanguageModel) {
    // #region many
    const triage = defineAgent({
        name: 'triage',
        model,
        instructions: 'Triage the issue.',
    });
    const digest = defineAgent({
        name: 'digest',
        model,
        instructions: 'Summarize the day.',
    });

    const engine = new Engine({
        stores: createMemoryStores(),
        agents: [triage, digest],
        // tools reach it with ctx.channels.findOneOrFail('console')
        channels: [consoleChannel()],
        concurrencyMaxRuns: 8,
        claimTtlMs: 30_000,
    });
    // #endregion many

    return engine;
}
