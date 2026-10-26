import {
    consoleChannelModule,
    createApp,
    cron,
    defineAgent,
    http,
} from '@chamvi/app';

const triage = defineAgent({
    name: 'triage',
    // no model: the app's default below
    instructions: 'Triage the reported issue: label it and summarize the next step.',
    channels: [
        // POST /agents/triage/runs, the UI and MCP
        http.on(),
        // every 30 minutes, Berlin time
        cron.on('*/30 * * * *', { timezone: 'Europe/Berlin' }),
    ],
});

// chamvi start | run-job | migrate load this default export
export default createApp({
    // the default model; CHAMVI_MODEL overrides it, ANTHROPIC_API_KEY configures the provider
    model: 'anthropic/claude-sonnet-5-5',
    agents: [triage],
    // tools write to it with ctx.channels.findOneOrFail('console').emit(...)
    modules: [consoleChannelModule()],
});
