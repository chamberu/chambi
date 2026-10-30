/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ChannelDispatchEnvelope, DispatchResult, IChannel } from '../channel/types.ts';
import type { IEngine } from '../engine/types.ts';
import { ValidationError } from '../errors/index.ts';
import type { Run, RunContext } from '../run/types.ts';
import { ConversationOperation } from './constants.ts';
import type { ConversationBinding, ConversationTarget, IConversations } from './types.ts';

type Intake = (channel: Pick<IChannel, 'name'>, envelope: ChannelDispatchEnvelope, target: ConversationTarget) => Promise<DispatchResult>;
const intake = new WeakMap<IEngine, Intake>();
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

export function bindConversationIntake(engine: IEngine, dispatch: Intake): void {
    intake.set(engine, dispatch);
}

export function dispatchConversation(engine: IEngine, channel: Pick<IChannel, 'name'>, envelope: ChannelDispatchEnvelope, target: ConversationTarget): Promise<DispatchResult> {
    const dispatch = intake.get(engine);

    if (!dispatch) {
        return Promise.reject(new ValidationError('Conversation intake is unavailable.'));
    }

    return dispatch(channel, envelope, target);
}
