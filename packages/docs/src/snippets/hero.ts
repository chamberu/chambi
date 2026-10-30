import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { cron } from '@chamvi/channel-cron';
import {
    ToolDeniedError,
    defineAgent,
    defineEffectTool,
    defineTool,
} from '@chamvi/core';
import { webhook } from '@chamvi/http';

declare const model: LanguageModel;
declare function addLabel(issue: number, label: string): Promise<void>;
declare function closeIssue(issue: number): Promise<void>;

// #region agent
export const triage = defineAgent({
    name: 'triage',
    model,
    instructions: 'Label new issues and close duplicates.',
    channels: [
        webhook.on('/issues'),
        cron.on('0 * * * *'),
    ],
    tools: {
        // recorded per effect key: retries never relabel
        label: defineEffectTool({
            description: 'Adds a label to an issue.',
            inputSchema: z.object({
                issue: z.number(),
                label: z.string(),
            }),
            execute: async (i) => addLabel(i.issue, i.label),
        }),
        close: defineTool({
            description: 'Closes an issue as a duplicate.',
            inputSchema: z.object({ issue: z.number() }),
            execute: async ({ issue }, { context }) => {
                // waits in `waiting` until the owner signs off, across restarts
                const { approved } = await context.channels.findOneOrFail('owner')
                    .approve({ title: `Close #${issue}?`, address: 'ops' });

                if (!approved) {
                    throw new ToolDeniedError('The owner keeps it open.');
                }

                return closeIssue(issue);
            },
        }),
    },
});
// #endregion agent
