/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ChannelDispatchEnvelope, DispatchResult, IChannel } from '../channel/types.ts';
import type { Engine } from '../engine/module.ts';
import { ValidationError } from '../errors/index.ts';
import type { Run, RunContext } from '../run/types.ts';
import { ConversationOperation } from './constants.ts';
import type { Conversations } from './module.ts';
import type { ConversationBinding, ConversationTarget } from './types.ts';

type Intake = (channel: Pick<IChannel, 'name'>, envelope: ChannelDispatchEnvelope, target: ConversationTarget) => Promise<DispatchResult>;
const intake = new WeakMap<Engine, Intake>();
const executions = new WeakMap<RunContext, {
    capability: Conversations;
    run: Run;
    binding: ConversationBinding
}>();

export function bindConversationRun(context: RunContext, capability: Conversations, run: Run): void {
    if (!run.conversation) return;
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
    if (!bound) return;
    await bound.capability.check(bound.run, operation);
}

export function bindConversationIntake(engine: Engine, dispatch: Intake): void {
    intake.set(engine, dispatch);
}

export function dispatchConversation(engine: Engine, channel: Pick<IChannel, 'name'>, envelope: ChannelDispatchEnvelope, target: ConversationTarget): Promise<DispatchResult> {
    const dispatch = intake.get(engine);
    if (!dispatch) return Promise.reject(new ValidationError('Conversation intake is unavailable.'));
    return dispatch(channel, envelope, target);
}
