/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import {
    InvalidAgentDefinitionError,
    TRIGGER_KEY_MAX_LENGTH,
    ValidationError,
} from '@chamvi/core';
import { isObject } from 'smob';
import { isChatIngress } from '../ingress/module.ts';
import type { ChatIngress } from '../ingress/types.ts';
import type { ChatTarget } from '../subscription/types.ts';
import {
    CHANNEL_NAME_MAX_LENGTH,
    CHANNEL_NAME_PATTERN,
    CHAT_ADDRESS_PREFIX,
    CHAT_CHANNEL_NAME,
    CHAT_TIMEOUT_MS,
    TIMER_MAX_MS,
} from './constants.ts';
import type { ChatChannelOptions, ResolvedChatChannelOptions } from './types.ts';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

// the Chats and ingresses a channel owns: keyed by those objects, so nothing is held past them
const ownedChats = new WeakSet<object>();
const ownedIngresses = new WeakSet<object>();

// the channels chatChannel() made
const channels = new WeakSet<object>();

/** Marks a channel of chatChannel() (internal). */
export function markChatChannel<T extends object>(channel: T): T {
    channels.add(channel);

    return channel;
}

/** Whether `value` is a channel chatChannel() made (of this copy of the package). */
export function isChatChannel(value: unknown): boolean {
    return isObject(value) && channels.has(value);
}

