import { Output } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { cron } from '@chamvi/channel-cron';
import { defineAgent, defineEffectTool, defineTool } from '@chamvi/core';
import { http } from '@chamvi/http';

declare const model: LanguageModel;
declare function renderChart(points: number[]): Promise<Uint8Array>;

// #region define
// defined once at module scope: each call gets its run's context
const lastReport = defineTool({
    description: 'Returns the date of the previous report.',
    inputSchema: z.object({}),
    execute: async (_input, { context }) => (await context.state.get<string>('lastReport')) ?? 'never',
});

const saveReport = defineTool({
    description: 'Remembers that a report was written now.',
    inputSchema: z.object({}),
    execute: async (_input, { context }) => {
        await context.state.set('lastReport', context.run.trigger.receivedAt.toISOString());
        return { saved: true };
    },
});

export const reporter = defineAgent({
    name: 'weekly-report',
    model,
    instructions: 'Summarize the open work items in the trigger payload.',
    channels: [
        http.on(),
        cron.on('0 8 * * 1', { timezone: 'Europe/Berlin' }),
    ],
    budget: {
        maxSteps: 10,
        maxTokens: 50_000,
        timeoutMs: 5 * 60 * 1000,
    },
    tools: { lastReport, saveReport },
});
// #endregion define

export function inspectDefaults() {
    // #region defaults
    const agent = defineAgent({
        name: 'echo',
        model,
        instructions: 'Repeat the payload.',
    });

    agent.name; // 'echo'
    agent.definition.budget; // { maxSteps: 20, timeoutMs: 900_000 }
    // #endregion defaults

    return agent;
}

export function createLabeler() {
    // #region output
    const labeler = defineAgent({
        name: 'labeler',
        model,
        instructions: 'Label the issue in the trigger payload.',
        channels: [http.on()],
        // run.output is { label, reason } instead of the final text
        output: Output.object({
            schema: z.object({
                label: z.enum(['bug', 'feature', 'question']),
                reason: z.string(),
            }),
        }),
    });
    // #endregion output

    return labeler;
}

// #region artifacts
// an effect tool: a recovered run does not store the chart twice
const saveChart = defineEffectTool({
    description: 'Renders the points as a PNG chart and repositories it with the run.',
    inputSchema: z.object({ points: z.array(z.number()) }),
    execute: async ({ points }, { context }) => {
        const artifact = await context.artifacts.put({
            mediaType: 'image/png',
            filename: 'chart.png',
            data: await renderChart(points),
        });
        return { artifactId: artifact.id };
    },
});

export const charter = defineAgent({
    name: 'charter',
    model,
    instructions: 'Chart the numbers in the attached CSV.',
    channels: [http.on()],
    tools: { saveChart },
});
// #endregion artifacts
