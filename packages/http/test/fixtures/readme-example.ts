import type { LanguageModel } from 'ai';
import { Engine, createMemoryRepositories, defineAgent } from '@chamvi/core';
import {
    createHttpApp,
    createShutdown,
    http,
    httpChannel,
    mcpChannel,
    staticTokens,
} from '@chamvi/http';

export async function createAgentServer(model: LanguageModel) {
    const echo = defineAgent({
        name: 'echo',
        model,
        instructions: 'Answer with a short summary of the payload.',
        // http.on() lets REST (POST /agents/echo/runs) and MCP (run_echo) start runs
        channels: [http.on()],
    });

    const engine = new Engine({
        repositories: createMemoryRepositories(),
        agents: [echo],
        // REST runs carry channel http, MCP runs channel mcp
        channels: [httpChannel(), mcpChannel()],
    });

    const token = process.env.CHAMVI_TOKEN;
    if (!token) throw new Error('Set CHAMVI_TOKEN (at least 16 characters).');

    const shutdown = createShutdown({ engine });
    const app = createHttpApp({
        // routes read the store, the agents and the clock from the engine
        engine,
        auth: staticTokens({
            tokens: [{
                value: token,
                id: 'ci',
                permissions: ['*'],
            }],
        }),
        shutdown,
    });

    await engine.start();

    // serve it with routup (srvx); let createShutdown own SIGTERM:
    // const server = serve(app, { port: 3000, gracefulShutdown: false });
    // process.once('SIGTERM', () => shutdown.shutdown());
    return {
        app,
        engine,
        shutdown,
    };
}
