import type { Agent, Stores } from '@chamvi/core';
import { Engine } from '@chamvi/core';

export async function serve(store: Stores, agents: Agent[]) {
    // #region shutdown
    const engine = new Engine({
        stores: store,
        agents,
        onError: (error, run) => console.error('[agents]', run?.id, error),
    });
    await engine.start();

    process.once('SIGTERM', () => {
        // wait up to 25 s for in-flight runs, then mark the rest interrupted
        engine.drain({ timeoutMs: 25_000 })
            .then(() => process.exit(0))
            .catch(() => process.exit(1));
    });
    // #endregion shutdown

    return engine;
}

export async function cancelRun(engine: Engine, runId: string) {
    // #region cancel
    await engine.cancel(runId);
    const run = await engine.getRun(runId);
    // RunStatus.CANCELLED, or still RunStatus.RUNNING with cancelRequested when another replica executes it
    console.log(run?.status, run?.cancelRequested);
    // #endregion cancel
}
