/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type {
    ChannelContext,
    ConversationTarget,
    IChannel,
    IClock,
    Invoker,
} from '@chamvi/core';
import type { Chat } from 'chat';
import type { ChatIncoming, ChatIngress } from '../ingress/types.ts';
import type { ChatSubscriber } from '../subscription/types.ts';

/** How a message reached the bot: a direct chat, a mention in a group, any other group message. */
export type ChatEvent = 'direct' | 'mention' | 'message';

/** The envelope payload of a run a chat channel started; no raw provider object. */
export type ChatPayload = {
    adapter: string;
    event: ChatEvent;
    threadId: string;
    channelId: string;
    message: {
        id: string;
        text: string;
        author: { id: string; name?: string };
        sentAt?: string;
    };
};

/** What approvalUrl() gets: ids only, never a token. */
export type ChatApprovalRef = {
    runId: string;
    approvalId: string;
    agent: string;
};

export type ChatChannelOptions = {
    /** The Chat the adapters are registered with; the channel owns it alone. */
    chat: Chat;
    /** The wrapped adapters of createChatIngressAdapter(), each registered with `chat` under its name. */
    adapters: readonly ChatIngress[];
    /** Default `chat`. */
    name?: string;
    /**
     * The adapters (names of `adapters`) whose platform posts webhooks to
     * `POST /channels/<name>/<adapter>` (the http app's channel mount);
     * none by default, and without any the channel has no `in`. Each adapter
     * verifies its own requests (handleWebhook); GET challenges are not
     * served.
     */
    webhooks?: readonly string[];
    /**
     * The address emit()/approve() use without one off the source channel.
     * Not set by default: it is an ungated destination for a tainted run.
     */
    defaultAddress?: string;
    /**
     * Default true: every run the channel starts is tainted
     * (`channel:<name>`). Set false only for a fully trusted private deployment.
     */
    untrusted?: boolean;
    /**
     * The operator's non-secret alias of the account the bot uses (the
     * conversation account); default the adapter's name.
     */
    account?: string;
    /**
     * Called on start after the Chat initialized, e.g. to open a socket. It
     * must settle once `signal` aborts (a stop during the start): stop waits
     * for it before `disconnect`, and the start then rejects with the
     * signal's reason whether it resolved or rejected.
     */
    connect?: (ctx: { signal: AbortSignal; clock: IClock }) => Promise<void>;
    /** Called on stop (and after a failed start) before the Chat shuts down. */
    disconnect?: () => Promise<void>;
    /** Decides whether a message may start runs at all; required for every adapter. */
    allowMessage: (incoming: ChatIncoming) => boolean | Promise<boolean>;
    /** The invoker of the runs a message starts; none by default. */
    resolveInvoker?: (incoming: ChatIncoming) => Invoker | undefined | Promise<Invoker | undefined>;
    /**
     * The approval link in approval messages (ids only, an absolute http(s)
     * URL without credentials); required to send an approval, since an
     * approval is answered in the UI only.
     */
    approvalUrl?: (ref: ChatApprovalRef) => string;
    /** Platform-fetched history; only 0 (none) for now. */
    history?: 0;
    /** Bound of one outbound send; default `CHAT_TIMEOUT_MS` (30 s). */
    timeoutMs?: number;
    /** Failures nobody awaits (refused and failed messages, stop); default console.error. */
    onError?: (error: unknown) => void;
};

export type ChatChannel = IChannel & ChatSubscriber;

/** The options after resolveOptions() (internal). */
export type ResolvedChatChannelOptions = {
    chat: Chat;
    adapters: readonly ChatIngress[];
    adapterNames: readonly string[];
    name: string;
    webhooks: readonly string[];
    defaultAddress?: string;
    untrusted: boolean;
    account?: string;
    connect?: ChatChannelOptions['connect'];
    disconnect?: ChatChannelOptions['disconnect'];
    allowMessage: ChatChannelOptions['allowMessage'];
    resolveInvoker?: ChatChannelOptions['resolveInvoker'];
    approvalUrl?: ChatChannelOptions['approvalUrl'];
    timeoutMs: number;
    onError: (error: unknown) => void;
    /** see ChatChannelHooks */
    conversationTarget?: ChatChannelHooks['conversationTarget'];
};

/**
 * What a transport package built on the channel adds (internal: the /baileys
 * entry); a plain chatChannel() has none.
 */
export type ChatChannelHooks = {
    /** Whether the transport is connected; the channel sends only while it is started and this holds. */
    online?: () => boolean;
    /**
     * Prepares one send before the channel's online check: throws for a
     * target the transport refuses (its error as is), else returns the post
     * the sender waits for (its failure a `chat_request`). Default the
     * adapter's `postMessage(threadId, { raw: text })`.
     */
    prepare?: (input: {
        adapter: string;
        threadId: string;
        text: string;
        key: string
    }) => () => Promise<unknown>;
    /**
     * The conversation of a message for an agent with `conversation`: undefined
     * refuses the dispatch of that agent. Default from the payload (the
     * account alias, the thread, `direct:<author>` or `group:<channel>`).
     */
    conversationTarget?: (incoming: ChatIncoming, payload: ChatPayload) => ConversationTarget | undefined;
};

/** What the intake of one message gets besides the message (internal). */
export type ChatIntakeContext = {
    context: ChannelContext;
    /** Aborts when the channel stops. */
    signal: AbortSignal;
    options: ResolvedChatChannelOptions;
};

/** Accepts one incoming message: resolves once it is durably accepted (internal). */
export type ChatIntake = (incoming: ChatIncoming, ctx: ChatIntakeContext) => Promise<void>;
