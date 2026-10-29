import { z } from 'zod';
import { openclawChannel } from '@chamvi/channel-openclaw';
import {
    Engine,
    createMemoryStores,
    defineTool,
} from '@chamvi/core';
import type { Agent } from '@chamvi/core';

export function createEngine(agents: Agent[]) {
    // #region channel
    const openclaw = openclawChannel({
        // the OpenClaw gateway, reachable from the app
        baseUrl: 'http://openclaw:18789',
        // OpenClaw's hooks.token, not the gateway token
        hooksToken: process.env.OPENCLAW_HOOKS_TOKEN ?? '',
        // placeholders: the channel and recipient of your OpenClaw setup
        deliver: { channel: '<channel>', to: '<recipient>' },
        // optional: a link to the approval in the UI; a message never carries the token
        approvalUrl: ({ runId, approvalId }) => `https://chamvi.example/ui/approvals?run=${encodeURIComponent(runId)}&approval=${encodeURIComponent(approvalId)}`,
    });

    const engine = new Engine({
        stores: createMemoryStores(),
        agents,
        // tools reach it with ctx.channels.findOneOrFail('openclaw')
        channels: [openclaw],
    });
    // #endregion channel
    return engine;
}

// #region tool
export const deploy = defineTool({
    description: 'Deploy the current release.',
    inputSchema: z.object({ env: z.enum(['staging', 'prod']) }),
    execute: async ({ env }, { context }) => {
        const openclaw = context.channels.findOneOrFail('openclaw');
        // without an address both go to deliver.to (the channel's defaultAddress)
        const { approved } = await openclaw.approve({ title: `Deploy to ${env}?` });
        if (!approved) return 'the owner said no';
        await openclaw.emit({ body: `Deployed to ${env}.` });
        return `deployed to ${env}`;
    },
});
// #endregion tool
