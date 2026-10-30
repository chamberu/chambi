import type { LanguageModel } from 'ai';
import { z } from 'zod';
import {
    Engine,
    consoleChannel,
    createMemoryStore,
    defineAgent,
    defineEffectTool,
} from '@chamvi/core';

export async function triageIssue(model: LanguageModel) {
    const labels: string[] = [];
    const lines: string[] = [];

    const triage = defineAgent({
        name: 'triage',
        model,
        instructions: 'Label the issue in the trigger payload as bug, feature or question.',
        budget: { maxSteps: 5 },
        tools: {
            // the result is recorded per (run, tool, input): a resumed run reuses it
            addLabel: defineEffectTool({
                description: 'Adds a label to the issue.',
                inputSchema: z.object({ label: z.enum(['bug', 'feature', 'question']) }),
                execute: async ({ label }, { context }) => {
                    labels.push(label);
                    // answers where the run came from, at most once per message
                    await context.channels.findOne()?.emit({ body: `Labelled as ${label}.` });
                    return { added: label };
                },
            }),
        },
    });

    const engine = new Engine({
        store: createMemoryStore(),
        agents: [triage],
        channels: [consoleChannel({
            write: (line) => {
                lines.push(line);
            },
        })],
    });
    await engine.start();

    const { runId } = await engine.dispatch({
        agent: 'triage',
        trigger: 'manual',
        channel: 'console',
        address: 'issue-1',
        payload: { title: 'App crashes on start' },
    });

    await engine.idle();
    await engine.stop();

    return {
        run: await engine.getRun(runId),
        labels,
        lines,
    };
}
