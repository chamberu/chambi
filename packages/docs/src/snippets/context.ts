import type { LanguageModel } from 'ai';
import { z } from 'zod';
import {
    Engine,
    createMemoryStore,
    defineAgent,
    defineContextKey,
    defineTool,
    inject,
    tryInject,
} from '@chamvi/core';

declare const model: LanguageModel;

// #region define
export interface IDeployClient {
    deploy(version: string, signal: AbortSignal): Promise<string>;
}

// a typed key, unique per call; the name only appears in error messages
export const DEPLOY = defineContextKey<IDeployClient>('deploy');
// #endregion define

declare const client: IDeployClient;
declare const auditLog: { write(line: string): void } | undefined;

// #region inject
// in execute: a missing value is a tool error the model sees
const deploy = defineTool({
    description: 'Deploys a version.',
    inputSchema: z.object({ version: z.string() }),
    execute: async ({ version }, { context }) => inject(context, DEPLOY).deploy(version, context.run.signal),
});

const AUDIT = defineContextKey<{ write(line: string): void }>('audit');

export const ops = defineAgent({
    name: 'ops',
    model,
    instructions: 'Operate the service.',
    // in the factory: tryInject reads an optional value (inject would fail the run before any model call)
    tools: (ctx) => {
        const audit = tryInject(ctx, AUDIT);
        audit?.write(`run ${ctx.run.runId} started`);
        return { deploy };
    },
});
// #endregion inject

// #region provide
const engine = new Engine({
    store: createMemoryStore(),
    agents: [ops],
});

// by reference, once per key; a second value or undefined throws
engine.provide(DEPLOY, client);
if (auditLog) engine.provide(AUDIT, auditLog);
// #endregion provide

export { engine };
