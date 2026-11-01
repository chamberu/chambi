/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ChamviError, InvalidRunStateError } from '@chamvi/core';
import type { ChannelContext } from '@chamvi/core';
import { bindIngress } from '../ingress/module.ts';
import type { ChatIncoming, IChatReceiver } from '../ingress/types.ts';
import { createChatSubscription } from '../subscription/module.ts';
import { encodeChatAddress, reportError, resolveOptions } from './helpers.ts';
import { CHAT_STOP_TIMEOUT_ERROR_CODE, CHAT_STOP_TIMEOUT_MS } from './constants.ts';
import type {
    ChatChannel,
    ChatChannelOptions,
    ChatIntake,
    ResolvedChatChannelOptions,
} from './types.ts';

/**
 * One start of the channel. Nothing of it is cleared on stop: a message whose
 * intake outlived the stop timeout keeps its context, signal and options (a
 * cooperative abort cannot cancel a store write in flight); the next start
 * gets a new one.
 */
type ChatRun = {
    readonly context: ChannelContext;
    readonly controller: AbortController;
    readonly inFlight: Set<Promise<void>>;
    accepting: boolean;
    disposers: Array<() => void>;
    /** the start's own work (bind, initialize, connect), settled */
    body?: Promise<void>;
    teardown?: Promise<void>;
};

function createReceiver(
    run: ChatRun,
    options: ResolvedChatChannelOptions,
    intake: ChatIntake,
): IChatReceiver {
    return {
        receive(incoming: ChatIncoming): Promise<void> {
            if (!run.accepting) {
                const error = new InvalidRunStateError(`Chat channel "${options.name}" is not accepting messages.`);

                reportError(options, error);

                return Promise.reject(error);
            }

            const task = (async () => intake(incoming, {
                context: run.context,
                signal: run.controller.signal,
                options,
            }))();

            run.inFlight.add(task);

            // the one report of a failed message, whether its producer awaits it or not
            task.then(
                () => run.inFlight.delete(task),
                (error: unknown) => {
                    run.inFlight.delete(task);
                    reportError(options, error);
                },
            );

            return task;
        },
    };
}

/** Waits for the accepted messages, at most `CHAT_STOP_TIMEOUT_MS` on the engine's clock. */
async function waitInFlight(run: ChatRun, options: ResolvedChatChannelOptions): Promise<void> {
    if (run.inFlight.size === 0) {
        return;
    }

    const pending = [...run.inFlight];
    let timer: { clear(): void } | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
        timer = run.context.engine.clock.setTimeout(() => resolve(true), CHAT_STOP_TIMEOUT_MS);
    });

    const late = await Promise.race([
        Promise.allSettled(pending).then(() => false),
        timedOut,
    ]);

    timer?.clear();

    if (!late) {
        return;
    }

    const left = pending.filter((task) => run.inFlight.has(task)).length;

    reportError(options, new ChamviError({
        message: `Chat channel "${options.name}" stopped with ${left} message(s) still being accepted after ${CHAT_STOP_TIMEOUT_MS}ms.`,
        code: CHAT_STOP_TIMEOUT_ERROR_CODE,
    }));
}

async function runTeardown(run: ChatRun, options: ResolvedChatChannelOptions): Promise<void> {
    // admission closes first: a message from here on is refused, not half accepted
    run.accepting = false;
    run.controller.abort(new InvalidRunStateError(`Chat channel "${options.name}" stopped.`));

    // a start in flight finishes its own step first (its connect sees the abort)
    await run.body?.catch(() => undefined);

    if (options.disconnect) {
        try {
            await options.disconnect();
        } catch (error) {
            reportError(options, error);
        }
    }

    await waitInFlight(run, options);

    try {
        await options.chat.shutdown();
    } catch (error) {
        reportError(options, error);
    }

    for (const dispose of run.disposers) {
        dispose();
    }

    run.disposers = [];
}

function teardown(run: ChatRun, options: ResolvedChatChannelOptions): Promise<void> {
    run.teardown ??= runTeardown(run, options);

    return run.teardown;
}

/**
 * The channel of one Chat SDK `Chat` and its wrapped adapters. The factory
 * checks the options and claims the Chat and the adapters (no other channel
 * may take them); it initializes nothing. `start` binds the receivers, then
 * initializes the Chat (the adapters' initialize), then calls `connect`;
 * a failure there tears down like `stop` and rethrows. `stop` (idempotent)
 * refuses new messages, aborts the start's signal, calls `disconnect`,
 * waits for the messages already being accepted (at most 30 s on the
 * engine's clock, reporting what is left), then shuts the Chat down.
 *
 * Runs it starts are untrusted unless `untrusted: false`. Only incoming
 * messages reach chamvi: the Chat has no handlers of chamvi's, so an action
 * (a button) or any other event the adapter forwards answers nothing and
 * never answers an approval.
 */
export function createChatChannel(options: ChatChannelOptions, intake: ChatIntake): ChatChannel {
    const resolved = resolveOptions(options);
    const { name, adapterNames } = resolved;
    let current: ChatRun | undefined;

    const start = async (context: ChannelContext): Promise<void> => {
        if (current && !current.teardown) {
            throw new InvalidRunStateError(`Chat channel "${name}" is already started.`);
        }

        // a stop still settling finishes before the next start takes the Chat
        await current?.teardown;

        const run: ChatRun = {
            context,
            controller: new AbortController(),
            inFlight: new Set(),
            accepting: true,
            disposers: [],
        };

        current = run;

        run.body = (async () => {
            const receiver = createReceiver(run, resolved, intake);

            // bound before the adapters initialize, so their first message has a receiver
            for (const adapter of resolved.adapters) {
                run.disposers.push(bindIngress(adapter, receiver));
            }

            await resolved.chat.initialize();

            if (resolved.connect) {
                await resolved.connect({ signal: run.controller.signal, clock: context.engine.clock });
            }
        })();

        try {
            await run.body;
        } catch (error) {
            await teardown(run, resolved);

            throw error;
        }

        if (!run.controller.signal.aborted) {
            return;
        }

        // stopped while starting: the stop's teardown finishes before the start answers
        await teardown(run, resolved);

        throw run.controller.signal.reason;
    };

    return {
        name,
        untrusted: resolved.untrusted,
        ...(resolved.defaultAddress !== undefined ? { defaultAddress: resolved.defaultAddress } : {}),
        start,
        stop: async () => {
            if (current) {
                await teardown(current, resolved);
            }
        },
        on: (subscriptionOptions) => createChatSubscription(name, subscriptionOptions, adapterNames),
        to: (target) => encodeChatAddress(target, adapterNames),
    };
}

/** Refuses every message: the channel's intake is not wired. */
const refuseIntake: ChatIntake = async (incoming, { options }) => {
    throw new InvalidRunStateError(`Chat channel "${options.name}" accepts no message of adapter "${incoming.adapter.name}" yet.`);
};

/**
 * A chat channel over a Chat SDK `Chat` whose adapters are wrapped by
 * createChatIngressAdapter(). See createChatChannel() for the lifecycle.
 * Throws InvalidAgentDefinitionError for an invalid option.
 */
export function chatChannel(options: ChatChannelOptions): ChatChannel {
    return createChatChannel(options, refuseIntake);
}
