/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';
import { ValidationError } from '../errors/index.ts';
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
    };
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
        /[\r\n]/.test(label)
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
        if (multiple !== undefined) throw new ValidationError('An approval request with multiple needs options.');
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
