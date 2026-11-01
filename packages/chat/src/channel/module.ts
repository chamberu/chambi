/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ChamviError, InvalidRunStateError } from '@chamvi/core';
import type { ChannelContext, ChannelRequest } from '@chamvi/core';
import { createChatIntake } from '../intake/module.ts';
import { bindIngress } from '../ingress/module.ts';
import type { ChatIncoming, IChatReceiver } from '../ingress/types.ts';
import { createChatSubscription } from '../subscription/module.ts';
import { createChatSender } from '../outbound/module.ts';
import {
    encodeChatAddress,
    markChatChannel,
    reportError,
    resolveOptions,
} from './helpers.ts';
import { CHAT_STOP_TIMEOUT_ERROR_CODE, CHAT_STOP_TIMEOUT_MS } from './constants.ts';
import type {
    ChatChannel,
    ChatChannelHooks,
    ChatChannelOptions,
    ChatIntake,
    ResolvedChatChannelOptions,
} from './types.ts';
import { receiveWebhook } from './webhook.ts';

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
    /** the intake tasks already tracked: deliveries sharing one task report its failure once */
    readonly tasks: WeakSet<Promise<void>>;
    accepting: boolean;
    /** connected: the start's own work succeeded and no stop began; sends need it */
    online: boolean;
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

            let task: Promise<void>;

            try {
                task = intake(incoming, {
                    context: run.context,
                    signal: run.controller.signal,
                    options,
                });
            } catch (error) {
                task = Promise.reject(error);
            }

            // a second delivery of a message the intake is still accepting shares its task
            if (run.tasks.has(task)) {
                return task;
            }

            run.tasks.add(task);
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
    run.online = false;
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
 * `in` (receiveWebhook(), only with `webhooks`) hands the webhook requests of
 * those adapters to them at `/channels/<name>/<adapter>` and answers once
 * the messages they carried are accepted (503 when not).
 *
 * `out` (createChatSender()) posts to the chat an address names, at least
 * once and only while the channel is started: before `start` finished and
 * from `stop` on it sends nothing (`chat_request`). Approvals go out as a
 * link of `approvalUrl` (required for them), never as buttons.
 *
 * Runs it starts are untrusted unless `untrusted: false`. Only incoming
 * messages reach chamvi: the Chat has no handlers of chamvi's, so an action
 * (a button) or any other event the adapter forwards answers nothing and
 * never answers an approval.
 */
export function createChatChannel(options: ChatChannelOptions, intake: ChatIntake, hooks: ChatChannelHooks = {}): ChatChannel {
    const resolved: ResolvedChatChannelOptions = {
        ...resolveOptions(options),
        ...(hooks.conversationTarget ? { conversationTarget: hooks.conversationTarget } : {}),
    };
    const { name, adapterNames } = resolved;
    let current: ChatRun | undefined;
    const out = createChatSender({
        name,
        adapters: resolved.adapters,
        ...(resolved.approvalUrl ? { approvalUrl: resolved.approvalUrl } : {}),
        timeoutMs: resolved.timeoutMs,
        // started, and connected as far as the transport knows
        online: () => (current?.online && (hooks.online?.() ?? true) ? current.context.engine.clock : undefined),
        ...(hooks.prepare ? { prepare: hooks.prepare } : {}),
        onError: resolved.onError,
    });

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
            tasks: new WeakSet(),
            accepting: true,
            online: false,
            disposers: [],
        };

        current = run;

        run.body = (async () => {
            const receiver = createReceiver(run, resolved, intake);

            // bound before the adapters initialize, so their first message has a receiver
            for (const adapter of resolved.adapters) {
                run.disposers.push(bindIngress(adapter, receiver, (error) => reportError(resolved, error)));
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
            run.online = true;

            return;
        }

        // stopped while starting: the stop's teardown finishes before the start answers
        await teardown(run, resolved);

        throw run.controller.signal.reason;
    };

    return markChatChannel({
        name,
        untrusted: resolved.untrusted,
        ...(resolved.defaultAddress !== undefined ? { defaultAddress: resolved.defaultAddress } : {}),
        // only webhook adapters take requests: a socket transport has no in
        ...(resolved.webhooks.length > 0 ? { in: (input: ChannelRequest, ctx: ChannelContext) => receiveWebhook(input, ctx, resolved) } : {}),
        start,
        stop: async () => {
            if (current) {
                await teardown(current, resolved);
            }
        },
        out,
        on: (subscriptionOptions) => createChatSubscription(name, subscriptionOptions, adapterNames),
        to: (target) => encodeChatAddress(target, adapterNames),
    });
}

/**
 * A chat channel over a Chat SDK `Chat` whose adapters are wrapped by
 * createChatIngressAdapter(). See createChatChannel() for the lifecycle and
 * createChatIntake() for what a message must pass to start runs.
 * Throws InvalidAgentDefinitionError for an invalid option.
 */
export function chatChannel(options: ChatChannelOptions): ChatChannel {
    return createChatChannel(options, createChatIntake());
}
