/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    areJidsSameUser,
    isJidGroup,
    isLidUser,
    isPnUser,
    jidNormalizedUser,
} from 'baileys';
import type { WAMessage, WAMessageContent } from 'baileys';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import type { ConversationTarget } from '@chamvi/core';
import { isObject } from 'smob';
import type {
    ResolvedWhatsAppPolicy,
    WhatsAppIdentity,
    WhatsAppPolicy,
    WhatsAppSocket,
} from './types.ts';

function invalid(message: string): InvalidAgentDefinitionError {
    return new InvalidAgentDefinitionError(`createWhatsAppChat: ${message}`);
}

/** A phone number jid without a device suffix. */
function isNormalizedPhoneJid(value: unknown): value is string {
    return typeof value === 'string' && isPnUser(value) === true && jidNormalizedUser(value) === value;
}

function isNormalizedGroupJid(value: unknown): value is string {
    return typeof value === 'string' && isJidGroup(value) === true && jidNormalizedUser(value) === value;
}

/** A list of normalized jids; the error names the option and the index, never the value. */
function readJids(value: unknown, option: string, accept: (entry: unknown) => entry is string, kind: string): Set<string> {
    if (!Array.isArray(value)) {
        throw invalid(`${option} must be an array of ${kind}.`);
    }

    const jids = new Set<string>();

    value.forEach((entry: unknown, index) => {
        if (!accept(entry)) {
            throw invalid(`${option}[${index}] must be a ${kind} (normalized, no device suffix).`);
        }

        jids.add(entry);
    });

    return jids;
}

/** Checks the policy (InvalidAgentDefinitionError naming the option): explicit, normalized ids only. */
export function resolvePolicy(policy: WhatsAppPolicy): ResolvedWhatsAppPolicy {
    if (!isObject(policy)) {
        throw invalid('policy is required: list the allowed senders, or set open: true.');
    }

    const hasSenders = Object.hasOwn(policy, 'senders');
    const open = Object.hasOwn(policy, 'open');

    if (hasSenders === open) {
        throw invalid('policy needs exactly one of senders (an allowlist) and open: true.');
    }

    if (open && (policy as { open?: unknown }).open !== true) {
        throw invalid('policy.open must be true.');
    }

    const requireGroupMention = policy.requireGroupMention ?? true;

    if (typeof requireGroupMention !== 'boolean') {
        throw invalid('policy.requireGroupMention must be a boolean.');
    }

    const groups = policy.groups === undefined ?
        new Set<string>() :
        readJids(policy.groups, 'policy.groups', isNormalizedGroupJid, 'group jid (<id>@g.us)');

    return {
        ...(hasSenders ? { senders: readJids((policy as { senders: unknown }).senders, 'policy.senders', isNormalizedPhoneJid, 'phone number jid (<digits>@s.whatsapp.net)') } : {}),
        groups,
        requireGroupMention,
    };
}

/** The context info (mentions) of a message's content, whatever its type. */
function contextInfoOf(content: WAMessageContent | undefined): { mentionedJid?: string[] | null } | undefined {
    if (!content) {
        return undefined;
    }

    for (const value of Object.values(content)) {
        if (isObject(value) && isObject(value.contextInfo)) {
            return value.contextInfo as { mentionedJid?: string[] | null };
        }
    }

    return undefined;
}

/**
 * The phone number jid of a sender: a phone number jid as is (device suffix
 * removed); a LID only through the server's alternative id of the message
 * key or the socket's LID mapping store, both authenticated by the
 * connection, never by guessing from the string. Anything else: undefined.
 */
async function phoneJidOf(jid: string, alternative: string | undefined, socket: WhatsAppSocket): Promise<string | undefined> {
    if (isPnUser(jid)) {
        return jidNormalizedUser(jid);
    }

    if (!isLidUser(jid)) {
        return undefined;
    }

    if (alternative && isPnUser(alternative)) {
        return jidNormalizedUser(alternative);
    }

    try {
        const mapped = await socket.signalRepository?.lidMapping.getPNForLID(jidNormalizedUser(jid));

        return mapped && isPnUser(mapped) ? jidNormalizedUser(mapped) : undefined;
    } catch {
        // an unreadable mapping is no mapping: deny
        return undefined;
    }
}

/**
 * The identity of an incoming message, or undefined for one that must start
 * nothing: the bot's own message, a chat that is neither a direct chat nor a
 * group, a group message without a participant, a sender whose phone number
 * is not known through an authenticated mapping. Contact or push names are
 * never read.
 */
export async function resolveIdentity(
    raw: WAMessage,
    content: WAMessageContent | undefined,
    socket: WhatsAppSocket,
    account: string,
): Promise<WhatsAppIdentity | undefined> {
    const { key } = raw;
    const remote = key.remoteJid;

    if (key.fromMe === true || typeof remote !== 'string') {
        return undefined;
    }

    const group = isJidGroup(remote) === true;

    if (!group && !isPnUser(remote) && !isLidUser(remote)) {
        return undefined;
    }

    // in a group the participant writes, never the group itself
    const from = group ? key.participant : remote;

    if (typeof from !== 'string' || from.length === 0) {
        return undefined;
    }

    const sender = await phoneJidOf(from, (group ? key.participantAlt : key.remoteJidAlt) ?? undefined, socket);

    if (!sender) {
        return undefined;
    }

    let mentioned = false;

    if (group) {
        const own = [socket.user?.id, socket.user?.lid, socket.user?.phoneNumber].filter((jid): jid is string => typeof jid === 'string');
        const mentions = contextInfoOf(content)?.mentionedJid ?? [];

        mentioned = mentions.some((jid) => own.some((self) => areJidsSameUser(jid, self)));
    }

    return {
        account,
        chat: group ? jidNormalizedUser(remote) : sender,
        sender,
        group,
        mentioned,
    };
}

/** Whether the policy lets the identity start runs (resolveInvoker decides next). */
export function isAllowed(policy: ResolvedWhatsAppPolicy, identity: WhatsAppIdentity | undefined): boolean {
    if (!identity) {
        return false;
    }

    if (policy.senders && !policy.senders.has(identity.sender)) {
        return false;
    }

    if (!identity.group) {
        return true;
    }

    return policy.groups.has(identity.chat) && (!policy.requireGroupMention || identity.mentioned);
}

/**
 * The conversation of an identity: the account alias, the chat jid and who
 * reads it (`direct:<sender>`, or `group:<group jid>`: one memory per group).
 */
export function toConversationTarget(identity: WhatsAppIdentity, text: string): ConversationTarget {
    return {
        account: identity.account,
        chat: identity.chat,
        audience: identity.group ? `group:${identity.chat}` : `direct:${identity.sender}`,
        text,
    };
}
