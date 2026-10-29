import type { LanguageModel } from 'ai';
import { z } from 'zod';
import {
    Engine,
    createMemoryRepositories,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import { openclawChannel } from '@chamvi/channel-openclaw';
import type { OpenclawChannelOptions } from '@chamvi/channel-openclaw';

export function createApprovalEngine(
    model: LanguageModel,
    options: Pick<OpenclawChannelOptions, 'fetch' | 'clock'> = {},
): Engine {
    const {
        OPENCLAW_URL,
        OPENCLAW_HOOKS_TOKEN,
        OPENCLAW_CHANNEL,
        OPENCLAW_TO,
        APP_URL,
    } = process.env;
    if (!OPENCLAW_URL || !OPENCLAW_HOOKS_TOKEN || !OPENCLAW_CHANNEL || !OPENCLAW_TO || !APP_URL) {
        throw new Error('Set OPENCLAW_URL, OPENCLAW_HOOKS_TOKEN, OPENCLAW_CHANNEL, OPENCLAW_TO and APP_URL.');
    }

    const openclaw = openclawChannel({
        baseUrl: OPENCLAW_URL,
        // OpenClaw's hooks.token, not the gateway token
        hooksToken: OPENCLAW_HOOKS_TOKEN,
        deliver: { channel: OPENCLAW_CHANNEL, to: OPENCLAW_TO },
        // a link to the approval in the chamvi UI, without the token
        approvalUrl: ({ runId, approvalId }) => `${APP_URL}/ui/approvals?run=${encodeURIComponent(runId)}&approval=${encodeURIComponent(approvalId)}`,
        ...options,
    });

    const deploy = defineTool({
        description: 'Deploy the current release to an environment.',
        inputSchema: z.object({ env: z.enum(['staging', 'prod']) }),
        execute: async ({ env }, { context }) => {
            // every deploy waits for the owner, who is asked in their chat
            const { approved } = await context.channels.findOneOrFail('openclaw').approve({
                title: `Deploy to ${env}?`,
                body: 'The current release goes out now.',
                address: OPENCLAW_TO,
            });
            return approved ? `deployed to ${env}` : 'the owner said no';
        },
    });

    const deployer = defineAgent({
        name: 'deployer',
        model,
        instructions: 'Deploy the release the user asks for.',
        tools: { deploy },
    });

    return new Engine({
        repositories: createMemoryRepositories({ clock: options.clock }),
        agents: [deployer],
        channels: [openclaw],
        clock: options.clock,
    });
}
