/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type {
    AuthenticationState,
    BaileysEventMap,
    Contact,
    SocketConfig,
    UserFacingSocketConfig,
    WAMessage,
} from 'baileys';
import type { IClock, Invoker } from '@chamvi/core';
import type {
    Adapter,
    Chat,
    Logger,
    Message,
    RawMessage,
    StateAdapter,
} from 'chat';
import type { ChatApprovalRef, ChatChannel } from '../channel/types.ts';
import type { ChatIngress } from '../ingress/types.ts';

/**
 * The persisted WhatsApp session one connector holds while it runs. The
 * provider owns storage, its atomicity and the exclusivity of the location:
 * a second holder must be refused by `acquire`. chamvi calls `saveCreds`
 * and the key store's methods only while the lease is in use (a generation
 * guard refuses later calls), then `flush` once no write is pending, then
 * `release`.
 */
export type WhatsAppAuthLease = {
    /**
     * The loaded creds (Baileys mutates the object in place, `saveCreds`
     * persists it) and the signal key store (`get`, `set`, optional `clear`;
     * Baileys adds its own transaction buffer over these, so a provider's own
     * `transaction` is not called).
     */
    auth: AuthenticationState;
    /** Persists `auth.creds` as it is now; serialized with the key writes. */
    saveCreds(): Promise<void>;
    /** Resolves once every write the lease accepted is durable. */
    flush(): Promise<void>;
    /** Gives the location up for another holder; called after `flush`. */
    release(): Promise<void>;
};

/** Hands out the session lease; caller-supplied, chamvi ships no production provider. */
export interface IWhatsAppAuthProvider {
    /**
     * Loads the session and takes the location exclusively; rejects when
     * another holder has it. Should settle soon after `signal` aborts; a
     * lease handed out after the abort is released at once.
     */
    acquire(signal: AbortSignal): Promise<WhatsAppAuthLease>;
}

/** Who may start runs: normalized platform ids (jids), never names. */
export type WhatsAppPolicy = {
    /** Phone number jids (`<digits>@s.whatsapp.net`) allowed to write, directly and in an allowed group. */
    senders: readonly string[];
    /** Group jids (`<id>@g.us`) whose messages may start runs; none by default. */
    groups?: readonly string[];
    /** A group message needs to mention the bot; default true. */
    requireGroupMention?: boolean;
} | {
    /** Any resolved sender; `resolveInvoker` still decides who runs (undefined denies). */
    open: true;
    groups?: readonly string[];
    requireGroupMention?: boolean;
};

/** The authenticated identity of one incoming message, as the policy and resolveInvoker see it. */
export type WhatsAppIdentity = {
    /** The operator's account alias. */
    account: string;
    /** The chat: the sender's phone number jid for a direct chat, the group jid for a group. */
    chat: string;
    /** The sender's phone number jid, device suffix removed (a LID only through an authenticated mapping). */
    sender: string;
    group: boolean;
    /** A group message that mentions the bot. */
    mentioned: boolean;
};

/** Pairing material, secret: it reaches onPairing only, never a log or onError. */
export type WhatsAppPairing = {
    /** The QR reference to render for the phone to scan (it rotates). */
    qr: string;
};

/** What the connection is, from Baileys' connection events only. */
export type WhatsAppConnectionStatus = 'stopped' | 'connecting' | 'connected' | 'disconnected' | 'logged-out';

/** The members of a Baileys socket chamvi uses (a WASocket is one). */
export type WhatsAppSocket = {
    readonly ev: {
        on<T extends keyof BaileysEventMap>(event: T, listener: (arg: BaileysEventMap[T]) => void): void;
        off<T extends keyof BaileysEventMap>(event: T, listener: (arg: BaileysEventMap[T]) => void): void;
    };
    readonly user?: Contact | undefined;
    readonly signalRepository?: {
        readonly lidMapping: {
            getPNForLID(lid: string): Promise<string | null>;
        };
    };
    end(error: Error | undefined): Promise<void> | void;
    sendMessage(jid: string, content: { text: string }, options?: { messageId?: string }): Promise<WAMessage | undefined>;
};

