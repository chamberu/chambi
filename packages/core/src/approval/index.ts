/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

export {
    APPROVAL_OPTIONS_DETAIL_MAX_LENGTH,
    APPROVAL_OPTIONS_MAX,
    APPROVAL_OPTION_DETAIL_MAX_LENGTH,
    APPROVAL_OPTION_ID_PATTERN,
    APPROVAL_OPTION_LABEL_MAX_LENGTH,
    APPROVAL_TIMEOUT_MAX_MS,
    DEFAULT_APPROVAL_TIMEOUT_MS,
} from './constants.ts';
export { approve, outboundApproved } from './request.ts';
export type { ApprovalDecision, ApprovalOption, ApprovalRequestInput } from './types.ts';
