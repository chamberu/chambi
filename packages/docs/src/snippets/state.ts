import { tool } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import {
    ValidationError,
    createAgentState,
    createMemoryStores,
    defineAgent,
} from '@chamvi/core';

// #region schema
const loop = z.object({
    title: z.string(),
    status: z.enum(['open', 'resolved']),
    due: z.string().optional(),
});
// #endregion schema

export function createDigest(model: LanguageModel) {
    // #region agent
    const digest = defineAgent({
        name: 'digest',
        model,
        instructions: 'Track open loops across days.',
        state: { loops: loop },
        tools: ({ state }) => ({
            countOpenLoops: tool({
                description: 'Counts the open loops.',
                inputSchema: z.object({}),
                execute: async () => {
                    const open = await state.collection('loops').list({ where: { status: 'open' } });
                    return open.length;
                },
            }),
        }),
    });
    // #endregion agent

    return digest;
}

export async function stateOutsideARun() {
    // #region direct
    const store = createMemoryStores();
    const state = createAgentState('digest', { loops: loop }, store.state);

    await state.set('lastUid', 1042);
    await state.get<number>('lastUid'); // 1042

    const loops = state.collection('loops');
    await loops.upsert('reply-anna', { title: 'Reply to Anna', status: 'open' });
    await loops.list({ where: { status: 'open' }, limit: 10 });
    // [{ id: 'reply-anna', title: 'Reply to Anna', status: 'open' }]
    await loops.remove('reply-anna');
    // #endregion direct
}

export async function invalidDocument() {
    const state = createAgentState('digest', { loops: loop }, createMemoryStores().state);

    // #region invalid
    try {
        await state.collection('loops').upsert('x', { title: 'Call Bob', status: 'later' as 'open' });
    } catch (error) {
        if (error instanceof ValidationError) {
            for (const issue of error.issues) console.log(issue.path, issue.message);
        }
    }
    // #endregion invalid
}