/** Makes a socket; default Baileys' makeWASocket. */
export type WhatsAppSocketFactory = (config: UserFacingSocketConfig) => WhatsAppSocket;

export type WhatsAppChatOptions = {
    /** The operator's non-secret alias of the WhatsApp account (the conversation account). */
    account: string;
    /** The session store; see IWhatsAppAuthProvider. */
    auth: IWhatsAppAuthProvider;
    /** Who may start runs; unknown senders are denied. */
    policy: WhatsAppPolicy;
    /** The invoker of an allowed message's runs; undefined denies the message. */
    resolveInvoker: (identity: WhatsAppIdentity) => Invoker | undefined | Promise<Invoker | undefined>;
    /** The Chat SDK state adapter of the Chat. */
    state: StateAdapter;
    /** The approval link (ids only); approvals are answered in the UI. */
    approvalUrl: (ref: ChatApprovalRef) => string;
    /** Receives pairing material (a QR) while the account is not paired. */
    onPairing: (pairing: WhatsAppPairing) => void;
    /** Default `chat`. */
    name?: string;
    /** Default true (runs are tainted). */
    untrusted?: boolean;
    /** Bound of one send; default `CHAT_TIMEOUT_MS`. */
    timeoutMs?: number;
    /** The connector's clock (reconnect backoff, shutdown bound); default the engine's. */
    clock?: IClock;
    /** Failures nobody awaits; default console.error. Never gets pairing material. */
    onError?: (error: unknown) => void;
    /** The Chat SDK logger; default level `warn`. Baileys itself logs nothing. */
    logger?: Logger;
    /** The Chat's bot user name; default `chamvi`. */
    userName?: string;
    /** Further Baileys socket settings (e.g. `version`, `browser`); auth and logger are chamvi's. */
    socketOptions?: Omit<Partial<SocketConfig>, 'auth' | 'logger'>;
    /** Makes the socket; default Baileys' makeWASocket (tests pass a fake). */
    socketFactory?: WhatsAppSocketFactory;
};

export type WhatsAppChatSetup = {
    chat: Chat;
    ingress: ChatIngress;
    channel: ChatChannel;
    status(): WhatsAppConnectionStatus;
};

/** The checked policy (internal). */
export type ResolvedWhatsAppPolicy = {
    /** undefined: open (resolveInvoker decides) */
    senders?: ReadonlySet<string>;
    groups: ReadonlySet<string>;
    requireGroupMention: boolean;
};

/** What the connection needs (internal). */
export type WhatsAppConnectionOptions = {
    auth: IWhatsAppAuthProvider;
    socketFactory: WhatsAppSocketFactory;
    socketOptions?: WhatsAppChatOptions['socketOptions'];
    onPairing: (pairing: WhatsAppPairing) => void;
    onError: (error: unknown) => void;
    clock?: IClock;
    /** a batch of messages of the current socket */
    onMessages: (socket: WhatsAppSocket, upsert: BaileysEventMap['messages.upsert']) => void;
};

/** One connected session: a lease, its sockets one after the other, then a close (internal). */
export type WhatsAppConnection = {
    status(): WhatsAppConnectionStatus;
    /** the socket of an open connection, else undefined */
    socket(): WhatsAppSocket | undefined;
    connect(ctx: { signal: AbortSignal; clock: IClock }): Promise<void>;
    close(): Promise<void>;
};

/** What the adapter needs (internal). */
export type WhatsAppAdapterOptions = Omit<WhatsAppConnectionOptions, 'onMessages'> & {
    account: string;
    userName: string;
};

/** The Chat SDK adapter over one WhatsApp connection (internal). */
export type WhatsAppAdapter = Adapter<string, unknown> & {
    readonly connection: WhatsAppConnection;
    /** the authenticated identity of a message this adapter handed over, undefined when unresolved */
    identityOf(message: Message): WhatsAppIdentity | undefined;
    /** one text send, optionally under a caller message id */
    send(threadId: string, text: string, messageId?: string): Promise<RawMessage<unknown>>;
};
