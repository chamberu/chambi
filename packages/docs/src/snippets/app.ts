// #region entry
// src/index.ts
import {
    consoleChannelModule,
    createApp,
    cron,
    defineAgent,
    http,
} from '@chamvi/app';

const digest = defineAgent({
    name: 'digest',
    // no model: the app's default below
    instructions: 'Summarize what happened since the last digest.',
    channels: [
        // POST /agents/digest/runs, the dashboard and MCP
        http.on(),
        // weekdays at 08:00, Berlin time
        cron.on('0 8 * * 1-5', { timezone: 'Europe/Berlin' }),
    ],
});

// synchronous and side-effect free: chamvi start | run-job | migrate load this default export
export default createApp({
    // the default model; CHAMVI_MODEL overrides it, ANTHROPIC_API_KEY configures the provider
    model: 'anthropic/claude-sonnet-5-5',
    agents: [digest],
    // tools write to it with ctx.channels.findOneOrFail('console').emit(...)
    modules: [consoleChannelModule()],
});
// #endregion entry
