import type { LanguageModel } from 'ai';
import type { IStore } from '@chamvi/core';
import {
    Engine,
    ToolDeniedError,
    approve,
    defineAgent,
} from '@chamvi/core';
import { http, httpChannel } from '@chamvi/http';
import { codingTools } from '@chamvi/coding';
import { githubAppCredentials } from '@chamvi/github';
import type { IGithubApp } from '@chamvi/github';
import { createWorkspaceManager, staticGitCredentials } from '@chamvi/sandbox';
import type { ISandboxProvider } from '@chamvi/sandbox';
import { createLocalSandbox } from '@chamvi/sandbox-local';

export async function serve(store: IStore, model: LanguageModel, provider: ISandboxProvider) {
    // #region setup
    const workspaces = createWorkspaceManager({
        provider,
        // only your own repositories; the model cannot clone anything else
        allowRepo: (url) => url.startsWith('https://github.com/acme/'),
        limits: { maxLifetimeMs: 20 * 60_000 },
    });

    const repro = defineAgent({
        name: 'repro',
        model,
        instructions: 'Check out the repository from the payload, write a failing test for the reported bug, ' +
            'run it and answer with the output and the diff.',
        channels: [http.on()],
        tools: { ...workspaces.tools(), ...codingTools(workspaces) },
        hooks: {
            // the coding tools are not yours: gate bash here, every command waits for a human
            async beforeToolExecution({ toolName, input }, ctx) {
                if (toolName !== 'bash') return input;
                const { command } = input as { command: string };
                const decision = await approve(ctx, { title: 'Run a shell command?', body: command });
                if (!decision.approved) throw new ToolDeniedError(`Command refused: ${decision.reason ?? 'denied'}`);
                return input;
            },
        },
    });

    const engine = new Engine({
        store,
        agents: [repro],
        channels: [httpChannel()],
    });
    // a run's workspaces go once it completed, failed or was cancelled
    workspaces.attach(engine);
    await engine.start();

    process.once('SIGTERM', async () => {
        await engine.drain({ timeoutMs: 25_000 });
        // after the drain: runs still executing keep their workspaces until then
        await workspaces.close();
        process.exit(0);
    });
    // #endregion setup

    return { engine, workspaces };
}

export function development() {
    // #region local
    // no isolation: commands run as your user in a temporary directory
    const workspaces = createWorkspaceManager({
        provider: createLocalSandbox(),
        // local fixtures as file:///absolute/path repositories
        allowFileRepos: true,
    });
    // #endregion local

    return workspaces;
}

export async function privateRepositories(provider: ISandboxProvider, app: IGithubApp) {
    // #region credentials
    const workspaces = createWorkspaceManager({
        provider,
        credentials: [
            // a GitLab project token for one group
            staticGitCredentials([{ host: 'gitlab.example.com', path: 'platform', token: process.env.GITLAB_TOKEN! }]),
            // the GitHub App's repository-scoped tokens, allowed to touch workflows
            githubAppCredentials(app, { permissions: { workflows: 'write' } }),
        ],
        // default 'workspace': plain git in bash works, tokens redacted from every result
        credentialMode: 'workspace',
        author: await app.botIdentity(),
        push: { mode: 'approve', allowForce: true },
    });
    // #endregion credentials

    return workspaces;
}
