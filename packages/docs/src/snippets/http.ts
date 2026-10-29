import type { ITokenVerifier } from '@authup/server-adapter-kit';
import type { Agent, Stores } from '@chamvi/core';
import { cronChannel } from '@chamvi/channel-cron';
import { Engine } from '@chamvi/core';
import {
    authup,
    createHttpApp,
    createShutdown,
    httpChannel,
    mcpChannel,
    oidc,
    staticTokens,
    webhookChannel,
} from '@chamvi/http';
import type { Authenticator } from '@chamvi/http';
import { serve } from 'routup';

/** `verifier`: an authup `TokenVerifier` in remote mode (with a `creator`), so tokens carry their grants. */
export function authenticators(verifier: ITokenVerifier): Authenticator[] {
    // #region auth
    const ciToken = process.env.CI_TOKEN;
    return [
        // CI and service accounts: tokens of at least 16 characters.
        // Static tokens go first: authup() in remote mode introspects every non-JWT bearer.
        ...(ciToken ?
            [staticTokens({
                tokens: [{
                    value: ciToken,
                    id: 'ci',
                    permissions: ['agent:deploy:run', 'run:read'],
                }],
            })] :
            []),
        // authup: grants come from global tokens, verified remotely
        authup({ verifier }),
        // GitHub Actions OIDC: the mapper decides which repository gets which grants
        oidc({
            issuers: [{
                id: 'github-actions',
                issuer: 'https://token.actions.githubusercontent.com',
                audience: 'chamvi',
            }],
            principal: ({ claims }) => (claims.repository === 'acme/infra' ?
                {
                    id: `gha:${String(claims.sub)}`,
                    kind: 'oidc',
                    permissions: ['agent:deploy:run'],
                } :
                undefined),
        }),
    ];
    // #endregion auth
}

export async function start(store: Stores, agents: Agent[], verifier: ITokenVerifier) {
    // #region app
    const auth = authenticators(verifier);
    // POST /channels/webhook/<agent><path>, authenticated with the same chain
    const webhooks = webhookChannel({ auth });
    const engine = new Engine({
        stores: store,
        agents,
        // the channels read the store, agents and clock from the engine
        channels: [httpChannel(), mcpChannel(), webhooks, cronChannel()],
    });

    let server: ReturnType<typeof serve> | undefined;
    const shutdown = createShutdown({
        engine,
        // the server is created after the app; the helper only calls close() at shutdown
        server: { close: async (force) => { await server?.close(force); } },
        readinessDelayMs: 5_000,
    });

    const app = createHttpApp({
        engine,
        auth,
        // the channels served at /channels/<name>
        channels: [webhooks],
        shutdown,
        basePath: '/api',
        // behind one reverse proxy: trust its X-Forwarded-For
        trustProxy: 1,
        cors: { origin: 'https://chamvi.example.com' },
    });

    // recovers runs, then starts every channel (the cron schedule among them)
    await engine.start();
    // srvx must not install its own signal handler
    server = serve(app, { port: 3000, gracefulShutdown: false });
    // #endregion app

    // #region shutdown
    // fail readiness, end streams, stop the channels, drain
    process.once('SIGTERM', () => {
        void shutdown.shutdown().then(() => process.exit(0));
    });
    // #endregion shutdown

    return {
        app,
        engine,
        shutdown,
    };
}

// #region mcp
// OpenClaw (or any MCP client) lists the app as a streamable HTTP server
export const mcpServers = {
    chamvi: {
        type: 'http',
        url: 'http://chamvi.agents.svc/api/mcp',
        headers: { Authorization: 'Bearer ${CHAMVI_TOKEN}' },
    },
};
// #endregion mcp

/** A client of the app above (`basePath: '/api'`): start a run with a file, then download what it stored. */
export async function startWithAttachment(token: string, png: Uint8Array) {
    // #region attachments
    const base = 'https://chamvi.example.com/api';
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    const started = await fetch(`${base}/agents/triage/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            payload: { issue: 43 },
            // at most 16, data as strict base64; the whole body stays within bodyLimit
            attachments: [{
                mediaType: 'image/png',
                filename: 'crash.png',
                data: Buffer.from(png).toString('base64'),
            }],
        }),
    });
    const { runId } = await started.json() as { runId: string };

    // metadata of the attachments and of every file a tool stored
    const listed = await fetch(`${base}/runs/${runId}/artifacts`, { headers });
    const { data } = await listed.json() as { data: Array<{ id: string; mediaType: string }> };

    // the bytes, served as a download with the stored media type
    const [first] = data;
    const file = first ? await fetch(`${base}/runs/${runId}/artifacts/${first.id}`, { headers }) : undefined;
    // #endregion attachments

    return file;
}
