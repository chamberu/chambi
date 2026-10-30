import type { LanguageModel } from 'ai';
import { z } from 'zod';
import {
    Engine,
    agentChannel,
    createMemoryStore,
    defineAgent,
    defineTool,
    handoff,
    startHandoff,
} from '@chamvi/core';
import { cron, cronChannel } from '@chamvi/channel-cron';

declare const model: LanguageModel;

// #region tool
const handOffPr = defineTool({
    description: 'Starts a run of its own for one pull request that needs work.',
    inputSchema: z.object({ pr: z.string().describe('owner/repo#number') }),
    execute: async ({ pr }, { context }) => {
        // the day the daily run was fired, not the wall clock: a redo keeps the key
        const day = context.run.trigger.receivedAt.toISOString().slice(0, 10);

        return startHandoff(context, {
            payload: { pr },
            idempotencyKey: `${pr}@${day}`,
            address: pr,
        });
    },
});
// #endregion tool

// #region agent
const maintainer = defineAgent({
    name: 'maintainer',
    model,
    instructions: 'Every morning, hand off each pull request that needs work.',
    channels: [
        cron.on('0 6 * * *'),
        // the opt-in: runs of this agent may start runs of this agent
        handoff.on({
            schema: z.object({ pr: z.string() }),
            concurrencyKey: (p) => p.pr,
            maxPerRun: 20,
        }),
    ],
    tools: { hand_off_pr: handOffPr },
});
// #endregion agent

// #region engine
export const engine = new Engine({
    store: createMemoryStore(),
    agents: [maintainer],
    // a bare engine lists the agent channel; @chamvi/app contributes it
    channels: [cronChannel(), agentChannel()],
});
// #endregion engine
