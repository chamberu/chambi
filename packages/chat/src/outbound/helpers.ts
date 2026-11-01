/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    ChamviError,
    InvalidAgentDefinitionError,
    ValidationError,
} from '@chamvi/core';
import type { ChannelMessage } from '@chamvi/core';
import { CHAT_REQUEST_ERROR_CODE, CHAT_TEXT_MAX_CHARS } from '../channel/constants.ts';
import {
    ERROR_TEXT_MAX_LENGTH,
    MULTIPLE_OPTIONS_HEADING,
    OPTIONS_HEADING,
    PROSE_MIN_CHARS,
} from './constants.ts';
import type { ChatRenderOptions } from './types.ts';

// whitespace and control characters: a link holding one would not stay one line (or one link)
// eslint-disable-next-line no-control-regex
const UNSAFE_LINK = /[\s\x00-\x1F\x7F-\x9F]/;

/** A transport failure of a send. */
export function requestError(message: string): ChamviError {
    return new ChamviError({ message, code: CHAT_REQUEST_ERROR_CODE });
}

/** The message of a thrown value, cut to `ERROR_TEXT_MAX_LENGTH` characters. */
export function messageOf(error: unknown): string {
    const text = Error.isError(error) ? error.message : String(error);

    return text.length > ERROR_TEXT_MAX_LENGTH ? `${text.slice(0, ERROR_TEXT_MAX_LENGTH)}…` : text;
}

/**
 * What approvalUrl() returned, when it is an absolute http(s) URL without
 * credentials, whitespace or control characters; the string as given (never
 * normalized). InvalidAgentDefinitionError otherwise, never echoing the value.
 */
function assertApprovalLink(value: unknown): string {
    const refused = () => new InvalidAgentDefinitionError(
        'chatChannel: approvalUrl must return an absolute http(s) URL without credentials, whitespace or control characters.',
    );

    if (typeof value !== 'string' || value.length === 0 || UNSAFE_LINK.test(value)) {
        throw refused();
    }

    let url: URL;

    try {
        url = new URL(value);
    } catch {
        throw refused();
    }

    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
        throw refused();
    }

    return value;
}

/** The cut note for `cut` characters left out. */
function cutNote(cut: number): string {
    return `\n… (cut, ${cut} more characters)`;
}

/**
 * `text` cut to at most `max` characters including the note of how many were
 * cut, keeping at least `PROSE_MIN_CHARS` of it; never ends on a high
 * surrogate, so the result stays well formed. Undefined when `max` leaves
 * less than that.
 */
function cutProse(text: string, max: number): string | undefined {
    // the note for the longest possible remainder, so the cut text and its note fit
    let end = max - cutNote(text.length).length;

    if (end < PROSE_MIN_CHARS) {
        return undefined;
    }

    const last = text.charCodeAt(end - 1);

    if (last >= 0xD800 && last <= 0xDBFF) {
        end--;
    }

    return `${text.slice(0, end)}${cutNote(text.length - end)}`;
}

function renderPlain(message: ChannelMessage): string {
    const text = [message.title, message.body].filter((part) => !!part).join('\n\n');

    if (text.length === 0) {
        throw new ValidationError('A chat message needs a title or a body.');
    }

    if (text.length > CHAT_TEXT_MAX_CHARS) {
        throw new ValidationError(
            `The chat message has ${text.length} characters; a chat channel sends at most ${CHAT_TEXT_MAX_CHARS} and never splits a message.`,
        );
    }

    return text;
}

function renderApproval(message: ChannelMessage, options: ChatRenderOptions): string {
    if (!options.approvalUrl) {
        throw new InvalidAgentDefinitionError(
            'chatChannel: approvalUrl is required to send an approval; it is answered in the chamvi UI only.',
        );
    }

    if (!message.approvalId) {
        throw new ValidationError('An approval message needs its approvalId.');
    }

    const link = assertApprovalLink(options.approvalUrl({
        runId: message.runId,
        approvalId: message.approvalId,
        agent: message.agent,
    }));
    const choices = message.options ?? [];
    const tail: string[] = [];

    if (choices.length > 0) {
        // ids and labels only: an option's detail stays in the UI
        tail.push([
            message.multiple === true ? MULTIPLE_OPTIONS_HEADING : OPTIONS_HEADING,
            ...choices.map((option) => `- ${option.id}: ${option.label}`),
        ].join('\n'));
    }

    tail.push([
        ...(message.expiresAt instanceof Date ? [`Expires: ${message.expiresAt.toISOString()}`] : []),
        `${choices.length > 0 ? 'Choose and approve or deny' : 'Approve or deny'}: ${link}`,
    ].join('\n'));

    const structure = tail.join('\n\n');
    const prose = [message.title, message.body].filter((part) => !!part).join('\n\n');
    const budget = CHAT_TEXT_MAX_CHARS - structure.length - (prose ? 2 : 0);
    const refused = (reason: string) => new ValidationError(
        `The approval's options, expiry and link need ${structure.length} characters ${reason} of a chat message of ${CHAT_TEXT_MAX_CHARS}.`,
    );

    if (!prose) {
        if (budget < 0) {
            throw refused('and do not fit the bound');
        }

        return structure;
    }

    if (prose.length <= budget) {
        return `${prose}\n\n${structure}`;
    }

    const cut = cutProse(prose, budget);

    if (cut === undefined) {
        throw refused('and leave no room for the title and body');
    }

    return `${cut}\n\n${structure}`;
}

/**
 * The text one send posts, as is (no markdown conversion), at most
 * `CHAT_TEXT_MAX_CHARS` characters. A message is its title and body; one
 * above the bound is a ValidationError (never split or cut). An approval is
 * its title and body (cut Unicode-safely when they do not fit, the only cut),
 * the options as `- <id>: <label>` (never a detail), the expiry and the
 * link of `approvalUrl` (ids only, never a token); options, expiry and link
 * that cannot fit are a ValidationError, a missing or invalid `approvalUrl`
 * an InvalidAgentDefinitionError. Nothing else of the run is rendered.
 */
export function renderChatMessage(message: ChannelMessage, options: ChatRenderOptions): string {
    const text = message.kind === 'approval' ? renderApproval(message, options) : renderPlain(message);

    // the bound holds by construction; this keeps it so should the arithmetic above ever slip
    if (text.length > CHAT_TEXT_MAX_CHARS) {
        throw new ValidationError(`The rendered chat message has ${text.length} characters; at most ${CHAT_TEXT_MAX_CHARS} are sent.`);
    }

    return text;
}
