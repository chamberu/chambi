/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';
import { ValidationError } from '../errors/index.ts';
import type { WaitPoint } from '../run/types.ts';
import type { Invoker } from '../trigger/types.ts';
import {
    APPROVAL_OPTIONS_DETAIL_MAX_LENGTH,
    APPROVAL_OPTIONS_MAX,
    APPROVAL_OPTION_DETAIL_MAX_LENGTH,
    APPROVAL_OPTION_ID_PATTERN,
    APPROVAL_OPTION_LABEL_MAX_LENGTH,
} from './constants.ts';
import type { ApprovalDecision, ApprovalOption } from './types.ts';

/** The effect store key the decision of `approvalId` is recorded under. */
function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function approvalDecisionKey(runId: string, approvalId: string): string {
    return `approval:${runId}:${approvalId}`;
}

/** A recorded decision as approve() returns it (no undefined fields). */
export function toApprovalDecision(value: unknown): ApprovalDecision {
    const record = isObject(value) ? value : {};
    return {
        approved: record.approved === true,
        ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
        ...(isObject(record.approver) ? { approver: record.approver as Invoker } : {}),
        ...(isStringArray(record.selected) ? { selected: [...record.selected] } : {}),
    };
}

/**
 * True without a C0 or C1 control character (line breaks, tabs, terminal
 * escapes) and a line or paragraph separator: channels write labels raw.
 */
function isOneLine(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x20 || (code >= 0x7F && code <= 0x9F) || code === 0x2028 || code === 0x2029) return false;
    }
    return true;
}

function toApprovalOption(value: unknown, index: number): ApprovalOption {
    if (!isObject(value)) throw new ValidationError(`Approval option ${index} must be an object.`);
    const {
        id, 
        label, 
        detail, 
    } = value;
    if (typeof id !== 'string' || !APPROVAL_OPTION_ID_PATTERN.test(id)) {
        throw new ValidationError(
            `Approval option ${index} needs an id of at most 128 characters (letters, digits and . : / @ + - _, no whitespace).`,
        );
    }
    if (
        typeof label !== 'string' ||
        label.trim().length === 0 ||
        label.length > APPROVAL_OPTION_LABEL_MAX_LENGTH ||
        !isOneLine(label)
    ) {
        throw new ValidationError(
            `Approval option "${id}" needs a label of one line with 1 to ${APPROVAL_OPTION_LABEL_MAX_LENGTH} characters.`,
        );
    }
    if (detail !== undefined && (typeof detail !== 'string' || detail.length > APPROVAL_OPTION_DETAIL_MAX_LENGTH)) {
        throw new ValidationError(
            `The detail of approval option "${id}" must be a string of at most ${APPROVAL_OPTION_DETAIL_MAX_LENGTH} characters.`,
        );
    }
    return {
        id, 
        label, 
        ...(detail !== undefined ? { detail } : {}), 
    };
}

/**
 * The options and `multiple` of an approval request, checked and copied
 * (`{ id, label, detail? }`, unknown keys dropped); `{}` for a plain
 * request, `multiple` only when true.
 */
export function toApprovalOptions(
    options: unknown,
    multiple: unknown,
): { options?: ApprovalOption[]; multiple?: true } {
    if (multiple !== undefined && typeof multiple !== 'boolean') {
        throw new ValidationError('An approval request\'s multiple must be a boolean.');
    }
    if (options === undefined) {
        if (multiple === true) throw new ValidationError('An approval request with multiple needs options.');
        return {};
    }
    if (!Array.isArray(options) || options.length === 0 || options.length > APPROVAL_OPTIONS_MAX) {
        throw new ValidationError(`An approval request's options must be an array of 1 to ${APPROVAL_OPTIONS_MAX} options.`);
    }
    const copied = options.map((option, index) => toApprovalOption(option, index));
    const ids = new Set<string>();
    let details = 0;
    for (const option of copied) {
        if (ids.has(option.id)) throw new ValidationError(`The approval option id "${option.id}" is used twice.`);
        ids.add(option.id);
        details += option.detail?.length ?? 0;
    }
    if (details > APPROVAL_OPTIONS_DETAIL_MAX_LENGTH) {
        throw new ValidationError(
            `The details of an approval request's options have at most ${APPROVAL_OPTIONS_DETAIL_MAX_LENGTH} characters together.`,
        );
    }
    return { options: copied, ...(multiple === true ? { multiple: true as const } : {}) };
}

/**
 * The shape of an answer's `selected`: absent, or an array of at most
 * APPROVAL_OPTIONS_MAX distinct strings. Checked before any store read.
 */
export function assertSelectionShape(selected: unknown): asserts selected is string[] | undefined {
    if (selected === undefined) return;
    if (!isStringArray(selected) || selected.length > APPROVAL_OPTIONS_MAX) {
        throw new ValidationError(`An approval's selected must be an array of at most ${APPROVAL_OPTIONS_MAX} option ids.`);
    }
    if (new Set(selected).size !== selected.length) {
        throw new ValidationError('An approval\'s selected names an option twice.');
    }
}

/**
 * The selection an answer records for `waiting`: the ids in the wait
 * point's option order, undefined for a plain wait point or a denial (an
 * empty selection on a denial is dropped). Throws ValidationError for a
 * selection that does not fit the wait point.
 */
export function toSelection(
    waiting: WaitPoint,
    approved: boolean,
    selected: string[] | undefined,
): string[] | undefined {
    const options = waiting.options ?? [];
    if (options.length === 0) {
        if (selected !== undefined && selected.length > 0) {
            throw new ValidationError(`Approval "${waiting.approvalId}" has no options to select.`);
        }
        return undefined;
    }
    if (!approved) {
        if (selected !== undefined && selected.length > 0) {
            throw new ValidationError('A denial selects no option.');
        }
        return undefined;
    }
    const chosen = new Set(selected ?? []);
    const known = new Set(options.map((option) => option.id));
    for (const id of chosen) {
        if (!known.has(id)) throw new ValidationError(`Approval "${waiting.approvalId}" has no option "${id}".`);
    }
    if (waiting.multiple === true) {
        if (chosen.size === 0) throw new ValidationError('An approval of a multiple choice selects at least one option.');
    } else if (chosen.size !== 1) {
        throw new ValidationError('An approval of a single choice selects exactly one option.');
    }
    return options.filter((option) => chosen.has(option.id)).map((option) => option.id);
}

/**
 * A recorded decision as a replayed request gets it: unchanged when it still
 * fits the request (a denial always does), with the selection in the
 * request's option order; a denial `options changed` when the request now
 * offers other options than the recorded selection was made from (a
 * selection the request does not offer, a selection for a plain request,
 * none for a request with options), so a tool never gets an id it did not
 * offer.
 */
export function fitRecordedDecision(
    decision: ApprovalDecision,
    request: {
        approvalId: string; 
        options?: ApprovalOption[]; 
        multiple?: boolean 
    },
): ApprovalDecision {
    if (!decision.approved) return decision;
    const changed: ApprovalDecision = {
        approved: false,
        reason: 'options changed',
        ...(decision.approver ? { approver: decision.approver } : {}),
    };
    if (!request.options) return decision.selected ? changed : decision;
    let selected: string[] | undefined;
    try {
        selected = toSelection({
            kind: 'approval',
            approvalId: request.approvalId,
            toolName: '',
            toolCallId: '',
            title: '',
            options: request.options,
            ...(request.multiple ? { multiple: true } : {}),
            expiresAt: new Date(0),
        }, true, decision.selected);
    } catch {
        return changed;
    }
    return { ...decision, ...(selected ? { selected } : {}) };
}
