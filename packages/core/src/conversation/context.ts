/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Run, RunContext } from '../run/types.ts';
import { ConversationOperation } from './constants.ts';
import type { ConversationBinding, IConversations } from './types.ts';

const executions = new WeakMap<RunContext, {
    capability: IConversations;
    run: Run;
    binding: ConversationBinding
}>();

export function bindConversationRun(context: RunContext, capability: IConversations, run: Run): void {
    if (!run.conversation) {
        return;
    }

    executions.set(context, {
        capability,
        run: structuredClone(run),
        binding: structuredClone(run.conversation),
    });
}

export function conversationFor(context: RunContext) {
    return executions.get(context);
}

export async function checkConversation(context: RunContext, operation: `${ConversationOperation.RECALL | ConversationOperation.NOTES}` = ConversationOperation.RECALL): Promise<void> {
    const bound = executions.get(context);

    if (!bound) {
        return;
    }

    await bound.capability.check(bound.run, operation);
}
