import type { Agent, IStore } from '@chamvi/core';
import { Engine } from '@chamvi/core';
import { cronChannel, runJob } from '@chamvi/channel-cron';

export async function serve(store: IStore, agents: Agent[]) {
    // #region channel
    const engine = new Engine({
        store,
        agents,
        // every replica registers the same channel; a store lock fires each tick once
        channels: [cronChannel({ onError: (error, { agent, subscription }) => console.error('[cron]', agent, subscription, error) })],
    });

    // recovers runs, then starts the channel
    await engine.start();

    process.once('SIGTERM', async () => {
        // stops the channel first (no new ticks), then lets the runs in flight finish
        await engine.drain({ timeoutMs: 25_000 });
        process.exit(0);
    });
    // #endregion channel

    return { engine };
}

export async function job(store: IStore, agent: Agent) {
    // #region job
    // a Kubernetes CronJob: fire the agent's cron subscription once and exit with its outcome
    const engine = new Engine({
        store,
        agents: [agent],
        // the engine must hold the channel; runJob starts it with start({ channels: false })
        channels: [cronChannel()],
    });
    const { status, exitCode } = await runJob({
        engine,
        agent,
        drainTimeoutMs: 120_000,
    });

    console.log('cron run', status);
    process.exitCode = exitCode;
    // #endregion job
}