function invalid(message: string): InvalidAgentDefinitionError {
    return new InvalidAgentDefinitionError(`chatChannel: ${message}`);
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && !value.includes('\0');
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function assertOptionalFunction(options: ChatChannelOptions, key: keyof ChatChannelOptions): void {
    if (options[key] !== undefined && typeof options[key] !== 'function') {
        throw invalid(`${key} must be a function.`);
    }
}

function assertAdapters(options: ChatChannelOptions): ChatIngress[] {
    const { chat, adapters } = options;

    if (!Array.isArray(adapters) || adapters.length === 0) {
        throw invalid('adapters must list at least one adapter of createChatIngressAdapter().');
    }

    const names = new Set<string>();

    for (const adapter of adapters) {
        if (!isChatIngress(adapter)) {
            throw invalid('every adapter must be wrapped by createChatIngressAdapter().');
        }

        const { name } = adapter;

        if (!isText(name)) {
            throw invalid('every adapter needs a name.');
        }

        if (names.has(name)) {
            throw invalid(`adapter "${name}" is listed twice.`);
        }

        names.add(name);

        if (chat.getAdapter(name) !== adapter) {
            throw invalid(`the chat's adapter "${name}" is not the wrapper listed in adapters; register the ingress with the Chat.`);
        }

        if (ownedIngresses.has(adapter)) {
            throw invalid(`adapter "${name}" belongs to another chat channel.`);
        }
    }

    return [...adapters];
}

function assertWebhooks(options: ChatChannelOptions, adapterNames: readonly string[]): string[] {
    const { webhooks } = options;

    if (webhooks === undefined) {
        return [];
    }

    if (!Array.isArray(webhooks)) {
        throw invalid('webhooks must list adapter names.');
    }

    const list: string[] = [];

    for (const name of webhooks) {
        if (typeof name !== 'string' || !adapterNames.includes(name)) {
            throw invalid('every entry of webhooks must name an adapter of adapters.');
        }

        if (list.includes(name)) {
            throw invalid(`webhooks lists adapter "${name}" twice.`);
        }

        list.push(name);
    }

    return list;
}

/**
 * Checks the options (InvalidAgentDefinitionError naming the option) and
 * claims the Chat and its adapters for one channel. Reads the Chat's adapters
 * only: nothing initializes or connects.
 */
export function resolveOptions(options: ChatChannelOptions): ResolvedChatChannelOptions {
    if (!isObject(options)) {
        throw invalid('options must be an object.');
    }

    const { chat } = options;

    if (!isObject(chat) || typeof chat.getAdapter !== 'function' || typeof chat.initialize !== 'function' || typeof chat.shutdown !== 'function') {
        throw invalid('chat must be a Chat of the chat package.');
    }

    if (ownedChats.has(chat)) {
        throw invalid('the chat belongs to another chat channel.');
    }

    const adapters = assertAdapters(options);
    const adapterNames = adapters.map((adapter) => adapter.name);
    const webhooks = assertWebhooks(options, adapterNames);
    const name = options.name ?? CHAT_CHANNEL_NAME;

    if (typeof name !== 'string' || !CHANNEL_NAME_PATTERN.test(name) || name.length > CHANNEL_NAME_MAX_LENGTH) {
        throw invalid(`name must match ${CHANNEL_NAME_PATTERN} and have at most ${CHANNEL_NAME_MAX_LENGTH} characters.`);
    }

    if (typeof options.allowMessage !== 'function') {
        throw invalid('allowMessage must be a function: every adapter needs a message policy.');
    }

    for (const key of ['connect', 'disconnect', 'resolveInvoker', 'approvalUrl', 'onError'] as const) {
        assertOptionalFunction(options, key);
    }

    if (options.untrusted !== undefined && typeof options.untrusted !== 'boolean') {
        throw invalid('untrusted must be a boolean.');
    }

    if (options.account !== undefined && !isText(options.account)) {
        throw invalid('account must be a non-empty string without NUL.');
    }

    if (options.history !== undefined && options.history !== 0) {
        throw invalid('history must be 0: platform history is not fetched.');
    }

    const timeoutMs = options.timeoutMs ?? CHAT_TIMEOUT_MS;

    if (!isPositiveInteger(timeoutMs) || timeoutMs > TIMER_MAX_MS) {
        throw invalid(`timeoutMs must be a positive integer of at most ${TIMER_MAX_MS}.`);
    }

    if (options.defaultAddress !== undefined) {
        try {
            decodeChatAddress(options.defaultAddress, adapterNames);
        } catch {
            throw invalid('defaultAddress must be the address of a chat of one of the adapters (to()).');
        }
    }

    ownedChats.add(chat);

    for (const adapter of adapters) {
        ownedIngresses.add(adapter);
    }

    return {
        chat,
        adapters,
        adapterNames,
        name,
        webhooks,
        ...(options.defaultAddress !== undefined ? { defaultAddress: options.defaultAddress } : {}),
        untrusted: options.untrusted !== false,
        ...(options.account !== undefined ? { account: options.account } : {}),
        ...(options.connect ? { connect: options.connect } : {}),
        ...(options.disconnect ? { disconnect: options.disconnect } : {}),
        allowMessage: options.allowMessage,
        ...(options.resolveInvoker ? { resolveInvoker: options.resolveInvoker } : {}),
        ...(options.approvalUrl ? { approvalUrl: options.approvalUrl } : {}),
        timeoutMs,
        // eslint-disable-next-line no-console
        onError: options.onError ?? ((error) => console.error('[chamvi]', error)),
    };
}

/**
 * The address of a chat: `chat:` plus the base64url of the UTF-8 JSON
 * `[adapter, threadId]`, so it decodes back exactly. ValidationError for an
 * empty or NUL-bearing part, an adapter outside `adapters` (when given) or an
 * address above 255 characters: a long transport thread id is refused, never
 * hashed, since an outbound address must decode back to the thread.
 */
export function encodeChatAddress(target: ChatTarget, adapters?: readonly string[]): string {
    const adapter = isObject(target) ? target.adapter : undefined;
    const threadId = isObject(target) ? target.threadId : undefined;

    if (!isText(adapter) || !isText(threadId)) {
        throw new ValidationError('A chat address needs an adapter and a threadId, non-empty strings without NUL.');
    }

    if (adapters && !adapters.includes(adapter)) {
        throw new ValidationError(`The chat channel has no adapter "${adapter}".`);
    }

    const address = CHAT_ADDRESS_PREFIX + Buffer.from(JSON.stringify([adapter, threadId]), 'utf8').toString('base64url');

    if (address.length > TRIGGER_KEY_MAX_LENGTH) {
        // the thread id is not echoed: it may be long and is the platform's
        throw new ValidationError(`The chat address of the thread exceeds ${TRIGGER_KEY_MAX_LENGTH} characters.`);
    }

    return address;
}

/** The chat an address of encodeChatAddress() names; ValidationError for anything else. */
export function decodeChatAddress(address: string, adapters?: readonly string[]): ChatTarget {
    const refused = () => new ValidationError('The address is no chat address (to()).');

    if (typeof address !== 'string' || address.length > TRIGGER_KEY_MAX_LENGTH || !address.startsWith(CHAT_ADDRESS_PREFIX)) {
        throw refused();
    }

    const encoded = address.slice(CHAT_ADDRESS_PREFIX.length);

    if (!BASE64URL.test(encoded)) {
        throw refused();
    }

    const bytes = Buffer.from(encoded, 'base64url');

    // one spelling per address: a lenient decode of another one is refused
    if (bytes.toString('base64url') !== encoded) {
        throw refused();
    }

    let parsed: unknown;

    try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        throw refused();
    }

    if (!Array.isArray(parsed) || parsed.length !== 2 || !isText(parsed[0]) || !isText(parsed[1])) {
        throw refused();
    }

    const target: ChatTarget = { adapter: parsed[0], threadId: parsed[1] };

    // the canonical spelling only (no whitespace or escapes JSON.stringify would not write)
    if (encodeChatAddress(target) !== address) {
        throw refused();
    }

    if (adapters && !adapters.includes(target.adapter)) {
        throw new ValidationError(`The chat channel has no adapter "${target.adapter}".`);
    }

    return target;
}

/**
 * A bounded key over `parts` (idempotency and concurrency keys, which never
 * need decoding): `sha256:<hex>` of their JSON.
 */
export function hashKey(parts: readonly string[]): string {
    return `sha256:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;
}

/** Hands `error` to onError, containing a throwing onError. */
export function reportError(options: Pick<ResolvedChatChannelOptions, 'onError'>, error: unknown): void {
    try {
        options.onError(error);
    } catch {
        // a throwing onError must not turn into an unhandled rejection
    }
}
