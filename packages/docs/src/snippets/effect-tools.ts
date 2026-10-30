import type { LanguageModel } from 'ai';
import { z } from 'zod';
import {
    defineAgent,
    defineEffectTool,
    effectMarker,
} from '@chamvi/core';

interface IComment {
    id: number;
    url: string;
}

declare const model: LanguageModel;
declare function findComment(issue: number, marker: string): Promise<IComment | undefined>;
declare function postComment(issue: number, body: string): Promise<IComment>;

// #region reconcile
const comment = defineEffectTool({
    description: 'Posts a comment on the issue.',
    inputSchema: z.object({ issue: z.number(), body: z.string() }),
    // one comment per run and issue, whatever the body says
    effectKey: ({ issue }, ctx) => `${ctx.run.runId}:comment:${issue}`,
    // finds a comment an earlier, crashed attempt already posted
    alreadyApplied: async (key, { issue }) => findComment(issue, effectMarker(key)),
    execute: async ({ issue, body }, { context }) => postComment(
        issue,
        `${body}\n${effectMarker(`${context.run.runId}:comment:${issue}`)}`,
    ),
});

export const responder = defineAgent({
    name: 'responder',
    model,
    instructions: 'Answer new issues.',
    tools: { comment },
});
// #endregion reconcile
